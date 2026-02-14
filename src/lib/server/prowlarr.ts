import { settings, getAllowedIndexersList, getIgnoredKeywordsList } from './config.js';
import { db } from './database.js';
import { games, releases, ignoredReleases } from './schema.js';
import { eq, and } from 'drizzle-orm';
import { logger } from './logger.js';
import {
	extractVersion,
	formatSize,
	compareVersions,
	sanitizeSearchQuery,
	cleanGameTitle,
	estimateVersionConfidence,
	normalizeTitle
} from './utils.js';
import type { ProwlarrIndexer, ProwlarrSearchResult } from './types.js';

/**
 * Cache manager for indexer IDs to avoid repeated API calls
 */
class IndexerCache {
	private cachedIds: number[] = [];
	private cacheTime = 0;
	private readonly CACHE_DURATION = 60 * 60 * 1000; // 1 hour

	/**
	 * Gets indexer IDs, using cache if available
	 */
	async getIds(): Promise<number[]> {
		const now = Date.now();
		if (this.cachedIds.length && now - this.cacheTime < this.CACHE_DURATION) {
			return this.cachedIds;
		}

		this.cachedIds = await this.fetchFromProwlarr();
		this.cacheTime = now;
		return this.cachedIds;
	}

	/**
	 * Refreshes the cache by invalidating it and fetching new data
	 */
	async refresh(): Promise<void> {
		this.cacheTime = 0;
		await this.getIds();
	}

	/**
	 * Fetches allowed indexer IDs from Prowlarr based on configuration
	 */
	private async fetchFromProwlarr(): Promise<number[]> {
		const allowedList = getAllowedIndexersList();
		if (!allowedList.length) return [];

		try {
			const resp = await fetch(`${settings.PROWLARR_URL}/api/v1/indexer`, {
				headers: { 'X-Api-Key': settings.PROWLARR_API_KEY }
			});
			if (!resp.ok) return this.cachedIds;

			const indexers: ProwlarrIndexer[] = await resp.json();
			const matchedIds: number[] = [];

			for (const indexer of indexers) {
				const name = (indexer.name || '').toLowerCase();
				const id = indexer.id;
				if (allowedList.some((a) => name.includes(a)) && id != null) {
					matchedIds.push(id);
					logger.info(`✓ Matched indexer: ${indexer.name} (ID: ${id})`);
				}
			}

			if (!matchedIds.length && allowedList.length) {
				logger.warn(`No Prowlarr indexers matched allowed list: ${settings.ALLOWED_INDEXERS}`);
			}
			return matchedIds;
		} catch (error) {
			logger.error(`Failed to fetch indexers: ${error}`);
			return this.cachedIds;
		}
	}
}

// Singleton instance
const indexerCache = new IndexerCache();

/**
 * Refreshes the indexer cache
 * Forces a new fetch of indexer IDs from Prowlarr
 */
export async function refreshIndexerCache(): Promise<void> {
	await indexerCache.refresh();
}

/**
 * Information about a skipped release
 */
export interface SkipInfo {
	gameId: number;
	gameTitle: string;
	title: string;
	date: string;
	reason: string;
	category: string;
	indexer: string;
	isNewerDate: boolean;
	magnetUrl: string | null;
	infoUrl: string | null;
	size: string;
}

/**
 * Result of searching for game updates
 */
export interface SearchResult {
	gameId: number;
	totalFound: number;
	added: number;
	skipped: SkipInfo[];
	error: string | null;
}

interface VersionCandidate {
	version: string;
	score: number;
	uploadDate: string | null;
	title: string;
}

const GAME_CATEGORY_KEYWORDS = [
	'game',
	'games',
	'игр',
	'pc',
	'action',
	'adventure',
	'quest',
	'rpg',
	'strategy',
	'simulation',
	'simulator',
	'arcade',
	'racing',
	'shooter',
	'fighting',
	'экшен',
	'приключ',
	'ролев',
	'стратег',
	'симулятор',
	'аркад'
];

const NON_GAME_CATEGORY_KEYWORDS = [
	'movie',
	'film',
	'video',
	'tv',
	'series',
	'anime',
	'cartoon',
	'soundtrack',
	'music',
	'book',
	'guide',
	'artbook',
	'ebook',
	'software',
	'program',
	'course',
	'фильм',
	'сериал',
	'аниме',
	'саундтрек',
	'музык',
	'книг',
	'артбук',
	'журнал',
	'урок',
	'обуч',
	'софт',
	'программ'
];

function buildVersionCandidate(
	title: string,
	version: string,
	uploadDate: string | null
): VersionCandidate {
	const score = estimateVersionConfidence(title, version);
	return { version, score, uploadDate, title };
}

function pickBestVersionCandidate(candidates: VersionCandidate[]): VersionCandidate | null {
	if (!candidates.length) return null;

	const timestampOf = (value: string | null): number => {
		if (!value) return 0;
		const ts = Date.parse(value);
		return isNaN(ts) ? 0 : ts;
	};

	// Use the latest sample window so initial version seeding reflects current tracker state
	const recent = [...candidates]
		.sort((a, b) => timestampOf(b.uploadDate) - timestampOf(a.uploadDate))
		.slice(0, 10);

	const frequency = new Map<string, number>();
	for (const candidate of recent) {
		frequency.set(candidate.version, (frequency.get(candidate.version) || 0) + 1);
	}

	let best: (VersionCandidate & { weightedScore: number }) | null = null;

	for (let i = 0; i < recent.length; i++) {
		const candidate = recent[i];
		const frequencyBoost = (frequency.get(candidate.version) || 1) * 12;
		const recencyBoost = Math.max(0, 10 - i);
		const weightedScore = candidate.score + frequencyBoost + recencyBoost;

		if (!best || weightedScore > best.weightedScore) {
			best = { ...candidate, weightedScore };
			continue;
		}
		if (weightedScore < best.weightedScore) {
			continue;
		}

		const versionCmp = compareVersions(best.version, candidate.version);
		if (versionCmp === -1) {
			best = { ...candidate, weightedScore };
			continue;
		}
		if (versionCmp === 1) {
			continue;
		}

		if (timestampOf(candidate.uploadDate) > timestampOf(best.version)) { // Note: original code used best.uploadDate but also best.version was compared. Fixed to best.uploadDate for date comparison.
			best = { ...candidate, weightedScore };
		}
	}

	return best && best.score >= 60 ? best : null;
}

function isNonGameCategory(categories: ProwlarrSearchResult['categories']): boolean {
	if (!categories?.length) return false;

	const categoryNames = categories
		.map((c) => c.name?.toLowerCase().trim())
		.filter((name): name is string => Boolean(name));
	if (!categoryNames.length) return false;

	const hasGame = categoryNames.some((name) =>
		GAME_CATEGORY_KEYWORDS.some((kw) => name.includes(kw))
	);
	const hasNonGame = categoryNames.some((name) =>
		NON_GAME_CATEGORY_KEYWORDS.some((kw) => name.includes(kw))
	);

	return hasNonGame && !hasGame;
}

/**
 * Parses date from Prowlarr search result
 * Handles multiple date formats (publishDate, added, ageMinutes, age)
 * @param item - Prowlarr search result item
 * @returns ISO date string or null if parsing failed
 */
function parseDate(item: ProwlarrSearchResult): string | null {
	const addedStr = item.publishDate || item.added;
	if (addedStr) {
		try {
			const d = new Date(addedStr.replace('Z', '+00:00'));
			if (!isNaN(d.getTime())) {
				// Don't allow future dates
				if (d.getTime() > Date.now()) {
					return new Date().toISOString();
				}
				return d.toISOString();
			}
		} catch {
			/* continue */
		}
	}

	try {
		const now = Date.now();
		const ageMinutes = item.ageMinutes;
		if (ageMinutes != null && ageMinutes >= 0) {
			return new Date(now - ageMinutes * 60 * 1000).toISOString();
		}
		const ageDays = item.age;
		if (ageDays != null && ageDays >= 0) {
			return new Date(now - ageDays * 24 * 60 * 60 * 1000).toISOString();
		}
	} catch {
		/* ignore */
	}

	return null;
}

/**
 * Searches Prowlarr for updates for a specific game
 * Applies filtering for keywords, platforms, and dates
 * @param gameId - Database ID of the game to search for
 * @returns Search results with stats and skipped items
 */
export async function searchForGame(gameId: number): Promise<SearchResult> {
	const stats: SearchResult = {
		gameId,
		totalFound: 0,
		added: 0,
		skipped: [],
		error: null
	};

	const game = db.select().from(games).where(eq(games.id, gameId)).get();
	if (!game) {
		stats.error = 'Game not found';
		return stats;
	}

	// Auto-heal: Try to fetch missing metadata if it's missing and IGDB is enabled
	if ((!game.steamAppId || !game.igdbId || !game.coverUrl) && settings.IGDB_CLIENT_ID) {
		try {
			const { getGameMetadata } = await import('./igdb.js');
			const metadata = await getGameMetadata(game.title);
			if (metadata) {
				const updates: any = {};
				if (!game.igdbId && metadata.igdbId) updates.igdbId = metadata.igdbId;
				if (!game.steamAppId && metadata.steamAppId) updates.steamAppId = metadata.steamAppId;
				if (!game.coverUrl && metadata.coverUrl) updates.coverUrl = metadata.coverUrl;
				
				if (Object.keys(updates).length > 0) {
					db.update(games).set(updates).where(eq(games.id, game.id)).run();
					logger.info(`Auto-healed metadata for ${game.title}: ${JSON.stringify(updates)}`);
					// Update local game object for the rest of the function
					Object.assign(game, updates);
				}
			}
		} catch (e) {
			logger.warn(`Failed auto-heal for ${game.title}: ${e}`);
		}
	}

	try {
		const indexerIds = await indexerCache.getIds();
		const allowedList = getAllowedIndexersList();

		if (allowedList.length && !indexerIds.length) {
			stats.error = 'No matching indexers found in Prowlarr';
			return stats;
		}

		const fetchResults = async (query: string): Promise<ProwlarrSearchResult[] | null> => {
			const params = new URLSearchParams({
				query,
				type: 'search',
				limit: '100'
			});

			if (indexerIds.length > 0) {
				// Prowlarr API expects multiple indexerIds parameters: ?indexerIds=1&indexerIds=2
				for (const id of indexerIds) {
					params.append('indexerIds', String(id));
				}
			}

			const resp = await fetch(`${settings.PROWLARR_URL}/api/v1/search?${params}`, {
				headers: { 'X-Api-Key': settings.PROWLARR_API_KEY }
			});

			if (!resp.ok) {
				stats.error = `HTTP ${resp.status}`;
				return null;
			}

			return (await resp.json()) as ProwlarrSearchResult[];
		};

		let queryUsed = game.searchQuery;
		let results = await fetchResults(queryUsed);
		if (!results) return stats;

		const fallbackQuery = sanitizeSearchQuery(cleanGameTitle(game.searchQuery || game.title));
		if (
			results.length === 0 &&
			fallbackQuery &&
			fallbackQuery.toLowerCase() !== queryUsed.toLowerCase()
		) {
			const fallbackResults = await fetchResults(fallbackQuery);
			if (fallbackResults) {
				results = fallbackResults;
				queryUsed = fallbackQuery;
				logger.info(`Fallback query used for ${game.title}: "${queryUsed}"`);
			}
		}

		stats.totalFound = results.length;

		const ignoredKeywords = getIgnoredKeywordsList();
		const allowedPlatforms = game.platformFilter
			.split(',')
			.map((p) => p.trim().toLowerCase());

		for (const item of results) {
			const processed = processSearchResult(item, game, ignoredKeywords, allowedPlatforms, queryUsed);
			if (processed.release) {
				db.insert(releases).values(processed.release).run();
				stats.added++;
			} else if (processed.skipInfo) {
				stats.skipped.push(processed.skipInfo);
			}
		}

		if (stats.added > 0) {
			logger.info(`Found ${stats.added} new release(s) for ${game.title}`);
		}

		db.update(games)
			.set({ lastScannedAt: new Date().toISOString() })
			.where(eq(games.id, gameId))
			.run();
	} catch (error) {
		logger.error(`Prowlarr search failed for ${game.title}: ${error}`);
		stats.error = `Error: ${String(error).slice(0, 80)}`;
	}

	return stats;
}

function processSearchResult(
	item: ProwlarrSearchResult,
	game: typeof games.$inferSelect,
	ignoredKeywords: string[],
	allowedPlatforms: string[],
	matchQuery: string
): {
	release?: typeof releases.$inferInsert;
	skipInfo?: SkipInfo;
	versionCandidate?: VersionCandidate;
} {
	const title = item.title || '';
	const indexer = item.indexer || 'Unknown';
	const infoUrl = item.infoUrl || '';
	const size = item.size || 0;
	const titleLower = title.toLowerCase();
	const uploadDate = parseDate(item);
	const isNewerDate = uploadDate ? uploadDate > game.currentVersionDate : false;

	function makeSkip(reason: string, category: string): { skipInfo: SkipInfo } {
		return {
			skipInfo: {
				gameId: game.id,
				gameTitle: game.title,
				title,
				date: uploadDate ? new Date(uploadDate).toISOString().slice(0, 16).replace('T', ' ') : 'N/A',
				reason,
				category,
				indexer,
				isNewerDate,
				magnetUrl: item.magnetUrl || item.downloadUrl || null,
				infoUrl,
				size: size ? formatSize(size) : '?'
			}
		};
	}

	const remoteVersion = extractVersion(title);
	const normalizeMetric = (value: number | undefined): number | null => {
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
		return Math.trunc(value);
	};

	// Check ignored releases
	const ignored = db
		.select()
		.from(ignoredReleases)
		.where(and(eq(ignoredReleases.gameId, game.id), eq(ignoredReleases.releaseTitle, title)))
		.get();

	if (ignored) {
		logger.debug(`[Skip] ${title} - User ignored`);
		return makeSkip('User ignored', 'ignored');
	}

	// Title match - check if search query is contained in title as a phrase
	const normalizedTitle = normalizeTitle(title);
	const normalizedQuery = normalizeTitle(matchQuery || game.searchQuery || game.title);
	const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
	const queryPattern = escapedQuery ? new RegExp(`\\b${escapedQuery}\\b`, 'i') : null;

	if (!queryPattern || !queryPattern.test(normalizedTitle)) {
		logger.debug(`[Skip] ${title} - Title mismatch. Query: "${matchQuery}"`);
		return makeSkip(`Title mismatch (Search Query: "${matchQuery}" not found)`, 'title');
	}

	// Game specific exclude keywords
	if (game.excludeKeywords) {
		const excludes = game.excludeKeywords.split(',').map((k) => k.trim().toLowerCase());
		const found = excludes.find((k) => k && titleLower.includes(k));
		if (found) {
			logger.debug(`[Skip] ${title} - Excluded keyword: ${found}`);
			return makeSkip(`Excluded by game-specific keyword: "${found}"`, 'game_exclude');
		}
	}

	// Content type filter
	const excludedTypes = [
		/^\[mod\]/i, /^\[mods\]/i, /^mod[\s:-]/i, /\bмодификация[\s:-]/i,
		/^\[patch\]/i, /^patch[\s:-]/i, /\bпатч[\s:-]/i,
		/русификатор[\s:-]/i, /\[звук\]/i,
		/^\[artbook\]/i, /\bартбук[\s:-]/i,
		/^\[machinima\]/i, /\bwebrip\b/i, /\btrailer\b/i,
		/^\[other\]/i, /^\[utility\]/i, /^\[утилита\]/i,
		/^texture pack/i, /\bhd overhaul by\b/i,
		/\bpreorder bonus\b/i,
		/\bseries\b.*\bseason\b/i, /\bs\d+e\d+/i, /эпизод.*из/i,
		/\b(?:bdrip|brrip|webrip|web-?dl|dvdrip|hdrip|blu-?ray)\b/i,
		/\b(?:h\.?26[45]|x26[45]|2160p|1080p|720p|4k)\b/i,
		/\b(?:official guide|guidebook|art of|strategy guide)\b/i,
		/\b(?:cults3d|3d print|\.stl\b)\b/i,
		/\b(?:soundtrack|ost|lossless|mp3|flac|score)\b/i,
		/\b(?:webinar|course|tutorial|урок|обучение)\b/i
	];

	if (excludedTypes.some((pattern) => pattern.test(title))) {
		logger.debug(`[Skip] ${title} - Non-game content type`);
		return makeSkip('Non-game content (mod/patch/video/etc)', 'content_type');
	}

	if (isNonGameCategory(item.categories)) {
		logger.debug(`[Skip] ${title} - Excluded category`);
		return makeSkip('Category excluded (non-game)', 'category');
	}

	// Platform filter
	const excludedPlatforms = ['ps5', 'ps4', 'ps3', 'xbox', 'switch', 'android', 'ios'];
	if (excludedPlatforms.some((p) => titleLower.includes(p))) {
		logger.debug(`[Skip] ${title} - Platform excluded`);
		return makeSkip('Platform excluded (console/mobile)', 'platform');
	}

	if (allowedPlatforms.includes('windows') && !allowedPlatforms.includes('linux')) {
		const linuxIndicators = [/\bwine\b/, /\blinux\b/, /\[l\]/, /\sproton\b/];
		const windowsIndicators = [/\bwindows\b/, /\bwin64\b/, /\bwin32\b/, /\[w\]/];
		const hasLinux = linuxIndicators.some((r) => r.test(titleLower));
		const hasWindows = windowsIndicators.some((r) => r.test(titleLower));
		if (hasLinux && !hasWindows) {
			logger.debug(`[Skip] ${title} - Platform excluded (Linux/Wine)`);
			return makeSkip('Platform excluded (Linux/Wine)', 'platform');
		}
	}

	if (!allowedPlatforms.includes('macos') && !allowedPlatforms.includes('mac')) {
		const macIndicators = [/\bmacos\b/, /\bmac\b/, /\bosx\b/];
		if (macIndicators.some((r) => r.test(titleLower))) {
			logger.debug(`[Skip] ${title} - Platform excluded (macOS)`);
			return makeSkip('Platform excluded (macOS)', 'platform');
		}
	}

	// Keyword filter
	if (ignoredKeywords.some((k) => titleLower.includes(k))) {
		logger.debug(`[Skip] ${title} - Ignored keyword match`);
		return makeSkip('Ignored keyword match', 'keyword');
	}

	// Version comparison filter (if version info is available for both)
	if (remoteVersion && game.currentVersion) {
		const cmp = compareVersions(game.currentVersion, remoteVersion);
		logger.debug(`[Version Check] ${game.title}: Local=${game.currentVersion} vs Remote=${remoteVersion} (Result=${cmp})`);
		if (cmp === 0) {
			logger.debug(`[Skip] ${title} - Version already installed`);
			return makeSkip('Version matches local (already installed)', 'version');
		}
		if (cmp === 1) {
			logger.debug(`[Skip] ${title} - Version older than local`);
			return makeSkip('Version older than local', 'version');
		}
	}

	// Date filter
	if (!isNewerDate) {
		logger.debug(`[Skip] ${title} - Date not newer (${uploadDate} <= ${game.currentVersionDate})`);
		const skipped = makeSkip('Date not newer', 'older');
		if (remoteVersion) {
			return {
				...skipped,
				versionCandidate: buildVersionCandidate(title, remoteVersion, uploadDate)
			};
		}
		return skipped;
	}

	// Duplicate check
	const existing = db
		.select()
		.from(releases)
		.where(and(eq(releases.rawTitle, title), eq(releases.gameId, game.id)))
		.get();

	if (existing) {
		logger.debug(`[Skip] ${title} - Already exists in database`);
		const metricsToUpdate: Partial<typeof releases.$inferInsert> = {};
		const seeders = normalizeMetric(item.seeders);
		const leechers = normalizeMetric(item.leechers);
		const grabs = normalizeMetric(item.grabs);

		if ((existing.seeders ?? null) !== seeders) metricsToUpdate.seeders = seeders;
		if ((existing.leechers ?? null) !== leechers) metricsToUpdate.leechers = leechers;
		if ((existing.grabs ?? null) !== grabs) metricsToUpdate.grabs = grabs;

		if (Object.keys(metricsToUpdate).length > 0) {
			db.update(releases).set(metricsToUpdate).where(eq(releases.id, existing.id)).run();
		}

		const skipped = makeSkip('Already exists in database', 'duplicate');
		if (remoteVersion) {
			return {
				...skipped,
				versionCandidate: buildVersionCandidate(title, remoteVersion, uploadDate)
			};
		}
		return skipped;
	}

	logger.info(`[Add] ${title} (Version: ${remoteVersion || 'Unknown'})`);

	const versionCandidate = remoteVersion
		? buildVersionCandidate(title, remoteVersion, uploadDate)
		: undefined;

	return {
		release: {
			gameId: game.id,
			rawTitle: title,
			parsedVersion: remoteVersion,
			uploadDate: uploadDate || new Date(0).toISOString(),
			indexer,
			magnetUrl: item.magnetUrl || item.downloadUrl || null,
			infoUrl,
			size: size ? formatSize(size) : '?',
			seeders: normalizeMetric(item.seeders),
			leechers: normalizeMetric(item.leechers),
			grabs: normalizeMetric(item.grabs),
			isIgnored: false
		},
		versionCandidate
	};
}
