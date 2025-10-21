import type { GooseDataset } from './cache';

const API_BASE = 'https://elgoose.net/api/v2';
const SETLIST_FETCH_CONCURRENCY = 5;

type JsonRecord = Record<string, any>;

async function fetchJson<T = unknown>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Request to ${url.toString()} failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  if (body?.error) {
    const message =
      typeof body.error_message === 'string' && body.error_message.length > 0
        ? body.error_message
        : 'Unknown error';
    throw new Error(`elgoose API error: ${message}`);
  }
  return (body?.data ?? body) as T;
}

async function fetchShows(): Promise<JsonRecord[]> {
  const shows = await fetchJson<JsonRecord[]>('shows.json');
  return Array.isArray(shows) ? shows : [];
}

async function fetchSetlistForShow(showId: number): Promise<JsonRecord[]> {
  const entries = await fetchJson<JsonRecord[]>(`setlists/show_id/${showId}.json`);
  return Array.isArray(entries) ? entries : [];
}

function toNumericId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function createSetlistEntryKey(entry: JsonRecord | undefined | null): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const candidateKeys = ['entry_id', 'setlist_entry_id', 'id', 'songhistory_id', 'songhistoryid', 'uniqueid'];
  for (const key of candidateKeys) {
    const value = entry[key];
    if (value !== undefined && value !== null) {
      return `${key}:${String(value)}`;
    }
  }
  const showId = toNumericId(entry.show_id);
  const songId = entry.song_id ?? entry.songid ?? entry.songhistoryid ?? 'unknown';
  const position = entry.position ?? entry.sortorder ?? entry.setorder ?? entry.songorder ?? 'unknown';
  return `show:${showId ?? 'unknown'}:song:${songId}:pos:${position}:hash:${stableStringify(entry)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `{${entries.map(([key, val]) => `"${key}":${stableStringify(val)}`).join(',')}}`;
}

export interface SyncResult {
  dataset: GooseDataset;
  addedShowCount: number;
  addedSetlistCount: number;
}

export interface SyncProgress {
  phase: 'shows' | 'setlists' | 'complete';
  completed?: number;
  total?: number;
  message: string;
}

export interface SyncOptions {
  onProgress?: (progress: SyncProgress) => void;
}

export async function syncDatasetWithApi(
  existing?: GooseDataset | null,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const emitProgress = (progress: SyncProgress) => {
    if (typeof options.onProgress === 'function') {
      options.onProgress(progress);
    }
  };

  emitProgress({ phase: 'shows', message: 'Fetching latest shows...', completed: 0 });

  const baseline = existing ?? null;
  const existingShows = baseline?.shows ?? [];
  const existingSetlists = baseline?.setlists ?? [];

  const existingShowById = new Map<number, JsonRecord>();
  for (const show of existingShows) {
    const showId = toNumericId(show?.show_id);
    if (showId !== undefined && !existingShowById.has(showId)) {
      existingShowById.set(showId, show);
    }
  }

  const latestShows = await fetchShows();
  emitProgress({
    phase: 'shows',
    message: `Fetched ${latestShows.length.toLocaleString()} shows. Comparing with cached data...`,
    completed: latestShows.length
  });

  const mergedShows: JsonRecord[] = [];
  const newShowRecords: Array<{ id: number; record: JsonRecord }> = [];

  for (const rawShow of latestShows) {
    const showId = toNumericId(rawShow?.show_id);
    if (showId !== undefined && existingShowById.has(showId)) {
      mergedShows.push(existingShowById.get(showId)!);
    } else {
      mergedShows.push(rawShow);
      if (showId !== undefined) {
        newShowRecords.push({ id: showId, record: rawShow });
      }
    }
  }

  for (const show of existingShows) {
    const showId = toNumericId(show?.show_id);
    if (showId !== undefined && !mergedShows.some((candidate) => toNumericId(candidate?.show_id) === showId)) {
      mergedShows.push(show);
    }
  }

  const existingSetlistKeys = new Set<string>();
  for (const entry of existingSetlists) {
    const key = createSetlistEntryKey(entry);
    if (key) {
      existingSetlistKeys.add(key);
    }
  }

  const combinedSetlists = [...existingSetlists];
  const newEntriesByShow = new Map<number, JsonRecord[]>();

  if (newShowRecords.length === 0) {
    const dataset: GooseDataset = {
      fetchedAt: new Date().toISOString(),
      shows: mergedShows,
      setlists: combinedSetlists
    };

    emitProgress({
      phase: 'complete',
      message: 'Dataset is already up to date.',
      completed: mergedShows.length,
      total: mergedShows.length
    });

    return {
      dataset,
      addedShowCount: 0,
      addedSetlistCount: 0
    };
  }

  if (newShowRecords.length > 0) {
    let index = 0;
    const errors: Array<{ showId: number; error: Error }> = [];
    let completed = 0;
    const total = newShowRecords.length;

    emitProgress({
      phase: 'setlists',
      message: `Downloading setlists for ${total} new show${total === 1 ? '' : 's'} (0/${total})...`,
      completed: 0,
      total
    });

    async function worker() {
      while (index < newShowRecords.length) {
        const currentIndex = index;
        index += 1;
        const { id } = newShowRecords[currentIndex];
        try {
          const entries = await fetchSetlistForShow(id);
          const filtered: JsonRecord[] = [];
          for (const entry of entries) {
            const key = createSetlistEntryKey(entry);
            if (key && existingSetlistKeys.has(key)) {
              continue;
            }
            if (key) {
              existingSetlistKeys.add(key);
            }
            filtered.push(entry);
          }
          if (filtered.length > 0) {
            newEntriesByShow.set(id, filtered);
          }
        } catch (error: any) {
          errors.push({ showId: id, error: error instanceof Error ? error : new Error(String(error)) });
        } finally {
          completed += 1;
          emitProgress({
            phase: 'setlists',
            message: `Downloading setlists (${completed}/${total})...`,
            completed,
            total
          });
        }
      }
    }

    const workerCount = Math.min(SETLIST_FETCH_CONCURRENCY, Math.max(1, newShowRecords.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (errors.length > 0) {
      const detail = errors
        .slice(0, 5)
        .map(({ showId, error }) => `${showId}: ${error.message ?? error}`)
        .join('; ');
      throw new Error(`Failed to download setlists for ${errors.length} new show(s): ${detail}`);
    }

    for (const show of mergedShows) {
      const showId = toNumericId(show?.show_id);
      if (showId === undefined) continue;
      const additions = newEntriesByShow.get(showId);
      if (additions && additions.length > 0) {
        combinedSetlists.push(...additions);
      }
    }

    emitProgress({
      phase: 'setlists',
      message: 'Finished downloading new setlists.',
      completed: total,
      total
    });
  }

  const dataset: GooseDataset = {
    fetchedAt: new Date().toISOString(),
    shows: mergedShows,
    setlists: combinedSetlists
  };

  const addedSetlistCount = Array.from(newEntriesByShow.values()).reduce((total, entries) => total + entries.length, 0);

  emitProgress({
    phase: 'complete',
    message: `Sync complete. Added ${newShowRecords.length} new show${newShowRecords.length === 1 ? '' : 's'} and ${addedSetlistCount} setlist entr${
      addedSetlistCount === 1 ? 'y' : 'ies'
    }.`,
    completed: newShowRecords.length,
    total: newShowRecords.length
  });

  return {
    dataset,
    addedShowCount: newShowRecords.length,
    addedSetlistCount
  };
}
