#!/usr/bin/env node
/**
 * goose_rarity.js
 *
 * Command-line tool that fetches Goose (and related) setlist data from the elgoose.net API,
 * caches the combined dataset locally, and computes rarity scores for every show. Run with
 * `--update` to refresh the local cache, and `--outfile` to choose where the rarity CSV is written.
 */

import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import chalk from 'chalk';

const API_BASE = 'https://elgoose.net/api/v2';
const CACHE_FILENAME = 'elgoose_setlists.json';
const DEFAULT_OUTFILE = 'show_rarity_scores.csv';

const W_F = 1.0;
const W_C = 0.5;
const F_CAP = 3;
const MIN_NORMALIZED_RARITY = 0.05;
const MAX_NORMALIZED_RARITY = 1.0;
const MIN_SHOW_SCORE = 0.001;
const LENGTH_ATTENUATION = 0.1;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cachePath = path.resolve(process.cwd(), CACHE_FILENAME);

const commander = new Command();
commander
  .name('goose-rarity')
  .description('Fetch Goose setlists from elgoose.net and compute rarity scores for each show.')
  .option('--update', 'Re-fetch setlist data from the API and refresh the cache.')
  .option('--outfile <path>', 'Path to write the rarity CSV output.', DEFAULT_OUTFILE)
  .option('--year <year>', 'Limit computations to shows from the specified calendar year.', (value) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      throw new commander.InvalidOptionArgumentError('Year must be an integer.');
    }
    return parsed;
  })
  .option('--venue <term>', 'Case-insensitive substring used to match venue or location names.')
  .option('--limit <number>', 'Number of rarest shows to display.', (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new commander.InvalidOptionArgumentError('Limit must be a positive integer.');
    }
    return parsed;
  })
  .version('1.0.0');

function buildUrl(endpoint, params = {}) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    url.searchParams.set(key, String(value));
  });
  return url;
}

function decodeHtmlEntities(value) {
  if (typeof value !== 'string') return value ?? '';
  if (!value.includes('&')) return value;

  const namedEntities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'"
  };

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    let decoded;
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      if (!Number.isNaN(codePoint)) {
        decoded = String.fromCodePoint(codePoint);
      }
    } else if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      if (!Number.isNaN(codePoint)) {
        decoded = String.fromCodePoint(codePoint);
      }
    } else if (Object.prototype.hasOwnProperty.call(namedEntities, entity)) {
      decoded = namedEntities[entity];
    }

    if (decoded === '"') return '”';
    if (decoded === "'") return '’';
    return decoded ?? match;
  });
}

async function fetchEndpoint(endpoint, params = {}) {
  const url = buildUrl(endpoint, params);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Request to ${url.toString()} failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  if (body.error) {
    throw new Error(`elgoose API error for ${url.toString()}: ${body.error_message || 'Unknown error'}`);
  }

  return body.data;
}

async function downloadDataset() {
  const shows = await fetchEndpoint('shows.json');
  const setlists = await fetchAllSetlistsForShows(shows);

  return {
    fetchedAt: new Date().toISOString(),
    shows,
    setlists
  };
}

async function fetchAllSetlistsForShows(shows, concurrency = 5) {
  const results = [];
  const errors = [];
  let index = 0;

  const workerCount = Math.min(concurrency, shows.length || 1);
  async function worker() {
    while (true) {
      const currentIndex = index;
      if (currentIndex >= shows.length) break;
      index += 1;

      const show = shows[currentIndex];
      try {
        const entries = await fetchEndpoint(`setlists/show_id/${show.show_id}.json`);
        if (Array.isArray(entries)) {
          results.push(...entries);
        }
      } catch (error) {
        errors.push({ showId: show.show_id, error });
      }
    }
  }

  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  if (errors.length > 0) {
    const detail = errors
      .slice(0, 5)
      .map((item) => `${item.showId}: ${item.error.message || item.error}`)
      .join('; ');
    throw new Error(
      `Failed to fetch setlists for ${errors.length} show(s). Sample: ${detail}`
    );
  }

  return results;
}

async function saveDataset(filePath, data) {
  const serialized = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, serialized, 'utf8');
}

async function loadDataset(filePath) {
  const contents = await fs.readFile(filePath, 'utf8');
  return JSON.parse(contents);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

function normalizeIsOriginal(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === '1' || trimmed === 'true' || trimmed === 'yes') return true;
    if (trimmed === '0' || trimmed === 'false' || trimmed === 'no') return false;
  }
  return Boolean(value);
}

function isCover(entry) {
  if (entry?.isoriginal !== undefined && entry?.isoriginal !== null) {
    return !normalizeIsOriginal(entry.isoriginal);
  }
  return Boolean(entry?.original_artist);
}

function songKey(entry) {
  if (entry?.song_id) return `id:${entry.song_id}`;
  if (entry?.slug) return `slug:${entry.slug}`;
  if (entry?.songname) return `name:${entry.songname.toLowerCase()}`;
  return `unique:${entry.uniqueid}`;
}

function parseShowYear(show) {
  if (show?.show_year) return Number(show.show_year);
  if (show?.showdate) {
    const year = Number.parseInt(String(show.showdate).slice(0, 4), 10);
    if (!Number.isNaN(year)) return year;
  }
  return undefined;
}

function parseShowDate(value) {
  if (!value) return undefined;
  const isoCandidate = `${String(value)}T00:00:00Z`;
  const date = new Date(isoCandidate);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

function computeRarityScores(dataset) {
  const { shows = [], setlists = [] } = dataset;
  const setlistCounts = new Map();
  for (const entry of setlists) {
    if (entry?.show_id == null) continue;
    setlistCounts.set(entry.show_id, (setlistCounts.get(entry.show_id) ?? 0) + 1);
  }

  if (setlists.length === 0) {
    return {
      scores: shows.map((show) => ({
        showId: show.show_id,
        date: show.showdate ?? null,
        venue: decodeHtmlEntities(show.venuename ?? ''),
        location: decodeHtmlEntities(show.location ?? ''),
        rarityScore: MIN_SHOW_SCORE,
        year: parseShowYear(show)
      })),
      skipped: []
    };
  }

  const showDateMap = new Map();
  for (const show of shows) {
    const date = parseShowDate(show.showdate);
    if (date) {
      showDateMap.set(show.show_id, date);
    }
  }

  const showsWithSetlistDates = [];
  for (const show of shows) {
    if ((setlistCounts.get(show.show_id) ?? 0) === 0) continue;
    const date = parseShowDate(show.showdate);
    if (!date) continue;
    showsWithSetlistDates.push(date.getTime());
  }
  showsWithSetlistDates.sort((a, b) => a - b);
  const totalEligibleShows = showsWithSetlistDates.length;

  const songStats = new Map();
  for (const entry of setlists) {
    const key = songKey(entry);
    let stats = songStats.get(key);
    if (!stats) {
      stats = { showIds: new Set(), firstDate: undefined };
      songStats.set(key, stats);
    }
    if (entry?.show_id != null) {
      stats.showIds.add(entry.show_id);
    }
    const entryDate =
      parseShowDate(entry?.showdate) ??
      (entry?.show_id != null ? showDateMap.get(entry.show_id) : undefined);
    if (entryDate && (!stats.firstDate || entryDate < stats.firstDate)) {
      stats.firstDate = entryDate;
    }
  }

  const frequencyBySong = new Map();
  function showsSince(date) {
    if (totalEligibleShows === 0) return 0;
    if (!date) return totalEligibleShows;
    const target = date.getTime();
    let left = 0;
    let right = showsWithSetlistDates.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (showsWithSetlistDates[mid] >= target) {
        right = mid;
      } else {
        left = mid + 1;
      }
    }
    const remaining = totalEligibleShows - left;
    return remaining;
  }

  for (const [key, stats] of songStats.entries()) {
    const plays = Math.max(stats.showIds.size, 1);
    const denominator = Math.max(showsSince(stats.firstDate), plays);
    const percentage = denominator > 0 ? plays / denominator : 1;
    const percentageMetric = Math.max(percentage * 100, Number.EPSILON);
    frequencyBySong.set(key, percentageMetric);
  }

  const rawRarities = setlists.map((entry) => {
    const key = songKey(entry);
    const frequencyMetric = frequencyBySong.get(key) ?? 100;
    const base = Math.min(1 / frequencyMetric, 1 / F_CAP);
    const coverFactor = 1 - W_C * (isCover(entry) ? 1 : 0);
    const raw = W_F * base * Math.max(coverFactor, 0);
    return {
      showId: entry?.show_id,
      raw
    };
  });

  const rawValues = rawRarities.map((item) => item.raw);
  const minRaw = Math.min(...rawValues);
  const maxRaw = Math.max(...rawValues);
  const spread = maxRaw - minRaw;

  const rarityRange = MAX_NORMALIZED_RARITY - MIN_NORMALIZED_RARITY;
  const normalizedRarities = rawRarities.map((item) => {
    let normalized = MAX_NORMALIZED_RARITY;
    if (spread > Number.EPSILON) {
      normalized =
        MIN_NORMALIZED_RARITY +
        rarityRange * ((item.raw - minRaw) / spread);
    }
    return {
      showId: item.showId,
      normalized
    };
  });

  const totalsByShow = new Map();
  for (const { showId, normalized } of normalizedRarities) {
    if (showId == null) continue;
    totalsByShow.set(showId, (totalsByShow.get(showId) ?? 0) + normalized);
  }

  const scores = [];
  const skipped = [];
  for (const show of shows) {
    const count = setlistCounts.get(show.show_id) ?? 0;
    if (count === 0) {
      skipped.push({
        showId: show.show_id,
        date: show.showdate ?? null,
        venue: decodeHtmlEntities(show.venuename ?? ''),
        location: decodeHtmlEntities(show.location ?? ''),
        year: parseShowYear(show)
      });
      continue;
    }

    const total = totalsByShow.get(show.show_id) ?? 0;
    const average = total / count;
    const lengthMultiplier = 1 + Math.log1p(count) * LENGTH_ATTENUATION;
    const rarityScore = Math.max(average * lengthMultiplier, MIN_SHOW_SCORE);
    scores.push({
      showId: show.show_id,
      date: show.showdate ?? null,
      venue: decodeHtmlEntities(show.venuename ?? ''),
      location: decodeHtmlEntities(show.location ?? ''),
      rarityScore,
      year: parseShowYear(show)
    });
  }

  return { scores, skipped };
}

function formatCsvData(scores) {
  const rows = scores.map(({ showId, date, venue, rarityScore }) => ({
    showId,
    date,
    venue,
    rarityScore: rarityScore.toFixed(6)
  }));
  return Papa.unparse(rows, { columns: ['showId', 'date', 'venue', 'rarityScore'] });
}

function matchesVenueFilter(score, term) {
  if (!term) return true;
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return true;
  const candidates = [
    score.venue ?? '',
    score.location ?? ''
  ];
  return candidates.some((candidate) => candidate.toLowerCase().includes(needle));
}

async function writeCsv(filePath, csvContent) {
  await fs.writeFile(filePath, `${csvContent}\n`, 'utf8');
}

async function ensureDataset(updateRequested) {
  const exists = await fileExists(cachePath);
  if (!exists || updateRequested) {
    console.log(chalk.cyan(updateRequested ? 'Refreshing elgoose dataset…' : 'Downloading elgoose dataset…'));
    const dataset = await downloadDataset();
    await saveDataset(cachePath, dataset);
    console.log(chalk.green(`Dataset saved to ${path.relative(process.cwd(), cachePath)}`));
    return dataset;
  }

  console.log(chalk.gray(`Using cached dataset at ${path.relative(process.cwd(), cachePath)}`));
  return loadDataset(cachePath);
}

function printTopShows(scores, limit = 10) {
  const sorted = [...scores].sort((a, b) => b.rarityScore - a.rarityScore).slice(0, limit);
  if (sorted.length === 0) {
    console.log(chalk.yellow('No shows found in the dataset.'));
    return;
  }

  console.log(chalk.bold(`\nTop ${sorted.length} Rarest Shows`));
  console.table(sorted.map((entry, index) => ({
    rank: index + 1,
    showId: entry.showId,
    date: entry.date,
    venue: entry.venue,
    location: entry.location,
    rarityScore: entry.rarityScore.toFixed(6)
  })));
}

async function main() {
  commander.parse(process.argv);
  const options = commander.opts();
  const outfile = path.resolve(process.cwd(), options.outfile ?? DEFAULT_OUTFILE);

  try {
    const dataset = await ensureDataset(Boolean(options.update));
    if (!dataset?.shows || !dataset?.setlists) {
      throw new Error('Dataset is missing "shows" or "setlists" arrays. Try running with --update.');
    }

    const { scores: allScores, skipped } = computeRarityScores(dataset);
    const filteredByYear = options.year
      ? allScores.filter((score) => score.year === options.year)
      : allScores;
    const skippedByYear = options.year
      ? skipped.filter((score) => score.year === options.year)
      : skipped;

    const filteredScores = filteredByYear.filter((score) =>
      matchesVenueFilter(score, options.venue)
    );
    const filteredSkipped = skippedByYear.filter((score) =>
      matchesVenueFilter(score, options.venue)
    );

    if (filteredSkipped.length > 0) {
      console.log(
        chalk.yellow(
          `${filteredSkipped.length} show(s) omitted because no setlist data was available.`
        )
      );
    }

    if (options.year && filteredScores.length === 0) {
      console.log(
        chalk.yellow(
          `No shows found for year ${options.year}. Writing empty CSV and skipping top list.`
        )
      );
    }

    const csv = formatCsvData(filteredScores);
    await writeCsv(outfile, csv);
    console.log(chalk.green(`Rarity scores written to ${path.relative(process.cwd(), outfile)}`));

    if (filteredScores.length > 0) {
      const average =
        filteredScores.reduce((acc, { rarityScore }) => acc + rarityScore, 0) /
        filteredScores.length;
      const label = options.year
        ? `Average rarity score across ${filteredScores.length} shows in ${options.year}`
        : `Average rarity score across ${filteredScores.length} shows`;
      console.log(chalk.blue(`${label}: ${average.toFixed(6)}`));
    }

    const limit = options.limit ?? 10;
    printTopShows(filteredScores, limit);
  } catch (error) {
    console.error(chalk.red(`Failed to compute rarity scores: ${error.message}`));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${__filename}`) {
  main();
}
