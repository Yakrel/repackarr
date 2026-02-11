import { settings, isIgdbEnabled } from './config.js';
import { db } from './database.js';
import { games } from './schema.js';
import { eq } from 'drizzle-orm';
import { logger } from './logger.js';
import {
	extractVersion,
	sanitizeSearchQuery,
	fuzzyMatchTitles,
	parseTorrentTitle,
	extractSourceUrl
} from './utils.js';
import { getGameMetadata } from './igdb.js';
import { retryAsync } from './validators.js';
import type { QBitTorrentInfo } from './types.js';

/**
 * qBittorrent WebUI client service
 * Handles authentication, torrent fetching, and game syncing
 */
export class QBitService {
	private baseUrl: string;
	private cookies: string = '';
	private sourceVersionCache = new Map<string, string | null>();

	constructor() {
		this.baseUrl = settings.QBIT_HOST;
	}

	/**
	 * Authenticates with qBittorrent WebUI
	 * Uses retry logic for reliability
	 * @returns true if login successful, false otherwise
	 */
	async login(): Promise<boolean> {
		try {
			const success = await retryAsync(
				async () => {
					const resp = await fetch(`${this.baseUrl}/api/v2/auth/login`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
						body: new URLSearchParams({
							username: settings.QBIT_USERNAME,
							password: settings.QBIT_PASSWORD
						})
					});

					if (!resp.ok) {
						throw new Error(`qBittorrent login failed: ${resp.status}`);
					}

					const setCookie = resp.headers.get('set-cookie');
					if (!setCookie) {
						throw new Error('No cookie in login response');
					}

					// Properly extract session cookie (first cookie before first semicolon)
					const cookieMatch = setCookie.match(/^([^;]+)/);
					if (!cookieMatch) {
						throw new Error('Invalid cookie format');
					}

					this.cookies = cookieMatch[1];
					return true;
				},
				{
					maxAttempts: 2,
					delayMs: 1000,
					onRetry: (attempt) => {
						logger.warn(`qBittorrent login attempt ${attempt} failed, retrying...`);
					}
				}
			);

			if (success) {
				logger.info('qBittorrent authenticated');
			}
			return success;
		} catch (error) {
			logger.error(`qBittorrent connection error: ${error}`);
			return false;
		}
	}

	/**
	 * Fetches torrents from qBittorrent for the configured category
	 * @private
	 * @returns Array of torrents or empty array on failure
	 */
	private async fetchTorrents(): Promise<QBitTorrentInfo[]> {
		if (!this.cookies) {
			if (!(await this.login())) return [];
		}

		try {
			const resp = await fetch(
				`${this.baseUrl}/api/v2/torrents/info?category=${encodeURIComponent(settings.QBIT_CATEGORY)}`,
				{ headers: { Cookie: this.cookies } }
			);
			
			if (!resp.ok) {
				logger.error(`qBittorrent API error: ${resp.status}`);
				return [];
			}
			
			return await resp.json();
		} catch (error) {
			logger.error(`Failed to fetch torrents: ${error}`);
			return [];
		}
	}

	private async fetchTorrentComment(hash: string): Promise<string | null> {
		if (!hash) return null;
		if (!this.cookies) {
			if (!(await this.login())) return null;
		}

		try {
			const resp = await fetch(
				`${this.baseUrl}/api/v2/torrents/properties?hash=${encodeURIComponent(hash)}`,
				{ headers: { Cookie: this.cookies } }
			);

			if (!resp.ok) {
				logger.warn(`Failed to fetch torrent properties for ${hash}: ${resp.status}`);
				return null;
			}

			const properties = (await resp.json()) as { comment?: string };
			return properties.comment?.trim() || null;
		} catch (error) {
			logger.warn(`Failed to fetch torrent comment for ${hash}: ${error}`);
			return null;
		}
	}

	/**
	 * Fetches game torrents from configured category
	 * @returns Array of torrent info with names and completion dates
	 */
	async getGameTorrents(): Promise<Array<{ name: string; completion_on: number }>> {
		const torrents = await this.fetchTorrents();
		return torrents.map((t) => ({
			name: t.name || '',
			completion_on: t.completion_on || t.added_on || 0
		}));
	}

	/**
	 * Syncs games from qBittorrent to local database
	 * Creates new games or updates existing ones
	 * Unlinks games that are no longer in qBittorrent
	 * @returns Number of games synced
	 */
	async syncGames(): Promise<number> {
		const torrents = await this.fetchTorrents();
		if (!torrents.length) return 0;

		const syncStartTime = new Date().toISOString();
		let syncedCount = 0;

		// Load all games once to avoid N+1 queries
		const allGames = db.select().from(games).all();

		for (const torrent of torrents) {
			try {
				if (await this.processTorrent(torrent, allGames)) {
					syncedCount++;
				}
			} catch (error) {
				logger.error(`Error processing torrent ${torrent.name}: ${error}`);
			}
		}

		// Unlink games no longer in qBittorrent - use batch update
		const gamesToUnlink = allGames.filter(
			(game) => game.qbitSyncedAt && game.qbitSyncedAt < syncStartTime
		);
		
		for (const game of gamesToUnlink) {
			db.update(games).set({ qbitSyncedAt: null }).where(eq(games.id, game.id)).run();
			logger.info(`Unlinked '${game.title}' from qBittorrent`);
		}

		logger.info(`Synced ${syncedCount} game(s) from qBittorrent`);
		return syncedCount;
	}

	private async processTorrent(
		torrent: QBitTorrentInfo,
		allGames: Array<typeof games.$inferSelect>
	): Promise<boolean> {
		let ts = torrent.completion_on || 0;
		if (ts <= 0) ts = torrent.added_on || 0;
		if (ts <= 0) return false;

		const torrentDate = new Date(ts * 1000).toISOString();
		const rawName = torrent.name || '';
		if (!rawName) return false;

		const title = parseTorrentTitle(rawName);
		if (!title) {
			logger.warn(`Could not parse title from: ${rawName}`);
			return false;
		}

		const detectedVersion = extractVersion(rawName);
		let sourceUrl = extractSourceUrl(torrent.comment, rawName);
		if (!sourceUrl) {
			const comment = await this.fetchTorrentComment(torrent.hash);
			sourceUrl = extractSourceUrl(comment);
		}
		let resolvedVersion = detectedVersion;
		if (!resolvedVersion && sourceUrl) {
			resolvedVersion = await this.extractVersionFromSourcePage(sourceUrl);
		}
		let searchQuery = sanitizeSearchQuery(title);
		if (!searchQuery) searchQuery = title;

		// Use fuzzy matching to find existing games (allGames already loaded)
		const matchedGame = allGames.find((g) => fuzzyMatchTitles(g.title, title));

		if (!matchedGame) {
			return await this.addNewGame(title, searchQuery, resolvedVersion, torrentDate, sourceUrl);
		} else {
			return await this.updateExistingGame(matchedGame, resolvedVersion, torrentDate, sourceUrl);
		}
	}

	private async extractVersionFromSourcePage(sourceUrl: string): Promise<string | null> {
		const cached = this.sourceVersionCache.get(sourceUrl);
		if (cached !== undefined) return cached;

		try {
			const resp = await fetch(sourceUrl, {
				headers: {
					'User-Agent': 'Repackarr/0.1 (+https://github.com/Yakrel/repackarr)'
				}
			});
			if (!resp.ok) {
				logger.warn(`Could not fetch source page for version (${resp.status}): ${sourceUrl}`);
				this.sourceVersionCache.set(sourceUrl, null);
				return null;
			}

			const html = await resp.text();
			const candidates = [
				html.match(/<title[^>]*>([^<]{1,700})<\/title>/i)?.[1] ?? '',
				html.match(/property=["']og:title["'][^>]*content=["']([^"']{1,700})["']/i)?.[1] ?? '',
				(html.match(/<h1[^>]*>(.*?)<\/h1>/is)?.[1] ?? '').replace(/<[^>]+>/g, ' ')
			]
				.map((value) => value.replace(/\s+/g, ' ').trim())
				.filter(Boolean);

			for (const candidate of candidates) {
				const version = extractVersion(candidate);
				if (version) {
					this.sourceVersionCache.set(sourceUrl, version);
					return version;
				}
			}

			this.sourceVersionCache.set(sourceUrl, null);
			return null;
		} catch (error) {
			logger.warn(`Failed to resolve version from source ${sourceUrl}: ${error}`);
			this.sourceVersionCache.set(sourceUrl, null);
			return null;
		}
	}

	private async addNewGame(
		title: string,
		searchQuery: string,
		version: string | null,
		torrentDate: string,
		sourceUrl: string | null
	): Promise<boolean> {
		logger.info(`New game detected: ${title} (v${version || 'unknown'})`);

		let coverUrl: string | undefined;
		let steamAppId: number | undefined;

		if (isIgdbEnabled()) {
			try {
				const { cleanGameTitle } = await import('./utils.js');
				const cleanedTitle = cleanGameTitle(title);
				const metadata = await getGameMetadata(cleanedTitle);
				if (metadata) {
					coverUrl = metadata.coverUrl;
					steamAppId = metadata.steamAppId;
				}
			} catch (error) {
				logger.warn(`Failed to fetch IGDB metadata for ${title}: ${error}`);
			}
		}

		db.insert(games)
			.values({
				title,
				searchQuery,
				currentVersionDate: torrentDate,
				currentVersion: version,
				status: 'monitored',
				coverUrl: coverUrl ?? null,
				steamAppId: steamAppId ?? null,
				sourceUrl,
				isManual: false,
				qbitSyncedAt: new Date().toISOString()
			})
			.run();

		logger.info(`Added ${title} to library`);
		return true;
	}

	private async updateExistingGame(
		game: typeof games.$inferSelect,
		version: string | null,
		torrentDate: string,
		sourceUrl: string | null
	): Promise<boolean> {
		const updates: Record<string, unknown> = {
			qbitSyncedAt: new Date().toISOString()
		};

		if (torrentDate > game.currentVersionDate) {
			logger.info(`Updating ${game.title}: v${game.currentVersion || '?'} -> v${version || '?'}`);
			updates.currentVersionDate = torrentDate;
			if (version) updates.currentVersion = version;
			if (sourceUrl) updates.sourceUrl = sourceUrl;
		} else {
			// Backfill metadata when timestamp is unchanged but stored fields are empty
			if (!game.currentVersion && version) updates.currentVersion = version;
			if (!game.sourceUrl && sourceUrl) updates.sourceUrl = sourceUrl;
		}

		// Retry IGDB metadata if missing
		if ((!game.coverUrl || !game.steamAppId) && isIgdbEnabled()) {
			try {
				const { cleanGameTitle } = await import('./utils.js');
				const cleanedTitle = cleanGameTitle(game.title);
				const metadata = await getGameMetadata(cleanedTitle);
				if (metadata) {
					if (!game.coverUrl && metadata.coverUrl) {
						updates.coverUrl = metadata.coverUrl;
					}
					if (!game.steamAppId && metadata.steamAppId) {
						updates.steamAppId = metadata.steamAppId;
					}
				}
			} catch (error) {
				logger.warn(`Failed to retry IGDB metadata for ${game.title}: ${error}`);
			}
		}

		db.update(games).set(updates).where(eq(games.id, game.id)).run();
		return true;
	}

	/**
	 * Adds a torrent to qBittorrent using magnet URL
	 * Uses retry logic for reliability
	 * @param magnetUrl - Magnet URL or download link
	 * @returns true if successfully added, false otherwise
	 */
	async addTorrent(magnetUrl: string): Promise<boolean> {
		if (!this.cookies) {
			if (!(await this.login())) return false;
		}

		try {
			const success = await retryAsync(
				async () => {
					const resp = await fetch(`${this.baseUrl}/api/v2/torrents/add`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/x-www-form-urlencoded',
							Cookie: this.cookies
						},
						body: new URLSearchParams({
							urls: magnetUrl,
							category: settings.QBIT_CATEGORY
						})
					});

					if (!resp.ok) {
						throw new Error(`Failed to add torrent: ${resp.status}`);
					}
					return true;
				},
				{
					maxAttempts: 2,
					delayMs: 1000,
					onRetry: (attempt) => {
						logger.warn(`Failed to add torrent, attempt ${attempt}, retrying...`);
					}
				}
			);

			if (success) {
				logger.info('Sent magnet to qBittorrent');
			}
			return success;
		} catch (error) {
			logger.error(`Exception adding torrent: ${error}`);
			return false;
		}
	}
}
