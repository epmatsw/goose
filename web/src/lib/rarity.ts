export type Show = Readonly<{
	show_id: number;
	showdate?: string | null;
	show_year?: number | string | null;
	venuename?: string | null;
	location?: string | null;
}>;

export type SetlistEntry = Readonly<{
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
	shownotes?: string | null;
}>;

export type Dataset = Readonly<{
	shows: ReadonlyArray<Show>;
	setlists: ReadonlyArray<SetlistEntry>;
}>;

export type RarityScore = Readonly<{
	showId: number;
	date: string | null;
	venue: string;
	location: string;
	rarityScore: number;
	normalizedScore: number;
	year?: number;
	entries: number;
}>;

export type ComputeResult = Readonly<{
	scores: ReadonlyArray<RarityScore>;
	skipped: ReadonlyArray<RarityScore>;
	songDetails: Record<string, SongRarityDetail>;
	songAggregates: Record<string, SongAggregate>;
}>;

export type SongRarityDetail = Readonly<{
	key: string;
	songKey: string;
	showId?: number;
	normalized: number;
	raw: number;
	plays: number;
	percentage: number;
	isCover: boolean;
	firstDate?: string;
	firstAppearance?: string;
}>;

export type SongAggregate = Readonly<{
	songKey: string;
	name: string | null;
	songId: number | null;
	slug: string | null;
	plays: number;
	percentage: number;
	firstDate?: string;
	coverCount: number;
	originalCount: number;
}>;

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

type SongUsageStats = {
	showIds: Set<number>;
	firstEligibleDate?: Date;
	firstAppearance?: Date;
};

function decodeHtmlEntities(value: string | null | undefined): string {
	if (!value) return "";
	if (!value.includes("&")) return value;
	const named: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
	};
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
		let decoded: string | undefined;
		if (entity.startsWith("#x") || entity.startsWith("#X")) {
			const code = Number.parseInt(entity.slice(2), 16);
			if (!Number.isNaN(code)) decoded = String.fromCodePoint(code);
		} else if (entity.startsWith("#")) {
			const code = Number.parseInt(entity.slice(1), 10);
			if (!Number.isNaN(code)) decoded = String.fromCodePoint(code);
		} else if (entity in named) {
			decoded = named[entity];
		}
		if (decoded === '"') return "”";
		if (decoded === "'") return "’";
		return decoded ?? match;
	});
}

function normalizeIsOriginal(
	value: SetlistEntry["isoriginal"],
): boolean | undefined {
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

export function createSetlistEntryKey(
	entry: SetlistEntry,
	index?: number,
): string {
	if (entry?.uniqueid != null) return `uid:${entry.uniqueid}`;
	const showPart =
		entry?.show_id != null ? `show:${entry.show_id}` : "show:unknown";
	const positionValue = entry?.position ?? entry?.setnumber;
	const positionPart =
		positionValue != null && String(positionValue).trim().length > 0
			? `pos:${String(positionValue).trim()}`
			: index != null
				? `idx:${index}`
				: "pos:unknown";
	const namePart =
		entry?.slug && String(entry.slug).trim().length > 0
			? `slug:${String(entry.slug).trim().toLowerCase()}`
			: entry?.songname && String(entry.songname).trim().length > 0
				? `name:${String(entry.songname).trim().toLowerCase()}`
				: "name:unknown";
	return `${showPart}|${positionPart}|${namePart}`;
}

function showsSince(
	date: Date | undefined,
	sortedDates: number[],
	totalEligible: number,
): number {
	if (totalEligible === 0) return 0;
	if (!date) return totalEligible;
	const target = date.getTime();
	let left = 0;
	let right = sortedDates.length;
	while (left < right) {
		const mid = Math.floor((left + right) / 2);
		const value = sortedDates[mid] ?? Number.POSITIVE_INFINITY;
		if (value >= target) {
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
		setlistCounts.set(
			entry.show_id,
			(setlistCounts.get(entry.show_id) ?? 0) + 1,
		);
	}

	if (setlists.length === 0) {
		const scores = shows.map((show) => {
			const year = parseShowYear(show);
			return {
				showId: show.show_id,
				date: show.showdate ?? null,
				venue: decodeHtmlEntities(show.venuename ?? ""),
				location: decodeHtmlEntities(show.location ?? ""),
				rarityScore: MIN_SHOW_SCORE,
				normalizedScore: 1,
				entries: 0,
				...(year !== undefined ? { year } : {}),
			};
		});
		return { scores, skipped: [], songDetails: {}, songAggregates: {} };
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

	const songStats = new Map<string, SongUsageStats>();
	const songMeta = new Map<
		string,
		{
			name: string | null;
			slug: string | null;
			songId: number | null;
			coverCount: number;
			originalCount: number;
		}
	>();
	for (const entry of setlists) {
		const key = songKey(entry);
		const existingStats = songStats.get(key);
		const stats: SongUsageStats = existingStats ?? {
			showIds: new Set<number>(),
		};
		if (!existingStats) {
			songStats.set(key, stats);
		}
		if (entry?.show_id != null) {
			stats.showIds.add(entry.show_id);
		}
		const existingMeta = songMeta.get(key);
		const meta = existingMeta ?? {
			name: null,
			slug: null,
			songId: null,
			coverCount: 0,
			originalCount: 0,
		};
		if (!existingMeta) {
			songMeta.set(key, meta);
		}
		if (entry?.songname && meta.name == null) {
			meta.name = entry.songname;
		}
		if (entry?.slug && meta.slug == null) {
			meta.slug = entry.slug;
		}
		if (entry?.song_id != null && meta.songId == null) {
			meta.songId = entry.song_id;
		}
		if (isCover(entry)) {
			meta.coverCount += 1;
		} else {
			meta.originalCount += 1;
		}
		const entryDate =
			parseShowDate(entry?.showdate ?? undefined) ??
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

	const frequencyBySong = new Map<string, number>();
	const firstDateBySong = new Map<string, Date>();
	const firstAppearanceBySong = new Map<string, Date>();
	const usageBySong = new Map<
		string,
		{ plays: number; percentage: number; firstDate?: Date }
	>();

	for (const [key, stats] of songStats.entries()) {
		const plays = Math.max(stats.showIds.size, 1);
		const denominator = Math.max(
			showsSince(
				stats.firstEligibleDate,
				showsWithSetlistDates,
				totalEligibleShows,
			),
			plays,
		);
		const percentage = denominator > 0 ? plays / denominator : 1;
		const percentageMetric = Math.max(percentage * 100, Number.EPSILON);
		frequencyBySong.set(key, percentageMetric);
		const displayFirstDate = stats.firstEligibleDate ?? stats.firstAppearance;
		if (displayFirstDate) firstDateBySong.set(key, displayFirstDate);
		if (stats.firstAppearance) {
			firstAppearanceBySong.set(key, stats.firstAppearance);
		}
		const usageEntry =
			displayFirstDate !== undefined
				? { plays, percentage, firstDate: displayFirstDate }
				: { plays, percentage };
		usageBySong.set(key, usageEntry);
	}

	const rawRarities = setlists.map((entry, index) => {
		const key = songKey(entry);
		const frequencyMetric = frequencyBySong.get(key) ?? 100;
		const isCoverEntry = isCover(entry);
		const base = Math.min(1 / frequencyMetric, 1 / F_CAP);
		const coverFactor = 1 - W_C * (isCoverEntry ? 1 : 0);
		const raw = W_F * base * Math.max(coverFactor, 0);
		const ftpSourceDate = firstAppearanceBySong.get(key);
		const usage = usageBySong.get(key);
		const ftpEligibleDate = usage?.firstDate ?? ftpSourceDate;
		const entryDate =
			parseShowDate(entry?.showdate ?? undefined) ??
			(entry?.show_id != null ? showDateMap.get(entry.show_id) : undefined);
		const isFirstPlayEntry =
			entryDate &&
			ftpEligibleDate &&
			entryDate.getUTCFullYear() === ftpEligibleDate.getUTCFullYear() &&
			entryDate.getUTCMonth() === ftpEligibleDate.getUTCMonth() &&
			entryDate.getUTCDate() === ftpEligibleDate.getUTCDate();
		const ftpBonus = isFirstPlayEntry
			? isCoverEntry
				? FTP_BONUS_COVER
				: FTP_BONUS_ORIGINAL
			: 0;
		const entryKey = createSetlistEntryKey(entry, index);
		const rawShowId =
			entry?.show_id != null ? Number(entry.show_id) : undefined;
		const showIdValue =
			rawShowId !== undefined && Number.isFinite(rawShowId)
				? rawShowId
				: undefined;
		return {
			...(showIdValue !== undefined ? { showId: showIdValue } : {}),
			raw: raw + ftpBonus,
			songKey: key,
			entryKey,
			isCover: isCoverEntry,
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
		const normalized =
			spread > Number.EPSILON
				? MIN_NORMALIZED_RARITY + rarityRange * ((item.raw - minRaw) / spread)
				: MAX_NORMALIZED_RARITY;
		if (item.showId != null) {
			totalsByShow.set(
				item.showId,
				(totalsByShow.get(item.showId) ?? 0) + normalized,
			);
		}
		const usage = usageBySong.get(item.songKey);
		const firstAppearanceDate = firstAppearanceBySong.get(item.songKey);
		const firstDateIso = usage?.firstDate?.toISOString();
		const firstAppearanceIso = firstAppearanceDate?.toISOString();
		songDetails[item.entryKey] = {
			key: item.entryKey,
			songKey: item.songKey,
			normalized,
			raw: item.raw,
			plays: usage?.plays ?? 0,
			percentage: usage?.percentage ?? 0,
			isCover: item.isCover,
			...(item.showId !== undefined ? { showId: item.showId } : {}),
			...(firstDateIso ? { firstDate: firstDateIso } : {}),
			...(firstAppearanceIso ? { firstAppearance: firstAppearanceIso } : {}),
		};
	}

	type ScoreDraft = {
		readonly showId: number;
		readonly date: string | null;
		readonly venue: string;
		readonly location: string;
		readonly rarityScore: number;
		readonly year?: number;
		readonly entries: number;
	};

	const scoreDrafts: ScoreDraft[] = [];
	const skipped: RarityScore[] = [];

	for (const show of shows) {
		const entries = setlistCounts.get(show.show_id) ?? 0;
		const venue = decodeHtmlEntities(show.venuename ?? "");
		const location = decodeHtmlEntities(show.location ?? "");
		const year = parseShowYear(show);
		if (entries === 0) {
			skipped.push({
				showId: show.show_id,
				date: show.showdate ?? null,
				venue,
				location,
				rarityScore: MIN_SHOW_SCORE,
				normalizedScore: 0,
				entries,
				...(year !== undefined ? { year } : {}),
			});
			continue;
		}

		const total = totalsByShow.get(show.show_id) ?? 0;
		const average = total / entries;
		const lengthMultiplier = 1 + Math.log1p(entries) * LENGTH_ATTENUATION;
		const rarityScore = Math.max(average * lengthMultiplier, MIN_SHOW_SCORE);
		scoreDrafts.push({
			showId: show.show_id,
			date: show.showdate ?? null,
			venue,
			location,
			rarityScore,
			entries,
			...(year !== undefined ? { year } : {}),
		});
	}

	let minScore = Number.POSITIVE_INFINITY;
	let maxScore = Number.NEGATIVE_INFINITY;
	for (const value of scoreDrafts) {
		if (value.rarityScore < minScore) minScore = value.rarityScore;
		if (value.rarityScore > maxScore) maxScore = value.rarityScore;
	}
	const scoreSpread = maxScore - minScore;

	const normalizedScores =
		scoreDrafts.length === 0
			? ([] as RarityScore[])
			: scoreDrafts.map<RarityScore>((draft) => ({
					showId: draft.showId,
					date: draft.date,
					venue: draft.venue,
					location: draft.location,
					rarityScore: draft.rarityScore,
					normalizedScore:
						scoreSpread > Number.EPSILON
							? (draft.rarityScore - minScore) / scoreSpread
							: 1,
					entries: draft.entries,
					...(draft.year !== undefined ? { year: draft.year } : {}),
				}));

	const songAggregates: Record<string, SongAggregate> = {};
	for (const [key, usage] of usageBySong.entries()) {
		const meta = songMeta.get(key);
		const firstDateIso = usage?.firstDate?.toISOString();
		songAggregates[key] = {
			songKey: key,
			name: meta?.name ?? null,
			songId: meta?.songId ?? null,
			slug: meta?.slug ?? null,
			plays: usage.plays,
			percentage: usage.percentage,
			...(firstDateIso ? { firstDate: firstDateIso } : {}),
			coverCount: meta?.coverCount ?? 0,
			originalCount: meta?.originalCount ?? 0,
		};
	}

	return { scores: normalizedScores, skipped, songDetails, songAggregates };
}
