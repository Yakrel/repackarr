import { settings, isIgdbEnabled } from './config.js';
import type { IGDBGame, IGDBSuggestion, IGDBTokenResponse, GameMetadata } from './types.js';
import { logger } from './logger.js';

let accessToken: string | null = null;
let tokenExpiry = 0;

// Simple in-memory cache for autocomplete results
const autocompleteCache = new Map<string, { data: IGDBSuggestion[], timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const AUTOCOMPLETE_LIMIT = 20;
const DISPLAY_LIMIT = 10;

const platformMap: Record<string, number[]> = {
	'Windows': [6],
	'Linux': [3],
	'macOS': [14],
	'Windows,Linux': [6, 3]
};

function escapeApicalypseString(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeForSearch(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.join(' ')
		.trim();
}

function gameYear(game: IGDBGame): number | undefined {
	if (!game.first_release_date) return undefined;
	try {
		return new Date(game.first_release_date * 1000).getFullYear();
	} catch {
		return undefined;
	}
}

function getSteamAppId(game: IGDBGame): number | undefined {
	for (const ext of game.external_games || []) {
		const source = ext.external_game_source ?? ext.category;
		const steamIdFromUrl = ext.url?.match(/store\.steampowered\.com\/app\/(\d+)/i)?.[1];
		if ((source === 1 && ext.uid) || steamIdFromUrl) {
			const uid = parseInt(steamIdFromUrl || ext.uid!, 10);
			if (!isNaN(uid)) return uid;
		}
	}
}

function hasPlatform(game: IGDBGame, platformId: number): boolean {
	return Boolean(
		game.platforms?.some((platform) =>
			typeof platform === 'object' ? platform.id === platformId : platform === platformId
		)
	);
}

function isEditionLike(name: string): boolean {
	return /\b(?:bundle|double pack|collector'?s|deluxe|ultimate|complete|goty|game of the year|premium|launch|special|edition|dlc|expansion)\b/i.test(name);
}

export function rankAutocompleteGames(query: string, games: IGDBGame[]): IGDBGame[] {
	const normalizedQuery = normalizeForSearch(query);

	const score = (game: IGDBGame): number => {
		const normalizedName = normalizeForSearch(game.name || '');
		let value = 0;

		if (normalizedName === normalizedQuery) value += 1000;
		else if (normalizedName.startsWith(normalizedQuery)) value += 800;
		else if (normalizedName.split(/\s+/).some((token) => token.startsWith(normalizedQuery))) value += 650;
		else if (normalizedName.includes(normalizedQuery)) value += 450;

		if (!game.version_parent) value += 120;
		else value -= 180;

		if (isEditionLike(game.name || '')) value -= 140;
		if (hasPlatform(game, 6)) value += 20;

		value += Math.min(game.total_rating_count ?? game.rating_count ?? 0, 1000) / 5;
		value += Math.min(game.hypes ?? 0, 250) / 10;

		return value;
	};

	return [...games].sort((a, b) => score(b) - score(a));
}

function toSuggestion(game: IGDBGame): IGDBSuggestion {
	const year = gameYear(game);
	return {
		name: game.name || '',
		display: year ? `${game.name} (${year})` : game.name || '',
		igdbId: game.id,
		year,
		steamAppId: getSteamAppId(game)
	};
}

function dedupeGamesById(games: IGDBGame[]): IGDBGame[] {
	const seen = new Set<number>();
	const deduped: IGDBGame[] = [];
	for (const game of games) {
		if (seen.has(game.id)) continue;
		seen.add(game.id);
		deduped.push(game);
	}
	return deduped;
}

export function buildAutocompleteQuery(query: string, platform: string): string {
	const platformIds = platformMap[platform] || platformMap.Windows;
	const platformFilter = `platforms = (${platformIds.join(',')})`;
	const escaped = escapeApicalypseString(query);
	return `fields name, first_release_date, platforms, category, version_parent, rating_count, total_rating_count, hypes, external_games.*; where name ~ *"${escaped}"* & ${platformFilter}; sort total_rating_count desc; limit ${AUTOCOMPLETE_LIMIT};`;
}

/**
 * Retrieves or refreshes IGDB OAuth token
 * @returns Access token or null if authentication failed
 */
async function getToken(): Promise<string | null> {
	if (!isIgdbEnabled()) return null;

	if (accessToken && Date.now() < tokenExpiry) {
		return accessToken;
	}

	try {
		const resp = await fetch('https://id.twitch.tv/oauth2/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: settings.IGDB_CLIENT_ID,
				client_secret: settings.IGDB_CLIENT_SECRET,
				grant_type: 'client_credentials'
			})
		});

		if (!resp.ok) {
			logger.error(`IGDB auth failed: ${resp.status}`);
			return null;
		}

		const data: IGDBTokenResponse = await resp.json();
		accessToken = data.access_token;
		tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
		logger.info('IGDB token acquired');
		return accessToken;
	} catch (error) {
		logger.error(`IGDB auth error: ${error}`);
		return null;
	}
}

/**
 * Gets authenticated headers for IGDB API requests
 * @private
 * @returns Headers object or null if authentication failed
 */
async function getHeaders(): Promise<Record<string, string> | null> {
	const token = await getToken();
	if (!token) return null;

	return {
		'Client-ID': settings.IGDB_CLIENT_ID,
		Authorization: `Bearer ${token}`,
		Accept: 'application/json'
	};
}

/**
 * Fetches game metadata from IGDB API
 * Searches for game by name and returns cover art and Steam App ID
 * @param gameName - Name of the game to search for
 * @returns GameMetadata with cover URL and Steam ID, or null if not found
 */
export async function getGameMetadata(gameName: string): Promise<GameMetadata | null> {
	if (!gameName) return null;

	try {
		const headers = await getHeaders();
		if (!headers) return null;

		const query = `fields name, cover.image_id, category, platforms, external_games.*; search "${escapeApicalypseString(gameName)}"; limit 10;`;

		const resp = await fetch('https://api.igdb.com/v4/games', {
			method: 'POST',
			headers,
			body: query
		});

		if (!resp.ok) return null;

		const results: IGDBGame[] = await resp.json();
		if (!results?.length) return null;

		const queryVariants = new Set<string>();
		queryVariants.add(normalizeForSearch(gameName));
		const slashBase = gameName.split('/')[0]?.trim();
		if (slashBase) queryVariants.add(normalizeForSearch(slashBase));

		const scoreMatch = (g: IGDBGame): number => {
			const name = g.name || '';
			const normalizedName = normalizeForSearch(name);
			let bestScore = 0;
			for (const variant of queryVariants) {
				if (!variant) continue;
				if (normalizedName === variant) bestScore = Math.max(bestScore, 100);
				else if (normalizedName.startsWith(variant)) bestScore = Math.max(bestScore, 80);
				else if (variant.startsWith(normalizedName)) bestScore = Math.max(bestScore, 70);
				else if (normalizedName.includes(variant) || variant.includes(normalizedName)) {
					bestScore = Math.max(bestScore, 60);
				}
			}
			
			// Boost score if it's a PC game
			if (hasPlatform(g, 6)) {
				bestScore += 10;
			}
			
			return bestScore;
		};

		const rankedResults = results
			.map((g) => ({ game: g, score: scoreMatch(g) }))
			.sort((a, b) => b.score - a.score);
		const target = rankedResults[0]?.game || results[0];

		const result: GameMetadata = {
			name: target.name,
			igdbId: target.id,
			coverUrl: undefined,
			steamAppId: undefined
		};

		if (target.cover?.image_id) {
			result.coverUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${target.cover.image_id}.jpg`;
		}

		// Look for Steam App ID from all well-matched results (score >= 60), not just the top one.
		// This handles games where the top IGDB entry (e.g. original console version) lacks Steam data
		// but a secondary entry (e.g. later PC port) has it.
		for (const { game: candidate } of rankedResults.filter(r => r.score >= 60)) {
			result.steamAppId = getSteamAppId(candidate);
			if (result.steamAppId) break;
		}

		if (result.name || result.coverUrl || result.steamAppId) {
			logger.info(`[IGDB] Metadata found for '${gameName}': ${result.name} (ID: ${result.igdbId}, Steam: ${result.steamAppId || 'N/A'})`);
			logger.debug(`IGDB metadata for ${gameName}: ${JSON.stringify(result)}`);
			return result;
		}
		return null;
	} catch (error) {
		logger.error(`IGDB error for ${gameName}: ${error}`);
		return null;
	}
}

export async function getGameMetadataById(igdbId: number): Promise<GameMetadata | null> {
	if (!igdbId || !isIgdbEnabled()) return null;

	try {
		const headers = await getHeaders();
		if (!headers) return null;

		const body = `fields name, cover.image_id, external_games.*; where id = ${igdbId}; limit 1;`;
		const resp = await fetch('https://api.igdb.com/v4/games', { method: 'POST', headers, body });
		if (!resp.ok) {
			logger.warn(`IGDB metadata by ID failed for ${igdbId}: HTTP ${resp.status}`);
			return null;
		}

		const [game] = (await resp.json()) as IGDBGame[];
		if (!game) return null;

		return {
			name: game.name,
			igdbId: game.id,
			coverUrl: game.cover?.image_id
				? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
				: undefined,
			steamAppId: getSteamAppId(game)
		};
	} catch (error) {
		logger.error(`IGDB metadata by ID error for ${igdbId}: ${error}`);
		return null;
	}
}

/**
 * Searches IGDB for games matching query (autocomplete).
 * Uses a single wildcard name query because IGDB full-text search can return no rows
 * for useful prefixes such as "subna".
 */
export async function searchGamesAutocomplete(
	query: string,
	platform: string = 'Windows'
): Promise<IGDBSuggestion[]> {
	if (!query || query.length < 2 || !isIgdbEnabled()) return [];

	const trimmedQuery = query.trim();
	const cacheKey = `${trimmedQuery.toLowerCase()}:${platform}`;
	const cached = autocompleteCache.get(cacheKey);
	if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
		return cached.data;
	}

	try {
		const headers = await getHeaders();
		if (!headers) return [];

		const body = buildAutocompleteQuery(trimmedQuery, platform);
		const resp = await fetch('https://api.igdb.com/v4/games', { method: 'POST', headers, body });
		if (!resp.ok) {
			logger.warn(`IGDB autocomplete failed for '${trimmedQuery}': HTTP ${resp.status}`);
			return [];
		}

		const results = dedupeGamesById((await resp.json()) as IGDBGame[]);
		const suggestions = rankAutocompleteGames(trimmedQuery, results)
			.slice(0, DISPLAY_LIMIT)
			.map(toSuggestion);

		autocompleteCache.set(cacheKey, { data: suggestions, timestamp: Date.now() });
		return suggestions;
	} catch (error) {
		logger.error(`IGDB autocomplete error: ${error}`);
		return [];
	}
}
