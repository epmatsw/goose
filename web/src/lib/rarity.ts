export interface Show {
  show_id: number;
  showdate?: string | null;
  show_year?: number | string | null;
  venuename?: string | null;
  location?: string | null;
}

export interface SetlistEntry {
  uniqueid?: string | number | null;
  show_id?: number | null;
  showdate?: string | null;
  song_id?: number | null;
  slug?: string | null;
  songname?: string | null;
  isoriginal?: number | string | null;
  original_artist?: string | null;
  tracktime?: string | null;
  settype?: string | null;
  setnumber?: string | number | null;
  position?: number | string | null;
  footnote?: string | null;
  transition?: string | null;
}

export interface Dataset {
  shows: Show[];
  setlists: SetlistEntry[];
}

export interface RarityScore {
  showId: number;
  date: string | null;
  venue: string;
  location: string;
  rarityScore: number;
  year?: number;
  entries: number;
}

export interface ComputeResult {
  scores: RarityScore[];
  skipped: RarityScore[];
  songDetails: Record<string, SongRarityDetail>;
}

export interface SongRarityDetail {
  key: string;
  showId?: number;
  normalized: number;
  raw: number;
  plays: number;
  percentage: number;
  isCover: boolean;
  firstDate?: string;
}

const W_F = 1.0;
const W_C = 0.5;
const F_CAP = 3;
const MIN_NORMALIZED_RARITY = 0.05;
const MAX_NORMALIZED_RARITY = 1.0;
const MIN_SHOW_SCORE = 0.001;
const LENGTH_ATTENUATION = 0.1;
const FTP_BONUS_ORIGINAL = 0.1;
const FTP_BONUS_COVER = 0.05;
const FTP_YEAR_THRESHOLD = new Date('2020-01-01T00:00:00Z');

function decodeHtmlEntities(value: string | null | undefined): string {
  if (!value) return '';
  if (!value.includes('&')) return value;
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'"
  };
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    let decoded: string | undefined;
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      if (!Number.isNaN(code)) decoded = String.fromCodePoint(code);
    } else if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      if (!Number.isNaN(code)) decoded = String.fromCodePoint(code);
    } else if (entity in named) {
      decoded = named[entity];
    }
    if (decoded === '"') return '”';
    if (decoded === "'") return '’';
    return decoded ?? match;
  });
}

function normalizeIsOriginal(value: SetlistEntry['isoriginal']): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === '1' || trimmed === 'true' || trimmed === 'yes') return true;
    if (trimmed === '0' || trimmed === 'false' || trimmed === 'no') return false;
  }
  return Boolean(value);
}

function isCover(entry: SetlistEntry): boolean {
  if (entry?.isoriginal !== undefined && entry?.isoriginal !== null) {
    return !normalizeIsOriginal(entry.isoriginal);
  }
  return Boolean(entry?.original_artist);
}

function parseShowYear(show: Show): number | undefined {
  if (show?.show_year !== undefined && show?.show_year !== null) {
    const parsed = Number.parseInt(String(show.show_year), 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (show?.showdate) {
    const year = Number.parseInt(String(show.showdate).slice(0, 4), 10);
    if (!Number.isNaN(year)) return year;
  }
  return undefined;
}

function parseShowDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const iso = `${String(value)}T00:00:00Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function songKey(entry: SetlistEntry): string {
  if (entry?.song_id) return `id:${entry.song_id}`;
  if (entry?.slug) return `slug:${entry.slug}`;
  if (entry?.songname) return `name:${entry.songname.toLowerCase()}`;
  return `unique:${entry.show_id ?? Math.random()}`;
}

export function createSetlistEntryKey(entry: SetlistEntry, index?: number): string {
  if (entry?.uniqueid != null) return `uid:${entry.uniqueid}`;
  const showPart = entry?.show_id != null ? `show:${entry.show_id}` : 'show:unknown';
  const positionValue = entry?.position ?? entry?.setnumber;
  const positionPart =
    positionValue != null && String(positionValue).trim().length > 0
      ? `pos:${String(positionValue).trim()}`
      : index != null
        ? `idx:${index}`
        : 'pos:unknown';
  const namePart =
    entry?.slug && String(entry.slug).trim().length > 0
      ? `slug:${String(entry.slug).trim().toLowerCase()}`
      : entry?.songname && String(entry.songname).trim().length > 0
        ? `name:${String(entry.songname).trim().toLowerCase()}`
        : 'name:unknown';
  return `${showPart}|${positionPart}|${namePart}`;
}

function showsSince(date: Date | undefined, sortedDates: number[], totalEligible: number): number {
  if (totalEligible === 0) return 0;
  if (!date) return totalEligible;
  const target = date.getTime();
  let left = 0;
  let right = sortedDates.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (sortedDates[mid] >= target) {
      right = mid;
    } else {
      left = mid + 1;
    }
  }
  return totalEligible - left;
}

export function computeRarityScores(dataset: Dataset): ComputeResult {
  const shows = dataset.shows ?? [];
  const setlists = dataset.setlists ?? [];

  const setlistCounts = new Map<number, number>();
  for (const entry of setlists) {
    if (entry?.show_id == null) continue;
    setlistCounts.set(entry.show_id, (setlistCounts.get(entry.show_id) ?? 0) + 1);
  }

  if (setlists.length === 0) {
    const scores = shows.map((show) => ({
      showId: show.show_id,
      date: show.showdate ?? null,
      venue: decodeHtmlEntities(show.venuename ?? ''),
      location: decodeHtmlEntities(show.location ?? ''),
      rarityScore: MIN_SHOW_SCORE,
      year: parseShowYear(show),
      entries: 0
    }));
    return { scores, skipped: [], songDetails: {} };
  }

  const showDateMap = new Map<number, Date>();
  for (const show of shows) {
    const date = parseShowDate(show.showdate);
    if (date) showDateMap.set(show.show_id, date);
  }

  const showsWithSetlistDates: number[] = [];
  for (const show of shows) {
    const count = setlistCounts.get(show.show_id) ?? 0;
    if (count === 0) continue;
    const date = parseShowDate(show.showdate);
    if (!date) continue;
    showsWithSetlistDates.push(date.getTime());
  }
  showsWithSetlistDates.sort((a, b) => a - b);
  const totalEligibleShows = showsWithSetlistDates.length;

  const songStats = new Map<string, { showIds: Set<number>; firstDate?: Date }>();
  for (const entry of setlists) {
    const key = songKey(entry);
    let stats = songStats.get(key);
    if (!stats) {
      stats = { showIds: new Set() };
      songStats.set(key, stats);
    }
    if (entry?.show_id != null) {
      stats.showIds.add(entry.show_id);
    }
    const entryDate =
      parseShowDate(entry?.showdate ?? undefined) ??
      (entry?.show_id != null ? showDateMap.get(entry.show_id) : undefined);
    if (entryDate && (!stats.firstDate || entryDate < stats.firstDate)) {
      stats.firstDate = entryDate;
    }
  }

  const frequencyBySong = new Map<string, number>();
  const firstDateBySong = new Map<string, Date>();
  const usageBySong = new Map<string, { plays: number; percentage: number; firstDate?: Date }>();

  for (const [key, stats] of songStats.entries()) {
    const plays = Math.max(stats.showIds.size, 1);
    const denominator = Math.max(showsSince(stats.firstDate, showsWithSetlistDates, totalEligibleShows), plays);
    const percentage = denominator > 0 ? plays / denominator : 1;
    const percentageMetric = Math.max(percentage * 100, Number.EPSILON);
    frequencyBySong.set(key, percentageMetric);
    if (stats.firstDate) firstDateBySong.set(key, stats.firstDate);
    usageBySong.set(key, { plays, percentage, firstDate: stats.firstDate });
  }

  const rawRarities = setlists.map((entry, index) => {
    const key = songKey(entry);
    const frequencyMetric = frequencyBySong.get(key) ?? 100;
    const isCoverEntry = isCover(entry);
    const base = Math.min(1 / frequencyMetric, 1 / F_CAP);
    const coverFactor = 1 - W_C * (isCoverEntry ? 1 : 0);
    const raw = W_F * base * Math.max(coverFactor, 0);
    const firstDate = firstDateBySong.get(key);
    const ftpBonus = firstDate && firstDate >= FTP_YEAR_THRESHOLD
      ? (isCoverEntry ? FTP_BONUS_COVER : FTP_BONUS_ORIGINAL)
      : 0;
    const entryKey = createSetlistEntryKey(entry, index);
    return {
      showId: entry?.show_id ?? undefined,
      raw: raw + ftpBonus,
      songKey: key,
      entryKey,
      isCover: isCoverEntry
    };
  });

  const rawValues = rawRarities.map((item) => item.raw);
  const minRaw = Math.min(...rawValues);
  const maxRaw = Math.max(...rawValues);
  const spread = maxRaw - minRaw;
  const rarityRange = MAX_NORMALIZED_RARITY - MIN_NORMALIZED_RARITY;

  const totalsByShow = new Map<number, number>();
  const songDetails: Record<string, SongRarityDetail> = {};
  for (const item of rawRarities) {
    const normalized = spread > Number.EPSILON
      ? MIN_NORMALIZED_RARITY + rarityRange * ((item.raw - minRaw) / spread)
      : MAX_NORMALIZED_RARITY;
    if (item.showId != null) {
      totalsByShow.set(item.showId, (totalsByShow.get(item.showId) ?? 0) + normalized);
    }
    const usage = usageBySong.get(item.songKey);
    songDetails[item.entryKey] = {
      key: item.entryKey,
      showId: item.showId,
      normalized,
      raw: item.raw,
      plays: usage?.plays ?? 0,
      percentage: usage?.percentage ?? 0,
      isCover: item.isCover,
      firstDate: usage?.firstDate ? usage.firstDate.toISOString() : undefined
    };
  }

  const scores: RarityScore[] = [];
  const skipped: RarityScore[] = [];

  for (const show of shows) {
    const entries = setlistCounts.get(show.show_id) ?? 0;
    const venue = decodeHtmlEntities(show.venuename ?? '');
    const location = decodeHtmlEntities(show.location ?? '');
    const year = parseShowYear(show);
    if (entries === 0) {
      skipped.push({
        showId: show.show_id,
        date: show.showdate ?? null,
        venue,
        location,
        rarityScore: MIN_SHOW_SCORE,
        year,
        entries
      });
      continue;
    }

    const total = totalsByShow.get(show.show_id) ?? 0;
    const average = total / entries;
    const lengthMultiplier = 1 + Math.log1p(entries) * LENGTH_ATTENUATION;
    const rarityScore = Math.max(average * lengthMultiplier, MIN_SHOW_SCORE);
    scores.push({
      showId: show.show_id,
      date: show.showdate ?? null,
      venue,
      location,
      rarityScore,
      year,
      entries
    });
  }

  return { scores, skipped, songDetails };
}
