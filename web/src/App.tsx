import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ArrowLeft, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Select } from './components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { clearDataset, loadDataset, saveDataset, GooseDataset } from './lib/cache';
import {
  computeRarityScores,
  RarityScore,
  createSetlistEntryKey,
  SongRarityDetail,
  SongAggregate
} from './lib/rarity';

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

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

function parseDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const tryParse = (input: string) => {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? undefined : date;
  };
  let parsed = tryParse(value);
  if (!parsed && !String(value).includes('T')) {
    parsed = tryParse(`${value}T00:00:00Z`);
  }
  return parsed;
}

function formatDateDisplay(value?: string | null): string {
  if (!value) return 'Unknown';
  const date = parseDate(value);
  if (!date) return String(value);
  return dateFormatter.format(date);
}

function formatDateTimeDisplay(value?: string | null): string {
  if (!value) return 'Unknown';
  const date = parseDate(value);
  if (!date) return String(value);
  return dateTimeFormatter.format(date);
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

function weightColorClass(value: number | null): string {
  if (value == null) return 'text-muted-foreground';
  if (value >= 0.8) return 'text-emerald-500';
  if (value >= 0.6) return 'text-lime-500';
  if (value >= 0.4) return 'text-amber-500';
  return 'text-rose-500';
}

const localeCollator = new Intl.Collator(undefined, { sensitivity: 'base', ignorePunctuation: true });

function sortCoverArtists(items: CoverArtistDetail[], sort: CoverArtistSortState): CoverArtistDetail[] {
  const getNumeric = (value: number | undefined | null) => (value == null ? Number.NaN : Number(value));

  const getDateValue = (value: string | undefined) => {
    if (!value) return Number.NaN;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? Number.NaN : date.getTime();
  };

  const comparator = (a: CoverArtistDetail, b: CoverArtistDetail) => {
    let result = 0;
    switch (sort.key) {
      case 'name':
        result = localeCollator.compare(a.name, b.name);
        break;
      case 'uniqueSongs':
        result = getNumeric(a.uniqueSongs) - getNumeric(b.uniqueSongs);
        break;
      case 'uniqueShows':
        result = getNumeric(a.uniqueShows) - getNumeric(b.uniqueShows);
        break;
      case 'firstDate':
        result = getDateValue(a.firstDate) - getDateValue(b.firstDate);
        break;
      case 'lastDate':
        result = getDateValue(a.lastDate) - getDateValue(b.lastDate);
        break;
      case 'totalCovers':
      default:
        result = getNumeric(a.totalCovers) - getNumeric(b.totalCovers);
        break;
    }

    if (!Number.isFinite(result) || result === 0) {
      const fallback = localeCollator.compare(a.name, b.name);
      result = fallback !== 0 ? fallback : 0;
    }

    return sort.direction === 'asc' ? result : -result;
  };

  return [...items].sort(comparator);
}

function sortCoverArtistSongs(items: CoverArtistSongSummary[], sort: CoverArtistSongSortState): CoverArtistSongSummary[] {
  const getNumeric = (value: number | undefined | null) => (value == null ? Number.NaN : Number(value));
  const getDateValue = (value: string | undefined) => {
    if (!value) return Number.NaN;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? Number.NaN : parsed.getTime();
  };

  const comparator = (a: CoverArtistSongSummary, b: CoverArtistSongSummary) => {
    let result = 0;
    switch (sort.key) {
      case 'name':
        result = localeCollator.compare(a.name, b.name);
        break;
      case 'coverCount':
        result = getNumeric(a.coverCount) - getNumeric(b.coverCount);
        break;
      case 'uniqueShows':
        result = getNumeric(a.uniqueShows) - getNumeric(b.uniqueShows);
        break;
      case 'firstDate':
        result = getDateValue(a.firstDate) - getDateValue(b.firstDate);
        break;
      case 'lastDate':
        result = getDateValue(a.lastDate) - getDateValue(b.lastDate);
        break;
      case 'averageRarity':
      default: {
        const aValue = getNumeric(a.averageRarity);
        const bValue = getNumeric(b.averageRarity);
        result = aValue - bValue;
        break;
      }
    }

    if (!Number.isFinite(result) || result === 0) {
      result = localeCollator.compare(a.name, b.name);
    }

    return sort.direction === 'asc' ? result : -result;
  };

  return [...items].sort(comparator);
}

function parseDurationToSeconds(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const trimmed = value.trim();
  if (trimmed.length === 0) return Number.NaN;
  const parts = trimmed.split(':').map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return Number.NaN;
  let total = 0;
  for (const part of parts) {
    total = total * 60 + part;
  }
  return total;
}

type SongOccurrenceRow = {
  entry: any;
  detail: SongRarityDetail;
  show: any;
  displayDate: string;
  dateValue: number;
  setLabel: string;
  duration: string | null;
  durationSeconds: number;
  showLabel: string;
};

function sortSongOccurrences(items: SongOccurrenceRow[], sort: SongOccurrenceSortState): SongOccurrenceRow[] {
  const comparator = (a: SongOccurrenceRow, b: SongOccurrenceRow) => {
    let result = 0;
    switch (sort.key) {
      case 'show':
        result = localeCollator.compare(a.showLabel, b.showLabel);
        break;
      case 'set':
        result = localeCollator.compare(a.setLabel, b.setLabel);
        break;
      case 'duration':
        result = a.durationSeconds - b.durationSeconds;
        break;
      case 'date':
      default:
        result = a.dateValue - b.dateValue;
        break;
    }

    if (!Number.isFinite(result) || result === 0) {
      result = b.detail.key.localeCompare(a.detail.key);
    }

    return sort.direction === 'asc' ? result : -result;
  };

  return [...items].sort(comparator);
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

const UNKNOWN_COVER_ARTIST_LABEL = 'Unknown Artist';

function normalizeCoverArtistName(value: string | null | undefined): string {
  const decoded = decodeHtmlEntities(value ?? '');
  const trimmed = decoded.trim();
  return trimmed.length > 0 ? trimmed : UNKNOWN_COVER_ARTIST_LABEL;
}

function canonicalizeCoverArtistKey(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : UNKNOWN_COVER_ARTIST_LABEL.toLowerCase();
}

function buildCoverArtistPath(name: string): string {
  return `/covers/${encodeURIComponent(canonicalizeCoverArtistKey(name))}`;
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
  filtersPending: boolean;
  onSelectShow: (showId: number) => void;
}

interface ShowDetailProps {
  dataset: GooseDataset | null;
  scores: RarityScore[];
  songDetails: Record<string, SongRarityDetail>;
  coverArtists: CoverArtistMap;
}

type ShowEntry = {
  entry: any;
  index: number;
  key: string;
};

interface SongDetailProps {
  dataset: GooseDataset | null;
  songDetails: Record<string, SongRarityDetail>;
  songAggregates: Record<string, SongAggregate>;
  scores: RarityScore[];
  coverArtists: CoverArtistMap;
}

interface CoverArtistIndexProps {
  artists: CoverArtistDetail[];
}

interface CoverArtistPageProps {
  artists: CoverArtistMap;
}

type SortDirection = 'asc' | 'desc';
type CoverArtistSortKey = 'name' | 'uniqueSongs' | 'uniqueShows' | 'firstDate' | 'lastDate' | 'totalCovers';
type CoverArtistSongSortKey = 'name' | 'coverCount' | 'uniqueShows' | 'firstDate' | 'lastDate' | 'averageRarity';
type SongOccurrenceSortKey = 'date' | 'show' | 'set' | 'duration';

interface CoverArtistSortState {
  key: CoverArtistSortKey;
  direction: SortDirection;
}

interface CoverArtistSongSortState {
  key: CoverArtistSongSortKey;
  direction: SortDirection;
}

interface SongOccurrenceSortState {
  key: SongOccurrenceSortKey;
  direction: SortDirection;
}

type EntryDetail = {
  itemKey: string;
  songName: string;
  footnote: string | null;
  transitionLabel: string | null;
  duration: string | null;
  weightLabel: string | null;
  weightNormalized: number | null;
  coverLabel: string | null;
  coverArtistName: string | null;
  coverArtistKey: string | null;
  songKeyRef?: string;
  isSegueArrow: boolean;
};

interface CoverArtistSongSummary {
  songKey: string;
  name: string;
  coverCount: number;
  uniqueShows: number;
  averageRarity: number | null;
  firstDate?: string;
  lastDate?: string;
}

interface CoverArtistDetail {
  key: string;
  name: string;
  totalCovers: number;
  uniqueShows: number;
  uniqueSongs: number;
  firstDate?: string;
  lastDate?: string;
  songs: CoverArtistSongSummary[];
}

type CoverArtistMap = Record<string, CoverArtistDetail>;

const App: React.FC = () => {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<GooseDataset | null>(null);
  const [yearFilter, setYearFilter] = useState<YearOption>('all');
  const [venueFilter, setVenueFilter] = useState('');
  const [limit, setLimit] = useState(10);
  const [filtersPending, startFilterTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const handleYearFilterChange = useCallback(
    (value: YearOption) => {
      startFilterTransition(() => {
        setYearFilter(value);
      });
    },
    [startFilterTransition]
  );

  const handleVenueFilterChange = useCallback(
    (value: string) => {
      startFilterTransition(() => {
        setVenueFilter(value);
      });
    },
    [startFilterTransition]
  );

  const handleLimitChange = useCallback(
    (value: number) => {
      const numeric = Number.isFinite(value) ? value : 1;
      startFilterTransition(() => {
        setLimit(Math.max(1, Math.floor(numeric)));
      });
    },
    [startFilterTransition]
  );

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

  const { scores, skipped, songDetails, songAggregates } = useMemo(() => {
    if (!dataset) return { scores: [], skipped: [], songDetails: {}, songAggregates: {} };
    return computeRarityScores({ shows: dataset.shows, setlists: dataset.setlists });
  }, [dataset]);

  const { coverArtistsList, coverArtistMap } = useMemo(() => {
    if (!dataset) return { coverArtistsList: [] as CoverArtistDetail[], coverArtistMap: {} as CoverArtistMap };
    const shows = dataset.shows ?? [];
    const setlists = dataset.setlists ?? [];
    if (setlists.length === 0) {
      return { coverArtistsList: [] as CoverArtistDetail[], coverArtistMap: {} as CoverArtistMap };
    }

    const showDateMap = new Map<number, Date>();
    for (const show of shows) {
      if (show?.show_id == null) continue;
      const date = parseDate(show.showdate ?? null);
      if (date) {
        showDateMap.set(show.show_id, date);
      }
    }

    type SongAccumulator = {
      songKey: string;
      name: string;
      coverCount: number;
      totalRarity: number;
      firstDate?: number;
      lastDate?: number;
      showIds: Set<number>;
    };

    type ArtistAccumulator = {
      key: string;
      name: string;
      totalCovers: number;
      firstDate?: number;
      lastDate?: number;
      showIds: Set<number>;
      songs: Map<string, SongAccumulator>;
    };

    const artistMap = new Map<string, ArtistAccumulator>();

    setlists.forEach((entry, index) => {
      const entryKey = createSetlistEntryKey(entry, index);
      const detail = songDetails[entryKey];
      if (!detail?.isCover) return;
      const artistName = normalizeCoverArtistName(entry?.original_artist);
      if (artistName.toLowerCase() === UNKNOWN_COVER_ARTIST_LABEL.toLowerCase()) {
        return;
      }
      const artistKey = canonicalizeCoverArtistKey(artistName);
      let artist = artistMap.get(artistKey);
      if (!artist) {
        artist = {
          key: artistKey,
          name: artistName,
          totalCovers: 0,
          showIds: new Set<number>(),
          songs: new Map<string, SongAccumulator>()
        };
        artistMap.set(artistKey, artist);
      }

      const showId = detail.showId ?? (entry?.show_id != null ? Number(entry.show_id) : undefined);
      if (showId != null) {
        artist.showIds.add(showId);
      }

      const entryDate =
        parseDate(entry?.showdate ?? null) ?? (showId != null ? showDateMap.get(showId) : undefined);
      const dateValue = entryDate ? entryDate.getTime() : undefined;
      if (dateValue != null) {
        artist.firstDate = artist.firstDate == null || dateValue < artist.firstDate ? dateValue : artist.firstDate;
        artist.lastDate = artist.lastDate == null || dateValue > artist.lastDate ? dateValue : artist.lastDate;
      }

      const songKeyValue = detail.songKey;
      const aggregate = songAggregates[songKeyValue];
      const displayName =
        aggregate?.name ??
        (typeof entry?.songname === 'string' && entry.songname.trim().length > 0
          ? entry.songname
          : 'Unknown Song');

      let song = artist.songs.get(songKeyValue);
      if (!song) {
        song = {
          songKey: songKeyValue,
          name: displayName,
          coverCount: 0,
          totalRarity: 0,
          showIds: new Set<number>()
        };
        artist.songs.set(songKeyValue, song);
      }

      song.coverCount += 1;
      song.totalRarity += detail.normalized ?? 0;
      if (showId != null) song.showIds.add(showId);
      if (dateValue != null) {
        song.firstDate = song.firstDate == null || dateValue < song.firstDate ? dateValue : song.firstDate;
        song.lastDate = song.lastDate == null || dateValue > song.lastDate ? dateValue : song.lastDate;
      }

      artist.totalCovers += 1;
    });

    const coverArtists: CoverArtistDetail[] = [];
    for (const artist of artistMap.values()) {
      const songs: CoverArtistSongSummary[] = [];
      for (const song of artist.songs.values()) {
        songs.push({
          songKey: song.songKey,
          name: song.name,
          coverCount: song.coverCount,
          uniqueShows: song.showIds.size,
          averageRarity: song.coverCount > 0 ? song.totalRarity / song.coverCount : null,
          firstDate: song.firstDate != null ? new Date(song.firstDate).toISOString() : undefined,
          lastDate: song.lastDate != null ? new Date(song.lastDate).toISOString() : undefined
        });
      }
      songs.sort((a, b) => {
        if (b.coverCount !== a.coverCount) return b.coverCount - a.coverCount;
        return a.name.localeCompare(b.name);
      });

      coverArtists.push({
        key: artist.key,
        name: artist.name,
        totalCovers: artist.totalCovers,
        uniqueShows: artist.showIds.size,
        uniqueSongs: songs.length,
        firstDate: artist.firstDate != null ? new Date(artist.firstDate).toISOString() : undefined,
        lastDate: artist.lastDate != null ? new Date(artist.lastDate).toISOString() : undefined,
        songs
      });
    }

    coverArtists.sort((a, b) => {
      if (b.totalCovers !== a.totalCovers) return b.totalCovers - a.totalCovers;
      return a.name.localeCompare(b.name);
    });

    const map: CoverArtistMap = {};
    for (const artist of coverArtists) {
      map[artist.key] = artist;
    }

    return { coverArtistsList: coverArtists, coverArtistMap: map };
  }, [dataset, songDetails, songAggregates]);

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
                onYearFilterChange={handleYearFilterChange}
                venueFilter={venueFilter}
                onVenueFilterChange={handleVenueFilterChange}
                limit={limit}
                onLimitChange={handleLimitChange}
                filteredScores={filteredScores}
                limitedScores={limitedScores}
                averageScore={averageScore}
                omittedCount={omittedCount}
                filtersPending={filtersPending}
                onSelectShow={(showId) => navigate(`/shows/${showId}`)}
              />
            }
          />
          <Route
            path="/covers"
            element={<CoverArtistIndex artists={coverArtistsList} />}
          />
          <Route
            path="/covers/:artistKey"
            element={<CoverArtistPage artists={coverArtistMap} />}
          />
          <Route
            path="/shows/:showId"
            element={
              <ShowDetail
                dataset={dataset}
                scores={scores}
                songDetails={songDetails}
                coverArtists={coverArtistMap}
              />
            }
          />
          <Route
            path="/songs/:songKey"
            element={
              <SongDetailPage
                dataset={dataset}
                songDetails={songDetails}
                songAggregates={songAggregates}
                scores={scores}
                coverArtists={coverArtistMap}
              />
            }
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
  filtersPending,
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
              <Badge variant="secondary">Updated {formatDateTimeDisplay(dataset.fetchedAt)}</Badge>
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
                {filtersPending ? (
                  <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating filters…
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <Link
              to="/covers"
              className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Browse &amp; search cover artists
            </Link>
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
            <div className="overflow-x-auto table-wrapper">
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
                <tbody className="divide-y divide-border bg-card" aria-busy={filtersPending}>
                  {limitedScores.map((score, index) => (
                    <tr
                      key={score.showId}
                      className="group table-row-virtual cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      onClick={() => onSelectShow(score.showId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectShow(score.showId);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${formatDateDisplay(score.date)} at ${score.venue || 'Unknown venue'}`}
                    >
                      <td className="px-4 py-2 text-left font-medium">{index + 1}</td>
                      <td className="px-4 py-2 text-primary">{formatDateDisplay(score.date)}</td>
                      <td className="px-4 py-2 text-primary">{score.venue || 'Unknown venue'}</td>
                      <td className="px-4 py-2">{score.location || 'Unknown location'}</td>
                      <td
                        className={`px-4 py-2 text-right font-mono ${weightColorClass(score.normalizedScore)}`}
                      >
                        {formatNumber(score.rarityScore)}
                      </td>
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

const ShowDetail: React.FC<ShowDetailProps> = ({ dataset, scores, songDetails, coverArtists }) => {
  const { showId } = useParams<{ showId: string }>();
  const numericId = Number.parseInt(String(showId ?? ''), 10);
  const navigateTo = useNavigate();

  const showEntries = useMemo(() => {
    if (!dataset?.setlists || !Number.isFinite(numericId)) return [];
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
  const rawShowDate = score?.date ?? show.showdate ?? null;
  const dateLabel = formatDateDisplay(rawShowDate);

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
              <p
                className={`font-mono ${
                  score ? weightColorClass(score.normalizedScore) : 'text-muted-foreground'
                }`}
              >
                {score ? formatNumber(score.rarityScore) : 'N/A'}
              </p>
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
                {dataset.fetchedAt ? formatDateTimeDisplay(dataset.fetchedAt) : 'Unknown'}
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
              {groupedSets.map((group) => {
                const entryDetails: EntryDetail[] = group.entries.map((item) => {
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
                  const weightNormalized = rarity?.normalized ?? null;
                  const weightLabel = weightNormalized != null ? formatNumber(weightNormalized) : null;
                  const songKeyRef = rarity?.songKey;
                  const isCoverEntry = Boolean(rarity?.isCover);
                  const coverArtistNameRaw =
                    isCoverEntry ? normalizeCoverArtistName(entry?.original_artist ?? null) : null;
                  const coverArtistKey = coverArtistNameRaw
                    ? canonicalizeCoverArtistKey(coverArtistNameRaw)
                    : null;
                  const artistMeta = coverArtistKey ? coverArtists[coverArtistKey] : undefined;
                  const coverArtistResolved = artistMeta?.name ?? coverArtistNameRaw;
                  const isUnknownCoverArtist =
                    (coverArtistResolved ?? '').toLowerCase() === UNKNOWN_COVER_ARTIST_LABEL.toLowerCase();
                  const coverArtistName = isUnknownCoverArtist ? null : coverArtistResolved;
                  const coverArtistKeyResolved = isUnknownCoverArtist ? null : artistMeta?.key ?? coverArtistKey;
                  const coverLabel = isCoverEntry ? 'Cover' : null;
                  return {
                    itemKey: item.key,
                    songName,
                    footnote,
                    transitionLabel,
                    duration,
                    weightLabel,
                    weightNormalized,
                    coverLabel,
                    coverArtistName,
                    coverArtistKey: coverArtistKeyResolved,
                    songKeyRef,
                    isSegueArrow
                  };
                });

                const segments: Array<{ entries: EntryDetail[]; isRun: boolean }> = [];
                let buffer: EntryDetail[] = [];
                let bufferHasSegue = false;

                entryDetails.forEach((detail) => {
                  buffer.push(detail);
                  if (detail.isSegueArrow) bufferHasSegue = true;
                  if (!detail.isSegueArrow) {
                    segments.push({ entries: buffer, isRun: bufferHasSegue });
                    buffer = [];
                    bufferHasSegue = false;
                  }
                });
                if (buffer.length > 0) {
                  segments.push({ entries: buffer, isRun: bufferHasSegue });
                }

                const renderRow = (detail: EntryDetail) => {
                  const isSongLink = Boolean(detail.songKeyRef);
                  const handleClick = () => {
                    if (!isSongLink || !detail.songKeyRef) return;
                    navigateTo(`/songs/${encodeURIComponent(detail.songKeyRef)}`);
                  };
                  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
                    if (!isSongLink || !detail.songKeyRef) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigateTo(`/songs/${encodeURIComponent(detail.songKeyRef)}`);
                    }
                  };
                  const linkClasses = isSongLink
                    ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:border-primary/70'
                    : '';
                  return (
                    <div
                      className={`rounded-md border bg-card/70 p-3 ${linkClasses}`}
                      onClick={isSongLink ? handleClick : undefined}
                      onKeyDown={handleKeyDown}
                      role={isSongLink ? 'button' : undefined}
                      tabIndex={isSongLink ? 0 : -1}
                      aria-label={isSongLink ? `View song stats` : undefined}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium">{detail.songName}</span>
                          {detail.duration ? (
                            <span className="text-xs text-muted-foreground">({detail.duration})</span>
                          ) : null}
                          {detail.transitionLabel ? (
                            <span className="text-xs uppercase text-muted-foreground">{detail.transitionLabel}</span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {detail.weightLabel ? (
                            <span className={`font-mono ${weightColorClass(detail.weightNormalized)}`}>
                              Rarity {detail.weightLabel}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {detail.coverArtistName ? (
                          <span>
                            {(detail.coverLabel ?? 'Cover')} of{' '}
                            <Link
                              to={buildCoverArtistPath(detail.coverArtistName)}
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.stopPropagation();
                                }
                              }}
                              className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                              {detail.coverArtistName}
                            </Link>
                          </span>
                        ) : detail.coverLabel ? (
                          <span>{detail.coverLabel}</span>
                        ) : null}
                      </div>
                      {detail.footnote ? (
                        <p className="mt-2 text-xs text-muted-foreground">{detail.footnote}</p>
                      ) : null}
                    </div>
                  );
                };

                const renderArrow = (key: string) => (
                  <div key={key} className="flex justify-center py-0.5">
                    <span className="sr-only">Segue into next song</span>
                    <span aria-hidden="true" className="text-sm text-muted-foreground">
                      ↓
                    </span>
                  </div>
                );

                return (
                  <div key={group.key} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{group.label}</Badge>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {group.entries.length} song{group.entries.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {segments.map((segment, segmentIndex) => {
                        if (segment.isRun && segment.entries.length > 1) {
                          return (
                            <div
                              key={`${group.key}-segment-${segmentIndex}`}
                              className="rounded-lg border border-primary/40 bg-primary/5 p-2"
                            >
                              {segment.entries.map((detail, entryIndex) => (
                                <React.Fragment key={detail.itemKey}>
                                  {renderRow(detail)}
                                  {detail.isSegueArrow && entryIndex < segment.entries.length - 1
                                    ? renderArrow(`${detail.itemKey}-arrow`)
                                    : null}
                                </React.Fragment>
                              ))}
                            </div>
                          );
                        }
                        return (
                          segment.entries.map((detail, entryIndex) => (
                            <React.Fragment key={detail.itemKey}>
                              {renderRow(detail)}
                              {detail.isSegueArrow && entryIndex < segment.entries.length - 1
                                ? renderArrow(`${detail.itemKey}-arrow`)
                                : null}
                            </React.Fragment>
                          ))
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
};

export default App;

const SongDetailPage: React.FC<SongDetailProps> = ({ dataset, songDetails, songAggregates, scores, coverArtists }) => {
  const { songKey: encodedSongKey } = useParams<{ songKey: string }>();
  const songKeyValue = encodedSongKey ? decodeURIComponent(encodedSongKey) : null;
  const navigate = useNavigate();

  const showMap = useMemo(() => {
    const map = new Map<number, any>();
    if (!dataset?.shows) return map;
    for (const show of dataset.shows) {
      if (show?.show_id != null) map.set(show.show_id, show);
    }
    return map;
  }, [dataset]);

  const scoreByShow = useMemo(() => {
    const map = new Map<number, RarityScore>();
    for (const score of scores) {
      map.set(score.showId, score);
    }
    return map;
  }, [scores]);

  const occurrences = useMemo(() => {
    if (!dataset?.setlists || !songKeyValue) return [] as SongOccurrenceRow[];
    const items: SongOccurrenceRow[] = [];
    dataset.setlists.forEach((entry, index) => {
      const entryKey = createSetlistEntryKey(entry, index);
      const detail = songDetails[entryKey];
      if (!detail || detail.songKey !== songKeyValue) return;
      const show = entry?.show_id != null ? showMap.get(entry.show_id) : undefined;
      const dateRaw = entry?.showdate ?? show?.showdate ?? null;
      const parsed =
        dateRaw && !String(dateRaw).includes('T')
          ? new Date(`${dateRaw}T00:00:00Z`)
          : dateRaw
            ? new Date(dateRaw)
            : null;
      const dateValue = parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : Number.NEGATIVE_INFINITY;
      const setMeta = getSetMeta(entry);
      const venue = show ? decodeHtmlEntities(show.venuename ?? '') : '';
      const location = show ? decodeHtmlEntities(show.location ?? '') : '';
      const showLabel =
        [venue, location]
          .map((part) => (typeof part === 'string' ? part.trim() : ''))
          .filter((part) => part.length > 0)
          .join(' • ') || 'Unknown venue';
      const prettyDuration = formatDuration(entry?.tracktime);
      items.push({
        entry,
        detail,
        show,
        displayDate: formatDateDisplay(dateRaw),
        dateValue,
        setLabel: setMeta.label,
        duration: prettyDuration,
        durationSeconds: parseDurationToSeconds(prettyDuration),
        showLabel
      });
    });
    items.sort((a, b) => {
      if (a.dateValue === b.dateValue) return 0;
      return b.dateValue - a.dateValue;
    });
    return items;
  }, [dataset, showMap, songDetails, songKeyValue]);

  const coverArtistEntries = useMemo(() => {
    const entriesMap = new Map<string, string>();
    occurrences.forEach((item) => {
      if (!item.detail.isCover) return;
      const artistName = normalizeCoverArtistName(item.entry?.original_artist ?? null);
      if (artistName.toLowerCase() === UNKNOWN_COVER_ARTIST_LABEL.toLowerCase()) return;
      const key = canonicalizeCoverArtistKey(artistName);
      const artistDetail = coverArtists[key];
      entriesMap.set(key, artistDetail?.name ?? artistName);
    });
    return Array.from(entriesMap.entries()).map(([key, name]) => ({ key, name }));
  }, [occurrences, coverArtists]);

  const [occurrenceSort, setOccurrenceSort] = useState<SongOccurrenceSortState>({
    key: 'date',
    direction: 'desc'
  });
  const [occurrencePending, startOccurrenceTransition] = useTransition();

  const updateOccurrenceSort = useCallback(
    (key: SongOccurrenceSortKey, defaultDirection: SortDirection) => {
      startOccurrenceTransition(() => {
        setOccurrenceSort((prev) => {
          if (prev.key === key) {
            return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
          }
          return { key, direction: defaultDirection };
        });
      });
    },
    [startOccurrenceTransition]
  );

  const sortedOccurrences = useMemo(
    () => sortSongOccurrences(occurrences, occurrenceSort),
    [occurrences, occurrenceSort]
  );

  const aggregate = songKeyValue ? songAggregates[songKeyValue] : undefined;

  if (!dataset) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Load Dataset</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Load the cached dataset to explore song analytics. Use the “Load Local Dataset” button above.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!songKeyValue) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Song Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The requested song identifier is missing or invalid. Try selecting a song from the show view.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!aggregate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Song Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This song does not appear in the cached dataset. Load the latest dataset and try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  const displayName =
    aggregate.name ??
    occurrences.find((item) => typeof item.entry?.songname === 'string')?.entry?.songname ??
    'Unknown Song';

  const totalEntries = occurrences.length;
  const averageWeight =
    totalEntries > 0
      ? occurrences.reduce((acc, item) => acc + (item.detail.normalized ?? 0), 0) / totalEntries
      : null;
  const coverLabel =
    aggregate.coverCount > 0 && aggregate.originalCount > 0
      ? `${aggregate.coverCount.toLocaleString()} covers / ${aggregate.originalCount.toLocaleString()} originals`
      : aggregate.coverCount > 0
        ? `${aggregate.coverCount.toLocaleString()} cover appearance${aggregate.coverCount === 1 ? '' : 's'}`
        : `${aggregate.originalCount.toLocaleString()} original appearance${aggregate.originalCount === 1 ? '' : 's'}`;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{displayName}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Shows Played</p>
              <p className="font-medium">{aggregate.plays.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Usage Since Debut</p>
              <p className="font-medium">{formatPercentage(aggregate.percentage)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Rarity</p>
              <p className={`font-mono ${weightColorClass(averageWeight)}`}>
                {averageWeight != null ? formatNumber(averageWeight) : '—'}
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground">First Played</p>
              <p className="font-medium">{formatDateDisplay(aggregate.firstDate ?? null)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Cover / Original</p>
              <div className="space-y-1">
                <p className="font-medium">{coverLabel}</p>
                {coverArtistEntries.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Covered from{' '}
                    {coverArtistEntries.map((artist, index) => (
                      <React.Fragment key={artist.key}>
                        {index > 0 ? ', ' : null}
                        <Link
                          to={`/covers/${encodeURIComponent(artist.key)}`}
                          className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                          {artist.name}
                        </Link>
                      </React.Fragment>
                    ))}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearances</CardTitle>
        </CardHeader>
        <CardContent>
          {occurrences.length === 0 ? (
            <p className="text-sm text-muted-foreground">No performances recorded for this song.</p>
          ) : (
            <div className="overflow-x-auto table-wrapper">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th
                      className="px-4 py-2 text-left font-medium"
                      aria-sort={occurrenceSort.key === 'date' ? `${occurrenceSort.direction}ending` : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => updateOccurrenceSort('date', 'desc')}
                        className="flex items-center gap-1"
                      >
                        <span>Date</span>
                        <span aria-hidden="true" className="text-xs text-muted-foreground">
                          {occurrenceSort.key === 'date'
                            ? occurrenceSort.direction === 'asc'
                              ? '▲'
                              : '▼'
                            : ''}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-2 text-left font-medium"
                      aria-sort={occurrenceSort.key === 'show' ? `${occurrenceSort.direction}ending` : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => updateOccurrenceSort('show', 'asc')}
                        className="flex items-center gap-1"
                      >
                        <span>Show</span>
                        <span aria-hidden="true" className="text-xs text-muted-foreground">
                          {occurrenceSort.key === 'show'
                            ? occurrenceSort.direction === 'asc'
                              ? '▲'
                              : '▼'
                            : ''}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-2 text-left font-medium"
                      aria-sort={occurrenceSort.key === 'set' ? `${occurrenceSort.direction}ending` : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => updateOccurrenceSort('set', 'asc')}
                        className="flex items-center gap-1"
                      >
                        <span>Set</span>
                        <span aria-hidden="true" className="text-xs text-muted-foreground">
                          {occurrenceSort.key === 'set'
                            ? occurrenceSort.direction === 'asc'
                              ? '▲'
                              : '▼'
                            : ''}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-2 text-right font-medium"
                      aria-sort={occurrenceSort.key === 'duration' ? `${occurrenceSort.direction}ending` : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => updateOccurrenceSort('duration', 'desc')}
                        className="flex w-full items-center justify-end gap-1"
                      >
                        <span>Duration</span>
                        <span aria-hidden="true" className="text-xs text-muted-foreground">
                          {occurrenceSort.key === 'duration'
                            ? occurrenceSort.direction === 'asc'
                              ? '▲'
                              : '▼'
                            : ''}
                        </span>
                      </button>
                    </th>
                    <th className="px-4 py-2 text-left font-medium">Show Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card" aria-busy={occurrencePending}>
                  {sortedOccurrences.map((item) => {
                    const showId = item.entry?.show_id;
                    const score = showId != null ? scoreByShow.get(showId) : undefined;
                    const showNotes =
                      typeof item.entry?.shownotes === 'string' && item.entry.shownotes.trim().length > 0
                        ? item.entry.shownotes.trim()
                        : null;
                    const handleRowClick = () => {
                      if (showId != null) navigate(`/shows/${showId}`);
                    };
                    const handleRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                      if (showId == null) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/shows/${showId}`);
                      }
                    };
                    const rowClass = `${
                      showId != null
                        ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background '
                        : ''
                    }table-row-virtual hover:bg-muted/50`;
                    return (
                      <tr
                        key={item.detail.key}
                        className={rowClass}
                        onClick={showId != null ? handleRowClick : undefined}
                        onKeyDown={handleRowKeyDown}
                      role={showId != null ? 'button' : undefined}
                      tabIndex={showId != null ? 0 : -1}
                      aria-label={
                        showId != null
                          ? `Open show ${item.displayDate} at ${item.showLabel}`
                          : undefined
                      }
                    >
                      <td className="px-4 py-2 font-medium text-primary">{item.displayDate}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {item.showLabel}
                        {score ? (
                          <span className={`ml-2 text-xs font-mono ${weightColorClass(score.normalizedScore)}`}>
                            Rarity {formatNumber(score.rarityScore)}
                          </span>
                        ) : null}
                        </td>
                        <td className="px-4 py-2">{item.setLabel}</td>
                        <td className="px-4 py-2 text-right">{item.duration ?? '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {showNotes ? <span>{showNotes}</span> : <span className="italic text-xs">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
};

const CoverArtistIndex: React.FC<CoverArtistIndexProps> = ({ artists }) => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [sort, setSort] = useState<CoverArtistSortState>({ key: 'totalCovers', direction: 'desc' });
  const [isPending, startTransition] = useTransition();

  const filteredArtists = useMemo(() => {
    const trimmed = searchTerm.trim();
    if (trimmed.length === 0) return artists;
    const query = trimmed.toLowerCase();
    return artists.filter((artist) => artist.name.toLowerCase().includes(query));
  }, [artists, searchTerm]);

  const sortedArtists = useMemo(
    () => sortCoverArtists(filteredArtists, sort),
    [filteredArtists, sort]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      startTransition(() => {
        setSearchTerm(value);
      });
    },
    [startTransition]
  );

  const handleSort = useCallback(
    (key: CoverArtistSortKey) => {
      startTransition(() => {
        setSort((prev) => {
          if (prev.key === key) {
            return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
          }
          if (key === 'name') {
            return { key, direction: 'asc' };
          }
          return { key, direction: 'desc' };
        });
      });
    },
    [startTransition]
  );

  const renderSortHeader = (label: string, key: CoverArtistSortKey, align: 'left' | 'right' = 'left') => {
    const isActive = sort.key === key;
    const direction = isActive ? sort.direction : undefined;
    const indicator = direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '';
    return (
      <button
        type="button"
        onClick={() => handleSort(key)}
        className={`flex w-full items-center gap-1 text-sm font-medium ${
          align === 'right' ? 'justify-end' : 'justify-start'
        }`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-xs text-muted-foreground">
          {indicator}
        </span>
      </button>
    );
  };

  if (artists.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cover Artists</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Load the cached dataset to explore covered artists. Use the “Load Local Dataset” button above.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cover Artists</CardTitle>
        <p className="text-sm text-muted-foreground">
          Artists Goose has covered in the cached dataset. Select a row to drill into song appearances.
        </p>
        <div className="mt-4 w-full max-w-sm">
          <Input
            value={searchTerm}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Search artists (e.g. Perpetual Groove)"
            aria-label="Search cover artists"
          />
        </div>
      </CardHeader>
      <CardContent>
        {sortedArtists.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No cover artists match “{searchTerm.trim()}”.
          </p>
        ) : (
          <div className="overflow-x-auto table-wrapper">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th
                    className="px-4 py-2 text-left"
                    aria-sort={sort.key === 'name' ? `${sort.direction}ending` : 'none'}
                  >
                    {renderSortHeader('Artist', 'name')}
                  </th>
                  <th
                    className="px-4 py-2 text-left"
                    aria-sort={sort.key === 'uniqueSongs' ? `${sort.direction}ending` : 'none'}
                  >
                    {renderSortHeader('Songs Covered', 'uniqueSongs')}
                  </th>
                  <th
                    className="px-4 py-2 text-left"
                    aria-sort={sort.key === 'uniqueShows' ? `${sort.direction}ending` : 'none'}
                  >
                    {renderSortHeader('Unique Shows', 'uniqueShows')}
                  </th>
                  <th
                    className="px-4 py-2 text-left"
                    aria-sort={sort.key === 'firstDate' ? `${sort.direction}ending` : 'none'}
                  >
                    {renderSortHeader('First Cover', 'firstDate')}
                  </th>
                  <th
                    className="px-4 py-2 text-left"
                    aria-sort={sort.key === 'lastDate' ? `${sort.direction}ending` : 'none'}
                  >
                    {renderSortHeader('Most Recent', 'lastDate')}
                  </th>
                  <th
                    className="px-4 py-2 text-right"
                    aria-sort={sort.key === 'totalCovers' ? `${sort.direction}ending` : 'none'}
                  >
                    {renderSortHeader('Total Covers', 'totalCovers', 'right')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
              {sortedArtists.map((artist) => {
                const path = `/covers/${encodeURIComponent(artist.key)}`;
                  const handleRowClick = () => navigate(path);
                  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(path);
                    }
                  };
                  return (
                  <tr
                    key={artist.key}
                    className="table-row-virtual cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      onClick={handleRowClick}
                      onKeyDown={handleRowKeyDown}
                      role="button"
                      tabIndex={0}
                      aria-label={`View covers of ${artist.name}`}
                    >
                      <td className="px-4 py-2 font-medium text-primary">{artist.name}</td>
                      <td className="px-4 py-2">{artist.uniqueSongs.toLocaleString()}</td>
                      <td className="px-4 py-2">{artist.uniqueShows.toLocaleString()}</td>
                      <td className="px-4 py-2">{formatDateDisplay(artist.firstDate ?? null)}</td>
                      <td className="px-4 py-2">{formatDateDisplay(artist.lastDate ?? null)}</td>
                      <td className="px-4 py-2 text-right font-mono">{artist.totalCovers.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const CoverArtistPage: React.FC<CoverArtistPageProps> = ({ artists }) => {
  const { artistKey: encodedKey } = useParams<{ artistKey: string }>();
  const navigate = useNavigate();
  const canonicalKey = encodedKey ? decodeURIComponent(encodedKey).toLowerCase() : '';
  const artist = canonicalKey ? artists[canonicalKey] : undefined;

  const [songSort, setSongSort] = useState<CoverArtistSongSortState>({
    key: 'coverCount',
    direction: 'desc'
  });
  const [songPending, startSongTransition] = useTransition();
  const songs = useMemo(() => {
    if (!artist) {
      return [];
    }
    return sortCoverArtistSongs(artist.songs, songSort);
  }, [artist, songSort]);
  const toggleSongSort = useCallback(
    (key: CoverArtistSongSortKey, defaultDirection: SortDirection) => {
      startSongTransition(() => {
        setSongSort((prev) => {
          if (prev.key === key) {
            return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
          }
          return { key, direction: defaultDirection };
        });
      });
    },
    [startSongTransition]
  );

  if (!encodedKey) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cover Artist</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select a cover artist from the list to view their covered songs.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!artist) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cover Artist Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            We could not find that cover artist in the cached dataset. Return to the{' '}
            <Link to="/covers" className="text-primary underline-offset-4 hover:underline">
              cover artist list
            </Link>{' '}
            to pick another artist.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{artist.name} Covers</CardTitle>
          <p className="text-sm text-muted-foreground">
            Goose has performed these {artist.totalCovers.toLocaleString()} cover{artist.totalCovers === 1 ? '' : 's'} of {artist.name}.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Total Covers</p>
              <p className="font-medium">{artist.totalCovers.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Unique Songs</p>
              <p className="font-medium">{artist.uniqueSongs.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Unique Shows</p>
              <p className="font-medium">{artist.uniqueShows.toLocaleString()}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground">First Cover</p>
              <p className="font-medium">{formatDateDisplay(artist.firstDate ?? null)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Most Recent</p>
              <p className="font-medium">{formatDateDisplay(artist.lastDate ?? null)}</p>
            </div>
            <div>
              <Button variant="outline" onClick={() => navigate('/covers')}>
                <ArrowLeft className="mr-2 h-4 w-4" /> All Cover Artists
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Covered Songs</CardTitle>
        </CardHeader>
        <CardContent>
          {songs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cover performances recorded in the dataset.</p>
          ) : (
          <div className="overflow-x-auto table-wrapper">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/50">
                  <tr>
                    <th
                      className="px-4 py-2 text-left font-medium"
                      aria-sort={songSort.key === 'name' ? `${songSort.direction}ending` : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSongSort('name', 'asc')}
                        className="flex items-center gap-1"
                      >
                        <span>Song</span>
                        <span aria-hidden="true" className="text-xs text-muted-foreground">
                          {songSort.key === 'name' ? (songSort.direction === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-2 text-left font-medium"
                      aria-sort={songSort.key === 'coverCount' ? `${songSort.direction}ending` : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSongSort('coverCount', 'desc')}
                        className="flex items-center gap-1"
                      >
                        <span>Covers Logged</span>
                        <span aria-hidden="true" className="text-xs text-muted-foreground">
                          {songSort.key === 'coverCount' ? (songSort.direction === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-2 text-left font-medium"
                      aria-sort={songSort.key === 'uniqueShows' ? `${songSort.direction}ending` : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSongSort('uniqueShows', 'desc')}
                        className="flex items-center gap-1"
                      >
                        <span>Unique Shows</span>
                        <span aria-hidden="true" className="text-xs text-muted-foreground">
                          {songSort.key === 'uniqueShows' ? (songSort.direction === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-2 text-left font-medium"
                      aria-sort={songSort.key === 'firstDate' ? `${songSort.direction}ending` : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSongSort('firstDate', 'desc')}
                        className="flex items-center gap-1"
                      >
                        <span>First Cover</span>
                        <span aria-hidden="true" className="text-xs text-muted-foreground">
                          {songSort.key === 'firstDate' ? (songSort.direction === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-2 text-left font-medium"
                      aria-sort={songSort.key === 'lastDate' ? `${songSort.direction}ending` : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSongSort('lastDate', 'desc')}
                        className="flex items-center gap-1"
                      >
                        <span>Most Recent</span>
                        <span aria-hidden="true" className="text-xs text-muted-foreground">
                          {songSort.key === 'lastDate' ? (songSort.direction === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    </th>
                    <th
                      className="px-4 py-2 text-right font-medium"
                      aria-sort={songSort.key === 'averageRarity' ? `${songSort.direction}ending` : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSongSort('averageRarity', 'desc')}
                        className="flex w-full items-center justify-end gap-1"
                      >
                        <span>Rarity</span>
                        <span aria-hidden="true" className="text-xs text-muted-foreground">
                          {songSort.key === 'averageRarity' ? (songSort.direction === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    </th>
                  </tr>
                </thead>
              <tbody className="divide-y divide-border bg-card" aria-busy={songPending}>
                  {songs.map((song) => {
                    const path = `/songs/${encodeURIComponent(song.songKey)}`;
                    const handleRowClick = () => navigate(path);
                    const handleRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(path);
                      }
                    };
                    return (
                      <tr
                        key={song.songKey}
                        className="table-row-virtual cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        onClick={handleRowClick}
                        onKeyDown={handleRowKeyDown}
                        role="button"
                        tabIndex={0}
                        aria-label={`View performances of ${song.name}`}
                      >
                        <td className="px-4 py-2 font-medium text-primary">{song.name}</td>
                        <td className="px-4 py-2">{song.coverCount.toLocaleString()}</td>
                        <td className="px-4 py-2">{song.uniqueShows.toLocaleString()}</td>
                        <td className="px-4 py-2">{formatDateDisplay(song.firstDate ?? null)}</td>
                        <td className="px-4 py-2">{formatDateDisplay(song.lastDate ?? null)}</td>
                        <td className="px-4 py-2 text-right">
                          {song.averageRarity != null ? (
                            <span className={`font-mono ${weightColorClass(song.averageRarity)}`}>
                              {formatNumber(song.averageRarity)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
};
