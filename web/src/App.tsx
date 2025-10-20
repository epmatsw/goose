import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Select } from './components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { clearDataset, loadDataset, saveDataset, GooseDataset } from './lib/cache';
import { computeRarityScores, RarityScore, createSetlistEntryKey, SongRarityDetail } from './lib/rarity';

type Status = 'idle' | 'loading' | 'ready' | 'error';
type YearOption = 'all' | number;

const LOCAL_DATASET_URL = '/data/elgoose_setlists.json';

function formatNumber(value: number, decimals = 3) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatPercentage(value: number, decimals = 1) {
  if (!Number.isFinite(value)) return '0%';
  const percent = value * 100;
  return `${percent.toFixed(decimals)}%`;
}

function formatDuration(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return null;
  const parts = trimmed.split(':').map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) {
    return trimmed;
  }
  let totalSeconds = 0;
  for (const part of parts) {
    totalSeconds = totalSeconds * 60 + part;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatFirstPlayed(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

async function fetchDatasetFromLocal(): Promise<GooseDataset> {
  const response = await fetch(`${LOCAL_DATASET_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Local dataset not found (status ${response.status})`);
  }
  const payload = await response.json();
  if (!payload?.shows || !payload?.setlists) {
    throw new Error('Invalid local dataset: expected { shows, setlists }');
  }
  return {
    fetchedAt: payload.fetchedAt ?? new Date().toISOString(),
    shows: payload.shows,
    setlists: payload.setlists
  };
}

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

interface DashboardProps {
  dataset: GooseDataset | null;
  datasetInfo: string;
  status: Status;
  years: number[];
  yearFilter: YearOption;
  onYearFilterChange: (value: YearOption) => void;
  venueFilter: string;
  onVenueFilterChange: (value: string) => void;
  limit: number;
  onLimitChange: (value: number) => void;
  filteredScores: RarityScore[];
  limitedScores: RarityScore[];
  averageScore: number;
  omittedCount: number;
  onSelectShow: (showId: number) => void;
}

interface ShowDetailProps {
  dataset: GooseDataset | null;
  scores: RarityScore[];
  songDetails: Record<string, SongRarityDetail>;
}

type ShowEntry = {
  entry: any;
  index: number;
  key: string;
};

const App: React.FC = () => {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<GooseDataset | null>(null);
  const [yearFilter, setYearFilter] = useState<YearOption>('all');
  const [venueFilter, setVenueFilter] = useState('');
  const [limit, setLimit] = useState(10);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    async function hydrate() {
      setStatus('loading');
      try {
        const cached = await loadDataset();
        if (cached) {
          setDataset(cached);
          setStatus('ready');
        } else {
          setStatus('idle');
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message ?? String(err));
        setStatus('error');
      }
    }
    hydrate();
  }, []);

  const years = useMemo(() => {
    if (!dataset) return [];
    const unique = new Set<number>();
    for (const show of dataset.shows ?? []) {
      const rawYear =
        show?.show_year ?? (show?.showdate ? Number(String(show.showdate).slice(0, 4)) : undefined);
      const parsed = Number.parseInt(String(rawYear ?? ''), 10);
      if (!Number.isNaN(parsed)) {
        unique.add(parsed);
      }
    }
    return Array.from(unique).sort((a, b) => b - a);
  }, [dataset]);

  useEffect(() => {
    if (yearFilter !== 'all' && !years.includes(yearFilter)) {
      setYearFilter('all');
    }
  }, [years, yearFilter]);

  const { scores, skipped, songDetails } = useMemo(() => {
    if (!dataset) return { scores: [], skipped: [], songDetails: {} };
    return computeRarityScores({ shows: dataset.shows, setlists: dataset.setlists });
  }, [dataset]);

  const filteredScores = useMemo(() => {
    let working = scores;
    if (yearFilter !== 'all') {
      working = working.filter((score) => score.year === yearFilter);
    }
    if (venueFilter.trim().length > 0) {
      const lower = venueFilter.trim().toLowerCase();
      working = working.filter((score) =>
        [score.venue, score.location].some((field) => field.toLowerCase().includes(lower))
      );
    }
    return [...working].sort((a, b) => b.rarityScore - a.rarityScore);
  }, [scores, yearFilter, venueFilter]);

  const limitedScores = useMemo(
    () => filteredScores.slice(0, Math.max(1, limit)),
    [filteredScores, limit]
  );

  const averageScore = useMemo(() => {
    if (filteredScores.length === 0) return 0;
    const total = filteredScores.reduce((acc, item) => acc + item.rarityScore, 0);
    return total / filteredScores.length;
  }, [filteredScores]);

  const omittedCount = useMemo(() => {
    if (!dataset) return 0;
    if (yearFilter === 'all' && venueFilter.trim().length === 0) return skipped.length;
    return skipped.filter((item) => {
      if (yearFilter !== 'all' && item.year !== yearFilter) return false;
      if (venueFilter.trim().length > 0) {
        const lower = venueFilter.trim().toLowerCase();
        return [item.venue, item.location].some((field) => field.toLowerCase().includes(lower));
      }
      return true;
    }).length;
  }, [skipped, yearFilter, venueFilter, dataset]);

  const datasetInfo = dataset
    ? `${dataset.shows.length.toLocaleString()} shows / ${dataset.setlists.length.toLocaleString()} setlist entries`
    : 'No dataset loaded';

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus('loading');
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed?.shows || !parsed?.setlists) {
        throw new Error('Invalid dataset file: expected { shows, setlists }');
      }
      const payload: GooseDataset = {
        fetchedAt: parsed.fetchedAt ?? new Date().toISOString(),
        shows: parsed.shows,
        setlists: parsed.setlists
      };
      await saveDataset(payload);
      setDataset(payload);
      setStatus('ready');
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? String(err));
      setStatus('error');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, []);

  const handleLoadLocal = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const data = await fetchDatasetFromLocal();
      await saveDataset(data);
      setDataset(data);
      setStatus('ready');
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? String(err));
      setStatus('error');
    }
  }, []);

  const handleClear = useCallback(async () => {
    await clearDataset();
    setDataset(null);
    setStatus('idle');
  }, []);

  const isDetailView = location.pathname.startsWith('/shows/');

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">
              <Link to="/" className="hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                Goose Rarity Dashboard
              </Link>
            </h1>
            <p className="text-sm text-muted-foreground">
              Filter rarity scores and drill into complete setlists from the cached dataset.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isDetailView ? (
              <Button variant="outline" onClick={() => navigate(-1)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Upload JSON
            </Button>
            <Button onClick={handleLoadLocal} disabled={status === 'loading'}>
              {status === 'loading' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Load Local Dataset
            </Button>
            <Button variant="outline" onClick={handleClear}>
              <Trash2 className="mr-2 h-4 w-4" /> Clear Cache
            </Button>
          </div>
        </div>
        {error ? (
          <div className="mx-auto max-w-6xl px-6 pb-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : null}
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <Routes>
          <Route
            path="/"
            element={
              <Dashboard
                dataset={dataset}
                datasetInfo={datasetInfo}
                status={status}
                years={years}
                yearFilter={yearFilter}
                onYearFilterChange={setYearFilter}
                venueFilter={venueFilter}
                onVenueFilterChange={setVenueFilter}
                limit={limit}
                onLimitChange={(value) => setLimit(Math.max(1, Math.floor(value)))}
                filteredScores={filteredScores}
                limitedScores={limitedScores}
                averageScore={averageScore}
                omittedCount={omittedCount}
                onSelectShow={(showId) => navigate(`/shows/${showId}`)}
              />
            }
          />
          <Route
            path="/shows/:showId"
            element={<ShowDetail dataset={dataset} scores={scores} songDetails={songDetails} />}
          />
          <Route
            path="*"
            element={
              <Card>
                <CardHeader>
                  <CardTitle>Not Found</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    We couldn’t find that page. Try returning to the{' '}
                    <Link to="/" className="text-primary underline">
                      dashboard
                    </Link>
                    .
                  </p>
                </CardContent>
              </Card>
            }
          />
        </Routes>
      </main>
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({
  dataset,
  datasetInfo,
  status,
  years,
  yearFilter,
  onYearFilterChange,
  venueFilter,
  onVenueFilterChange,
  limit,
  onLimitChange,
  filteredScores,
  limitedScores,
  averageScore,
  omittedCount,
  onSelectShow
}) => {
  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <CardTitle>Dataset</CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{datasetInfo}</span>
            {dataset?.fetchedAt ? (
              <Badge variant="secondary">Updated {new Date(dataset.fetchedAt).toLocaleString()}</Badge>
            ) : null}
            {status === 'loading' ? (
              <Badge variant="outline" className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium">Year</label>
              <Select
                value={yearFilter === 'all' ? 'all' : String(yearFilter)}
                onChange={(event) => {
                  const value = event.target.value;
                  onYearFilterChange(value === 'all' ? 'all' : Number(value));
                }}
              >
                <option value="all">All Years</option>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">Venue filter</label>
              <Input
                placeholder="Search venues or locations"
                value={venueFilter}
                onChange={(event) => onVenueFilterChange(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">Top N results</label>
              <Input
                type="number"
                min={1}
                value={limit}
                onChange={(event) => onLimitChange(Number(event.target.value))}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">Active Filters</label>
              <div className="rounded-md border bg-muted/50 p-3 text-sm">
                <p>Shows: {filteredScores.length.toLocaleString()}</p>
                <p>Average rarity: {formatNumber(averageScore)}</p>
                {omittedCount > 0 ? <p>Omitted (no setlist): {omittedCount}</p> : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top Shows</CardTitle>
        </CardHeader>
        <CardContent>
          {limitedScores.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shows match the selected filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">#</th>
                    <th className="px-4 py-2 text-left font-medium">Date</th>
                    <th className="px-4 py-2 text-left font-medium">Venue</th>
                    <th className="px-4 py-2 text-left font-medium">Location</th>
                    <th className="px-4 py-2 text-right font-medium">Rarity</th>
                    <th className="px-4 py-2 text-right font-medium">Songs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {limitedScores.map((score, index) => (
                    <tr
                      key={score.showId}
                      className="group cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      onClick={() => onSelectShow(score.showId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectShow(score.showId);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${score.date ?? 'Unknown date'} at ${score.venue || 'Unknown venue'}`}
                    >
                      <td className="px-4 py-2 text-left font-medium">{index + 1}</td>
                      <td className="px-4 py-2 text-primary">{score.date ?? 'Unknown'}</td>
                      <td className="px-4 py-2 text-primary">{score.venue || 'Unknown venue'}</td>
                      <td className="px-4 py-2">{score.location || 'Unknown location'}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatNumber(score.rarityScore)}</td>
                      <td className="px-4 py-2 text-right">{score.entries}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
};

interface SetMeta {
  groupKey: string;
  groupOrder: number;
  label: string;
  position: number;
}

function getSetMeta(entry: any): SetMeta {
  const rawType = typeof entry?.settype === 'string' ? entry.settype : '';
  let normalizedType = rawType.trim().toLowerCase();
  const setNumberValue = entry?.setnumber;
  const rawSetNumber =
    typeof setNumberValue === 'string' ? setNumberValue.trim().toLowerCase() : undefined;
  let parsedNumber = Number.NaN;
  if (typeof setNumberValue === 'number') {
    parsedNumber = setNumberValue;
  } else if (typeof setNumberValue === 'string') {
    parsedNumber = Number.parseInt(setNumberValue, 10);
  }

  if (normalizedType === 'set' && rawSetNumber) {
    if (['e', 'enc', 'encore'].includes(rawSetNumber)) {
      normalizedType = 'encore';
    }
  }

  const hasNumber = !Number.isNaN(parsedNumber);
  const setNumber = hasNumber ? parsedNumber : 0;
  const positionValue = entry?.position;
  let parsedPosition = Number.NaN;
  if (typeof positionValue === 'number') {
    parsedPosition = positionValue;
  } else if (typeof positionValue === 'string') {
    parsedPosition = Number.parseInt(positionValue, 10);
  }
  const position = Number.isNaN(parsedPosition) ? 0 : parsedPosition;

  const typeWeightMap: Record<string, number> = {
    soundcheck: 0,
    set: 1,
    show: 1,
    encore: 2
  };
  const baseWeight = typeWeightMap[normalizedType] ?? 3;
  const groupOrder = baseWeight * 100 + setNumber;

  let label: string;
  if (normalizedType === 'set' || normalizedType === 'show') {
    label = hasNumber ? `Set ${setNumber}` : 'Set';
  } else if (normalizedType === 'encore') {
    label = hasNumber && setNumber > 1 ? `Encore ${setNumber}` : 'Encore';
  } else if (normalizedType === 'soundcheck') {
    label = 'Soundcheck';
  } else if (rawType.trim().length > 0) {
    label = rawType
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  } else if (hasNumber) {
    label = `Set ${setNumber}`;
  } else {
    label = 'Set';
  }

  return {
    groupKey: `${baseWeight}:${setNumber}:${label}`,
    groupOrder,
    label,
    position
  };
}

const ShowDetail: React.FC<ShowDetailProps> = ({ dataset, scores, songDetails }) => {
  const { showId } = useParams<{ showId: string }>();
  const numericId = Number.parseInt(String(showId ?? ''), 10);

  if (!dataset) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Load Dataset</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Load the cached dataset to explore full setlists. Use the “Load Local Dataset” button above.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!Number.isFinite(numericId)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invalid Show</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The requested show id is not valid. Return to the{' '}
            <Link to="/" className="text-primary underline">
              dashboard
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    );
  }

  const show = dataset.shows.find((item) => item?.show_id === numericId) ?? null;
  const score = scores.find((item) => item.showId === numericId) ?? null;

  if (!show) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Show Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            That show isn’t present in the cached dataset. Try loading the full dataset again.
          </p>
        </CardContent>
      </Card>
    );
  }

  const venue = score?.venue || decodeHtmlEntities(show.venuename ?? '') || 'Unknown venue';
  const location = score?.location || decodeHtmlEntities(show.location ?? '') || 'Unknown location';
  const dateLabel = score?.date ?? show.showdate ?? 'Unknown date';

  const showEntries = useMemo(() => {
    if (!dataset?.setlists) return [];
    return dataset.setlists
      .map((entry, index) => ({
        entry,
        index,
        key: createSetlistEntryKey(entry, index)
      }))
      .filter((item) => item.entry?.show_id === numericId);
  }, [dataset, numericId]);

  const groupedSets = useMemo(() => {
    if (showEntries.length === 0) return [];
    const sorted = [...showEntries].sort((a, b) => {
      const metaA = getSetMeta(a.entry);
      const metaB = getSetMeta(b.entry);
      if (metaA.groupOrder !== metaB.groupOrder) return metaA.groupOrder - metaB.groupOrder;
      if (metaA.position !== metaB.position) return metaA.position - metaB.position;
      const nameA = (a.entry?.songname ?? '').toString();
      const nameB = (b.entry?.songname ?? '').toString();
      return nameA.localeCompare(nameB);
    });

    const groups: Array<{ key: string; label: string; entries: ShowEntry[] }> = [];
    for (const item of sorted) {
      const meta = getSetMeta(item.entry);
      let group = groups[groups.length - 1];
      if (!group || group.key !== meta.groupKey) {
        group = { key: meta.groupKey, label: meta.label, entries: [] };
        groups.push(group);
      }
      group.entries.push(item);
    }
    return groups;
  }, [showEntries]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{dateLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Venue</p>
              <p className="font-medium">{venue}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Location</p>
              <p className="font-medium">{location}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Rarity Score</p>
              <p className="font-mono text-primary">{score ? formatNumber(score.rarityScore) : 'N/A'}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Show ID</p>
              <p className="font-mono">{numericId}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Songs Logged</p>
              <p className="font-medium">{score?.entries ?? showEntries.length}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Cached</p>
              <p className="font-medium">
                {dataset.fetchedAt ? new Date(dataset.fetchedAt).toLocaleString() : 'Unknown'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Setlist</CardTitle>
        </CardHeader>
        <CardContent>
          {groupedSets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No setlist entries were recorded for this show.
            </p>
          ) : (
            <div className="space-y-6">
              {groupedSets.map((group) => (
                <div key={group.key} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{group.label}</Badge>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {group.entries.length} song{group.entries.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ol className="space-y-2">
                    {group.entries.map((item, idx) => {
                      const entry = item.entry;
                      const songName =
                        typeof entry?.songname === 'string' && entry.songname.trim().length > 0
                          ? entry.songname
                          : 'Unknown Song';
                      const footnote =
                        typeof entry?.footnote === 'string' && entry.footnote.trim().length > 0
                          ? entry.footnote.trim()
                          : null;
                      const transition =
                        typeof entry?.transition === 'string' && entry.transition.trim().length > 0
                          ? entry.transition.trim()
                          : null;
                      const isSegueArrow = Boolean(transition && /[>→↠↣]/.test(transition));
                      const transitionLabel = isSegueArrow ? null : transition;
                      const duration = formatDuration(entry?.tracktime);
                      const rarity = songDetails[item.key];
                      const weightLabel = rarity ? formatNumber(rarity.normalized) : null;
                      const usageLabel = rarity ? formatPercentage(rarity.percentage) : null;
                      const playsLabel =
                        rarity && rarity.plays > 0
                          ? `${rarity.plays.toLocaleString()} play${rarity.plays === 1 ? '' : 's'}`
                          : null;
                      const firstPlayedLabel = rarity?.firstDate ? formatFirstPlayed(rarity.firstDate) : null;
                      return (
                        <React.Fragment key={item.key}>
                          <li className="rounded-md border bg-card/70 p-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="font-medium">{songName}</span>
                              {transitionLabel ? (
                                <span className="text-xs uppercase text-muted-foreground">{transitionLabel}</span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {duration ? <span>{duration}</span> : null}
                              {weightLabel ? (
                                <span className="font-mono text-primary">Wt {weightLabel}</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            {usageLabel ? <span>Usage {usageLabel}</span> : null}
                            {playsLabel ? <span>{playsLabel}</span> : null}
                            {firstPlayedLabel ? <span>FTP {firstPlayedLabel}</span> : null}
                            {rarity ? (
                              <span>{rarity.isCover ? 'Cover · 50% weight' : 'Original'}</span>
                            ) : null}
                          </div>
                          {footnote ? (
                            <p className="mt-2 text-xs text-muted-foreground">{footnote}</p>
                          ) : null}
                          </li>
                          {isSegueArrow && idx < group.entries.length - 1 ? (
                            <div className="flex justify-center py-1">
                              <span className="sr-only">Segue into next song</span>
                              <span aria-hidden="true" className="text-lg text-muted-foreground">
                                ↓
                              </span>
                            </div>
                          ) : null}
                        </React.Fragment>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
};

export default App;
