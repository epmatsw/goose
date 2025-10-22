#!/usr/bin/env node

/**
 * goose_rarity.js
 *
 * Command-line tool that fetches Goose (and related) setlist data from the elgoose.net API,
 * caches the combined dataset locally, and computes rarity scores for every show. Run with
 * `--update` to refresh the local cache, and `--outfile` to choose where the rarity CSV is written.
 */

import chalk from "chalk";
import { Command, InvalidOptionArgumentError } from "commander";
import fs from "fs/promises";
import Papa from "papaparse";
import path from "path";
import { fileURLToPath } from "url";

const API_BASE = "https://elgoose.net/api/v2";
const CACHE_FILENAME = "elgoose_setlists.json";
const DEFAULT_OUTFILE = "show_rarity_scores.csv";

const W_F = 1.0;
const W_C = 0.5;
const F_CAP = 3;
const MIN_NORMALIZED_RARITY = 0.05;
const MAX_NORMALIZED_RARITY = 1.0;
const MIN_SHOW_SCORE = 0.001;
const LENGTH_ATTENUATION = 0.1;
const FTP_BONUS_ORIGINAL = 0.1;
const FTP_BONUS_COVER = 0.05;
const FIRST_PLAY_CUTOFF = new Date("2015-01-01T00:00:00Z");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let envDatasetLoaded = false;
let envDatasetValue;
let envDatasetCacheKey;

function createCommander() {
	const program = new Command();
	program
		.name("goose-rarity")
		.description(
			"Fetch Goose setlists from elgoose.net and compute rarity scores for each show.",
		)
		.option(
			"--update",
			"Re-fetch setlist data from the API and refresh the cache.",
		)
		.option(
			"--outfile <path>",
			"Path to write the rarity CSV output.",
			DEFAULT_OUTFILE,
		)
		.option(
			"--year <year>",
			"Limit computations to shows from the specified calendar year.",
			(value) => {
				const parsed = Number.parseInt(value, 10);
				if (Number.isNaN(parsed)) {
					throw new InvalidOptionArgumentError("Year must be an integer.");
				}
				return parsed;
			},
		)
		.option(
			"--venue <term>",
			"Case-insensitive substring used to match venue or location names.",
		)
		.option(
			"--limit <number>",
			"Number of rarest shows to display.",
			(value) => {
				const parsed = Number.parseInt(value, 10);
				if (!Number.isInteger(parsed) || parsed <= 0) {
					throw new InvalidOptionArgumentError(
						"Limit must be a positive integer.",
					);
				}
				return parsed;
			},
		)
		.version("1.0.0");
	return program;
}

function getDatasetFromEnv(env = process.env) {
	const payload = env?.ELGOOSE_DATASET_JSON;
	if (envDatasetLoaded && payload === envDatasetCacheKey) {
		return envDatasetValue;
	}

	envDatasetLoaded = true;
	envDatasetCacheKey = payload;
	if (payload === undefined) {
		envDatasetValue = undefined;
		return envDatasetValue;
	}

	try {
		envDatasetValue = JSON.parse(payload);
	} catch (error) {
		throw new Error(
			`Failed to parse dataset from ELGOOSE_DATASET_JSON: ${error.message ?? error}`,
		);
	}
	return envDatasetValue;
}

function resetEnvDatasetCache() {
	envDatasetLoaded = false;
	envDatasetValue = undefined;
	envDatasetCacheKey = undefined;
}

function buildUrl(endpoint, params = {}) {
	const url = new URL(`${API_BASE}/${endpoint}`);
	Object.entries(params).forEach(([key, value]) => {
		if (value === undefined || value === null) return;
		url.searchParams.set(key, String(value));
	});
	return url;
}

function decodeHtmlEntities(value) {
	if (typeof value !== "string") return value ?? "";
	if (!value.includes("&")) return value;

	const namedEntities = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
	};

	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
		let decoded;
		if (entity.startsWith("#x") || entity.startsWith("#X")) {
			const codePoint = Number.parseInt(entity.slice(2), 16);
			if (!Number.isNaN(codePoint)) {
				decoded = String.fromCodePoint(codePoint);
			}
		} else if (entity.startsWith("#")) {
			const codePoint = Number.parseInt(entity.slice(1), 10);
			if (!Number.isNaN(codePoint)) {
				decoded = String.fromCodePoint(codePoint);
			}
		} else if (Object.hasOwn(namedEntities, entity)) {
			decoded = namedEntities[entity];
		}

		if (decoded === '"') return "”";
		if (decoded === "'") return "’";
		return decoded ?? match;
	});
}

async function fetchEndpoint(endpoint, params = {}) {
	const url = buildUrl(endpoint, params);
	const response = await fetch(url, {
		headers: {
			Accept: "application/json",
		},
	});

	if (!response.ok) {
		throw new Error(
			`Request to ${url.toString()} failed: ${response.status} ${response.statusText}`,
		);
	}

	const body = await response.json();
	if (body.error) {
		throw new Error(
			`elgoose API error for ${url.toString()}: ${body.error_message || "Unknown error"}`,
		);
	}

	return body.data;
}

function toNumericId(value) {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) return undefined;
		const parsed = Number.parseInt(trimmed, 10);
		if (!Number.isNaN(parsed)) {
			return parsed;
		}
	}
	return undefined;
}

function stableStringify(value) {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	const entries = Object.entries(value).sort(([left], [right]) =>
		left.localeCompare(right),
	);
	return `{${entries.map(([key, val]) => `"${key}":${stableStringify(val)}`).join(",")}}`;
}

function createSetlistEntryKey(entry) {
	if (!entry || typeof entry !== "object") return undefined;
	const candidateKeys = [
		"entry_id",
		"setlist_entry_id",
		"id",
		"songhistory_id",
		"songhistoryid",
		"uniqueid",
	];
	for (const key of candidateKeys) {
		if (entry[key] !== undefined && entry[key] !== null) {
			return `${key}:${String(entry[key])}`;
		}
	}
	const showId = toNumericId(entry.show_id);
	const songId =
		entry.song_id ??
		entry.songid ??
		entry.songhistoryid ??
		entry.uniqueid ??
		entry.songname ??
		"unknown";
	const position =
		entry.position ??
		entry.sortorder ??
		entry.setorder ??
		entry.songorder ??
		entry.uniqueorder ??
		"unknown";
	return `show:${showId ?? "unknown"}:song:${songId}:pos:${position}:hash:${stableStringify(entry)}`;
}

async function syncDatasetFromApi(existingDataset) {
	const baseline = existingDataset ?? null;
	const existingShows = Array.isArray(baseline?.shows) ? baseline.shows : [];
	const existingSetlists = Array.isArray(baseline?.setlists)
		? baseline.setlists
		: [];

	const existingShowById = new Map();
	for (const show of existingShows) {
		const showId = toNumericId(show?.show_id);
		if (showId !== undefined && !existingShowById.has(showId)) {
			existingShowById.set(showId, show);
		}
	}

	const latestShows = await fetchEndpoint("shows.json");
	const mergedShows = [];
	const newShows = [];

	for (const rawShow of Array.isArray(latestShows) ? latestShows : []) {
		const showId = toNumericId(rawShow?.show_id);
		if (showId !== undefined && existingShowById.has(showId)) {
			mergedShows.push(existingShowById.get(showId));
		} else {
			mergedShows.push(rawShow);
			if (showId !== undefined) {
				newShows.push({ id: showId, record: rawShow });
			}
		}
	}

	for (const show of existingShows) {
		const showId = toNumericId(show?.show_id);
		if (
			showId !== undefined &&
			!mergedShows.some(
				(candidate) => toNumericId(candidate?.show_id) === showId,
			)
		) {
			mergedShows.push(show);
		}
	}

	const existingEntryKeys = new Set();
	for (const entry of existingSetlists) {
		const key = createSetlistEntryKey(entry);
		if (key) {
			existingEntryKeys.add(key);
		}
	}

	const combinedSetlists = [...existingSetlists];
	const newEntriesByShow = new Map();

	if (newShows.length > 0) {
		let index = 0;
		const errors = [];

		async function worker() {
			while (index < newShows.length) {
				const currentIndex = index;
				index += 1;
				const { id } = newShows[currentIndex];
				try {
					const entries = await fetchEndpoint(`setlists/show_id/${id}.json`);
					if (!Array.isArray(entries) || entries.length === 0) continue;
					const filtered = [];
					for (const entry of entries) {
						const key = createSetlistEntryKey(entry);
						if (key && existingEntryKeys.has(key)) {
							continue;
						}
						if (key) {
							existingEntryKeys.add(key);
						}
						filtered.push(entry);
					}
					if (filtered.length > 0) {
						newEntriesByShow.set(id, filtered);
					}
				} catch (error) {
					errors.push({ showId: id, error });
				}
			}
		}

		const workerCount = Math.min(5, Math.max(1, newShows.length));
		await Promise.all(Array.from({ length: workerCount }, () => worker()));

		if (errors.length > 0) {
			const detail = errors
				.slice(0, 5)
				.map((item) => `${item.showId}: ${item.error?.message || item.error}`)
				.join("; ");
			throw new Error(
				`Failed to fetch setlists for ${errors.length} new show(s). Sample: ${detail}`,
			);
		}

		for (const show of mergedShows) {
			const showId = toNumericId(show?.show_id);
			if (showId === undefined) continue;
			const additions = newEntriesByShow.get(showId);
			if (additions && additions.length > 0) {
				combinedSetlists.push(...additions);
			}
		}
	}

	const dataset = {
		fetchedAt: new Date().toISOString(),
		shows: mergedShows,
		setlists: combinedSetlists,
	};

	const addedSetlistCount = Array.from(newEntriesByShow.values()).reduce(
		(total, entries) => total + entries.length,
		0,
	);

	return {
		dataset,
		addedShowCount: newShows.length,
		addedSetlistCount,
	};
}

async function saveDataset(filePath, data) {
	const serialized = JSON.stringify(data, null, 2);
	await fs.writeFile(filePath, serialized, "utf8");
}

async function loadDataset(filePath) {
	const contents = await fs.readFile(filePath, "utf8");
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
	if (typeof value === "number") return value === 1;
	if (typeof value === "string") {
		const trimmed = value.trim().toLowerCase();
		if (trimmed === "1" || trimmed === "true" || trimmed === "yes") return true;
		if (trimmed === "0" || trimmed === "false" || trimmed === "no")
			return false;
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
		setlistCounts.set(
			entry.show_id,
			(setlistCounts.get(entry.show_id) ?? 0) + 1,
		);
	}

	if (setlists.length === 0) {
		return {
			scores: shows.map((show) => ({
				showId: show.show_id,
				date: show.showdate ?? null,
				venue: decodeHtmlEntities(show.venuename ?? ""),
				location: decodeHtmlEntities(show.location ?? ""),
				rarityScore: MIN_SHOW_SCORE,
				year: parseShowYear(show),
			})),
			skipped: [],
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
			stats = {
				showIds: new Set(),
				firstEligibleDate: undefined,
				firstAppearance: undefined,
			};
			songStats.set(key, stats);
		}
		if (entry?.show_id != null) {
			stats.showIds.add(entry.show_id);
		}
		const entryDate =
			parseShowDate(entry?.showdate) ??
			(entry?.show_id != null ? showDateMap.get(entry.show_id) : undefined);
		if (entryDate) {
			if (!stats.firstAppearance || entryDate < stats.firstAppearance) {
				stats.firstAppearance = entryDate;
			}
			if (
				entryDate >= FIRST_PLAY_CUTOFF &&
				(!stats.firstEligibleDate || entryDate < stats.firstEligibleDate)
			) {
				stats.firstEligibleDate = entryDate;
			}
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

	const firstDateBySong = new Map();
	const firstAppearanceBySong = new Map();
	for (const [key, stats] of songStats.entries()) {
		const plays = Math.max(stats.showIds.size, 1);
		const denominator = Math.max(showsSince(stats.firstEligibleDate), plays);
		const percentage = denominator > 0 ? plays / denominator : 1;
		const percentageMetric = Math.max(percentage * 100, Number.EPSILON);
		frequencyBySong.set(key, percentageMetric);
		const displayFirstDate = stats.firstEligibleDate ?? stats.firstAppearance;
		if (displayFirstDate) {
			firstDateBySong.set(key, displayFirstDate);
		}
		if (stats.firstAppearance) {
			firstAppearanceBySong.set(key, stats.firstAppearance);
		}
	}

	const rawRarities = setlists.map((entry) => {
		const key = songKey(entry);
		const frequencyMetric = frequencyBySong.get(key) ?? 100;
		const cover = isCover(entry);
		const base = Math.min(1 / frequencyMetric, 1 / F_CAP);
		const coverFactor = 1 - W_C * (cover ? 1 : 0);
		const raw = W_F * base * Math.max(coverFactor, 0);
		const firstAppearance = firstAppearanceBySong.get(key);
		const firstEligible = firstDateBySong.get(key) ?? firstAppearance;
		const entryDate =
			parseShowDate(entry?.showdate) ??
			(entry?.show_id != null ? showDateMap.get(entry.show_id) : undefined);
		const isFirst =
			entryDate &&
			firstEligible &&
			entryDate.getUTCFullYear() === firstEligible.getUTCFullYear() &&
			entryDate.getUTCMonth() === firstEligible.getUTCMonth() &&
			entryDate.getUTCDate() === firstEligible.getUTCDate();
		const ftpBonus = isFirst
			? cover
				? FTP_BONUS_COVER
				: FTP_BONUS_ORIGINAL
			: 0;
		return {
			showId: entry?.show_id,
			raw: raw + ftpBonus,
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
				MIN_NORMALIZED_RARITY + rarityRange * ((item.raw - minRaw) / spread);
		}
		return {
			showId: item.showId,
			normalized,
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
				venue: decodeHtmlEntities(show.venuename ?? ""),
				location: decodeHtmlEntities(show.location ?? ""),
				year: parseShowYear(show),
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
			venue: decodeHtmlEntities(show.venuename ?? ""),
			location: decodeHtmlEntities(show.location ?? ""),
			rarityScore,
			year: parseShowYear(show),
		});
	}

	return { scores, skipped };
}

function formatCsvData(scores) {
	const rows = scores.map(({ showId, date, venue, rarityScore }) => ({
		showId,
		date,
		venue,
		rarityScore: rarityScore.toFixed(6),
	}));
	return Papa.unparse(rows, {
		columns: ["showId", "date", "venue", "rarityScore"],
	});
}

function matchesVenueFilter(score, term) {
	if (!term) return true;
	const needle = term.trim().toLowerCase();
	if (needle.length === 0) return true;
	const candidates = [score.venue ?? "", score.location ?? ""];
	return candidates.some((candidate) =>
		candidate.toLowerCase().includes(needle),
	);
}

async function writeCsv(filePath, csvContent) {
	await fs.writeFile(filePath, `${csvContent}\n`, "utf8");
}

async function ensureDataset(
	updateRequested,
	{ baseDir = process.cwd(), env = process.env } = {},
) {
	const datasetFromEnv = getDatasetFromEnv(env);
	if (datasetFromEnv !== undefined) {
		console.log(chalk.gray("Using dataset provided via ELGOOSE_DATASET_JSON."));
		return datasetFromEnv;
	}

	const cachePath = path.resolve(baseDir, CACHE_FILENAME);
	const exists = await fileExists(cachePath);
	if (!exists) {
		console.log(chalk.cyan("Downloading elgoose dataset…"));
		const { dataset, addedShowCount, addedSetlistCount } =
			await syncDatasetFromApi();
		await saveDataset(cachePath, dataset);
		console.log(
			chalk.green(
				`Dataset saved to ${path.relative(baseDir, cachePath)} (${addedShowCount} shows / ${addedSetlistCount} setlist entries)`,
			),
		);
		return dataset;
	}

	if (updateRequested) {
		console.log(chalk.cyan("Checking for new shows…"));
		const current = await loadDataset(cachePath);
		const { dataset, addedShowCount, addedSetlistCount } =
			await syncDatasetFromApi(current);
		if (current && addedShowCount === 0 && addedSetlistCount === 0) {
			console.log(
				chalk.gray("No new shows found; cached dataset remains current."),
			);
			return current;
		}
		await saveDataset(cachePath, dataset);
		console.log(
			chalk.green(
				`Dataset updated with ${addedShowCount} new show(s) and ${addedSetlistCount} setlist entries.`,
			),
		);
		return dataset;
	}

	console.log(
		chalk.gray(`Using cached dataset at ${path.relative(baseDir, cachePath)}`),
	);
	return loadDataset(cachePath);
}

function printTopShows(scores, limit = 10) {
	const sorted = [...scores]
		.sort((a, b) => b.rarityScore - a.rarityScore)
		.slice(0, limit);
	if (sorted.length === 0) {
		console.log(chalk.yellow("No shows found in the dataset."));
		return;
	}

	console.log(chalk.bold(`\nTop ${sorted.length} Rarest Shows`));
	console.table(
		sorted.map((entry, index) => ({
			rank: index + 1,
			showId: entry.showId,
			date: entry.date,
			venue: entry.venue,
			location: entry.location,
			rarityScore: entry.rarityScore.toFixed(6),
		})),
	);
}

async function runCli({
	argv = process.argv,
	baseDir = process.cwd(),
	env = process.env,
} = {}) {
	const program = createCommander();
	program.parse(argv, { from: "node" });
	const options = program.opts();
	const outfile = path.resolve(baseDir, options.outfile ?? DEFAULT_OUTFILE);

	try {
		const dataset = await ensureDataset(Boolean(options.update), {
			baseDir,
			env,
		});
		if (!dataset?.shows || !dataset?.setlists) {
			throw new Error(
				'Dataset is missing "shows" or "setlists" arrays. Try running with --update.',
			);
		}

		const { scores: allScores, skipped } = computeRarityScores(dataset);
		const filteredByYear = options.year
			? allScores.filter((score) => score.year === options.year)
			: allScores;
		const skippedByYear = options.year
			? skipped.filter((score) => score.year === options.year)
			: skipped;

		const filteredScores = filteredByYear.filter((score) =>
			matchesVenueFilter(score, options.venue),
		);
		const filteredSkipped = skippedByYear.filter((score) =>
			matchesVenueFilter(score, options.venue),
		);

		if (filteredSkipped.length > 0) {
			console.log(
				chalk.yellow(
					`${filteredSkipped.length} show(s) omitted because no setlist data was available.`,
				),
			);
		}

		if (options.year && filteredScores.length === 0) {
			console.log(
				chalk.yellow(
					`No shows found for year ${options.year}. Writing empty CSV and skipping top list.`,
				),
			);
		}

		const csv = formatCsvData(filteredScores);
		await writeCsv(outfile, csv);
		console.log(
			chalk.green(
				`Rarity scores written to ${path.relative(baseDir, outfile)}`,
			),
		);

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
		return 0;
	} catch (error) {
		console.error(
			chalk.red(`Failed to compute rarity scores: ${error.message}`),
		);
		return 1;
	}
}

async function main() {
	const exitCode = await runCli();
	if (exitCode !== 0) {
		process.exitCode = exitCode;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
	main();
}

export {
	computeRarityScores,
	formatCsvData,
	matchesVenueFilter,
	getDatasetFromEnv,
	resetEnvDatasetCache as __resetEnvDatasetCache,
	decodeHtmlEntities,
	buildUrl as __buildUrl,
	saveDataset as __saveDataset,
	loadDataset as __loadDataset,
	fileExists as __fileExists,
	normalizeIsOriginal as __normalizeIsOriginal,
	isCover as __isCover,
	songKey as __songKey,
	parseShowYear as __parseShowYear,
	parseShowDate as __parseShowDate,
	writeCsv as __writeCsv,
	runCli as __runCli,
	createCommander as __createCommander,
	syncDatasetFromApi as __syncDatasetFromApi,
	ensureDataset as __ensureDataset,
};
