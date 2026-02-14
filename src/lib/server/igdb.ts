import { settings, isIgdbEnabled } from './config.js';
import type { IGDBGame, IGDBTokenResponse, GameMetadata } from './types.js';
import { logger } from './logger.js';

let accessToken: string | null = null;
let tokenExpiry = 0;

// Simple in-memory cache for autocomplete results
const autocompleteCache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

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

		const query = `fields name, cover.image_id, category, platforms, external_games.*; search "${gameName}"; limit 5;`;

		const resp = await fetch('https://api.igdb.com/v4/games', {
			method: 'POST',
			headers,
			body: query
		});

		if (!resp.ok) return null;

		const results: IGDBGame[] = await resp.json();
		if (!results?.length) return null;

		const normalizeForMatch = (value: string): string =>
			value
				.toLowerCase()
				.replace(/[^a-z0-9\s]/g, ' ')
				.split(/\s+/)
				.filter(Boolean)
				.join(' ')
				.trim();

		const queryVariants = new Set<string>();
		queryVariants.add(normalizeForMatch(gameName));
		const slashBase = gameName.split('/')[0]?.trim();
		if (slashBase) queryVariants.add(normalizeForMatch(slashBase));

		const scoreMatch = (g: IGDBGame): number => {
			const name = g.name || '';
			const normalizedName = normalizeForMatch(name);
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
			if (g.platforms?.some(p => (typeof p === 'object' ? p.id === 6 : p === 6))) {
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

		const externalGames = target.external_games || [];
		for (const ext of externalGames) {
			const source = ext.external_game_source ?? ext.category;
			const steamIdFromUrl = ext.url?.match(/store\.steampowered\.com\/app\/(\d+)/i)?.[1];

			// Source/Category 1 = Steam
			if ((source === 1 && ext.uid) || steamIdFromUrl) {
				const uid = parseInt(steamIdFromUrl || ext.uid!, 10);
				if (!isNaN(uid)) {
					result.steamAppId = uid;
					break;
				}
			}
		}

		if (result.name || result.coverUrl || result.steamAppId) {
			logger.info(`IGDB metadata for ${gameName}: ${JSON.stringify(result)}`);
			return result;
		}
		return null;
	} catch (error) {
		logger.error(`IGDB error for ${gameName}: ${error}`);
		return null;
	}
}

/**
 * Searches IGDB for games matching query (autocomplete)
 * Returns up to 10 results with game name and release year
 * @param query - Search query string
 * @param platform - Platform filter (Windows, Linux, macOS)
 * @returns Array of game suggestions with display names
 */
export async function searchGamesAutocomplete(
	query: string,
	platform: string = 'Windows'
): Promise<Array<{ name: string; display: string }>> {
	if (!query || query.length < 2 || !isIgdbEnabled()) return [];

	const cacheKey = `${query.toLowerCase()}:${platform}`;
	const cached = autocompleteCache.get(cacheKey);
	if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
		return cached.data;
	}

	try {
		const headers = await getHeaders();
		if (!headers) return [];

		// Map UI platform names to IGDB platform IDs
		const platformMap: Record<string, number[]> = {
			'Windows': [6],
			'Linux': [3],
			'macOS': [14],
			'Windows,Linux': [6, 3]
		};
		
		const platformIds = platformMap[platform] || [6];
		const platformFilter = `where platforms = (${platformIds.join(',')});`;

		const body = `fields name, first_release_date, platforms; search "${query}"; ${platformFilter} limit 10;`;
		const resp = await fetch('https://api.igdb.com/v4/games', {
			method: 'POST',
			headers,
			body
		});

		if (!resp.ok) return [];

		const results: IGDBGame[] = await resp.json();
		const suggestions = results.map((game) => {
			const name = game.name || '';
			let display = name;
			if (game.first_release_date) {
				try {
					const year = new Date(game.first_release_date * 1000).getFullYear();
					display = `${name} (${year})`;
				} catch (error) {
					logger.warn(`Failed to parse release date for ${name}: ${error}`);
				}
			}
			return { name, display };
		});

		// Store in cache
		autocompleteCache.set(cacheKey, { data: suggestions, timestamp: Date.now() });
		
		return suggestions;
	} catch (error) {
		logger.error(`IGDB autocomplete error: ${error}`);
		return [];
	}
}
