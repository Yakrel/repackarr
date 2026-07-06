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
import type { TorrentInfo } from './types.js';

class QBitService {
	private baseUrl: string;
	private cookies: string = '';

	constructor() {
		this.baseUrl = settings.QBIT_HOST;
	}

	async login(forceRefresh = false): Promise<boolean> {
		if (!this.baseUrl) {
			logger.warn('[qBit] QBIT_HOST is not configured — check your .env file.');
			return false;
		}
		if (forceRefresh) this.cookies = '';
		if (this.cookies) return true;
		try {
			const success = await retryAsync(
				async () => {
					const resp = await fetch(`${this.baseUrl}/api/v2/auth/login`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
						body: new URLSearchParams({ username: settings.QBIT_USERNAME, password: settings.QBIT_PASSWORD })
					});
					if (!resp.ok) return false;
					const text = await resp.text();
					if (resp.status !== 204 && text.trim() !== 'Ok.') return false;
					const setCookie = resp.headers.get('set-cookie');
					if (setCookie) this.cookies = setCookie.split(';')[0];
					return true;
				},
				{ maxAttempts: 2, delayMs: 1000 }
			);
			return success;
		} catch { return false; }
	}

	private async fetchTorrents(retried = false): Promise<TorrentInfo[]> {
		if (!(await this.login())) return [];
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/torrents/info?category=${encodeURIComponent(settings.QBIT_CATEGORY)}`, { headers: { Cookie: this.cookies } });
			if (resp.status === 403 && !retried) { this.cookies = ''; return this.fetchTorrents(true); }
			return resp.ok ? await resp.json() : [];
		} catch { return []; }
	}

	private async fetchTorrentComment(hash: string, retried = false): Promise<string | null> {
		if (!(await this.login())) return null;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/torrents/properties?hash=${encodeURIComponent(hash)}`, { headers: { Cookie: this.cookies } });
			if (resp.status === 403 && !retried) { this.cookies = ''; return this.fetchTorrentComment(hash, true); }
			const props = await resp.json();
			return props.comment?.trim() || null;
		} catch { return null; }
	}

	async getActiveDownloads(): Promise<TorrentInfo[]> {
		return this.fetchTorrents();
	}

	async getTorrent(hash: string, retried = false): Promise<TorrentInfo | null> {
		if (!(await this.login())) return null;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/torrents/info?hashes=${hash}`, { headers: { Cookie: this.cookies } });
			if (resp.status === 403 && !retried) { this.cookies = ''; return this.getTorrent(hash, true); }
			if (!resp.ok) return null;
			const torrents = await resp.json();
			return torrents.length > 0 ? torrents[0] : null;
		} catch { return null; }
	}

	async syncGames(): Promise<number> {
		const torrents = await this.fetchTorrents();
		if (!torrents.length) return 0;
		const syncStartTime = new Date().toISOString();
		
		let processedCount = 0;
		for (const torrent of torrents) {
			try {
				const allGames = db.select().from(games).all();
				const success = await this.processTorrent(torrent, allGames);
				if (success) processedCount++;
			} catch (error) {
				logger.error(`[qBit] Error processing torrent ${torrent.name || ''}: ${error}`);
			}
		}
		
		const currentGames = db.select().from(games).all();
		const gamesToUnlink = currentGames.filter(g => g.qbitSyncedAt && g.qbitSyncedAt < syncStartTime);
		for (const g of gamesToUnlink) {
			db.update(games).set({ qbitSyncedAt: null }).where(eq(games.id, g.id)).run();
			logger.info(`Unlinked '${g.title}'`);
		}
		return processedCount;
	}

	private async processTorrent(torrent: TorrentInfo, allGames: Array<typeof games.$inferSelect>): Promise<boolean> {
		const ts = torrent.added_on || torrent.completion_on || 0;
		if (ts <= 0) return false;

		const torrentDate = new Date(ts * 1000).toISOString();
		const rawName = torrent.name || '';
		const title = parseTorrentTitle(rawName);
		if (!title) return false;

		const detectedVersion = extractVersion(rawName);
		let sourceUrl = torrent.comment?.trim() || null;
		if (!sourceUrl || !sourceUrl.startsWith('http')) {
			sourceUrl = await this.fetchTorrentComment(torrent.hash);
		}

		const matchedGame = allGames.find((g) => {
			if (g.infoHash && g.infoHash === torrent.hash) return true;
			if (fuzzyMatchTitles(g.title, title)) return true;
			if (g.rawName) {
				const parsedRawName = parseTorrentTitle(g.rawName);
				if (parsedRawName && fuzzyMatchTitles(parsedRawName, title)) return true;
			}
			return false;
		});

		if (!matchedGame) {
			return await this.addNewGame(title, sanitizeSearchQuery(title), detectedVersion, torrentDate, sourceUrl, rawName, torrent.hash);
		} else {
			return await this.updateExistingGame(matchedGame, detectedVersion, torrentDate, sourceUrl, title, rawName, torrent.hash);
		}
	}

	private async addNewGame(title: string, searchQuery: string, version: string | null, torrentDate: string, sourceUrl: string | null, rawName: string, infoHash: string): Promise<boolean> {
		logger.info(`New game: ${title} (v${version || '?'})`);
		let coverUrl: string | null = null, steamAppId: number | null = null, igdbId: number | null = null, igdbName: string | undefined;

		if (isIgdbEnabled()) {
			try {
				const { getGameMetadata } = await import('./igdb.js');
				const { cleanGameTitle } = await import('./utils.js');
				const meta = await getGameMetadata(cleanGameTitle(title));
				if (meta) {
					coverUrl = meta.coverUrl || null;
					steamAppId = meta.steamAppId || null;
					igdbId = meta.igdbId || null;
					igdbName = meta.name;
				}
			} catch {}
		}

		db.insert(games).values({
			title: igdbName || title, searchQuery: igdbName || searchQuery,
			currentVersionDate: torrentDate, currentVersion: version,
			status: 'monitored', coverUrl, steamAppId, igdbId,
			sourceUrl, rawName, infoHash, isManual: false, qbitSyncedAt: new Date().toISOString()
		}).run();
		return true;
	}

	private async updateExistingGame(game: any, version: string | null, torrentDate: string, sourceUrl: string | null, newTitle: string, rawName: string, infoHash: string): Promise<boolean> {
		const updates: any = { qbitSyncedAt: new Date().toISOString(), isManual: false, rawName, infoHash };
		if (!game.igdbId && game.title !== newTitle) {
			logger.info(`Auto-rename: '${game.title}' -> '${newTitle}'`);
			updates.title = newTitle;
			updates.searchQuery = newTitle;
		}
		if (!game.sourceUrl && sourceUrl) updates.sourceUrl = sourceUrl;
		if (torrentDate > game.currentVersionDate) {
			updates.currentVersionDate = torrentDate;
			if (version) updates.currentVersion = version;
			if (sourceUrl) updates.sourceUrl = sourceUrl;
		} else if (!game.currentVersion && version) {
			updates.currentVersion = version;
		}
		db.update(games).set(updates).where(eq(games.id, game.id)).run();
		return true;
	}

	async addTorrent(magnetUrl: string): Promise<boolean> {
		if (!(await this.login())) return false;
		try {
			const success = await retryAsync(
				async () => {
					let body: any;
					const headers: any = { Cookie: this.cookies };

					if (magnetUrl.startsWith('http://') || magnetUrl.startsWith('https://')) {
						logger.debug(`[qBit] Downloading .torrent from URL before sending to client...`);
						const response = await fetch(magnetUrl);
						if (!response.ok) {
							logger.error(`[qBit] Failed to download .torrent file: ${response.status} ${response.statusText}`);
							return false;
						}
						const buffer = await response.arrayBuffer();
						const formData = new FormData();
						formData.append('torrents', new Blob([buffer]), 'download.torrent');
						formData.append('category', settings.QBIT_CATEGORY);
						body = formData;
					} else {
						headers['Content-Type'] = 'application/x-www-form-urlencoded';
						body = new URLSearchParams({ urls: magnetUrl, category: settings.QBIT_CATEGORY });
					}

					const resp = await fetch(`${this.baseUrl}/api/v2/torrents/add`, {
						method: 'POST',
						headers,
						body
					});
					return resp.ok;
				},
				{ maxAttempts: 2, delayMs: 1000 }
			);
			return success;
		} catch (error) {
			logger.error(`[qBit] Error adding torrent: ${error}`);
			return false;
		}
	}

	async removeTorrent(hash: string, deleteFiles = false, retried = false): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/torrents/delete`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this.cookies },
				body: new URLSearchParams({ hashes: hash, deleteFiles: deleteFiles ? 'true' : 'false' })
			});
			if (resp.status === 403 && !retried) { this.cookies = ''; return this.removeTorrent(hash, deleteFiles, true); }
			return resp.ok;
		} catch { return false; }
	}

	async pauseTorrent(hash: string, retried = false): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/torrents/stop`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this.cookies },
				body: new URLSearchParams({ hashes: hash })
			});
			if (resp.status === 403 && !retried) { this.cookies = ''; return this.pauseTorrent(hash, true); }
			return resp.ok;
		} catch { return false; }
	}

	async resumeTorrent(hash: string, retried = false): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/torrents/start`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this.cookies },
				body: new URLSearchParams({ hashes: hash })
			});
			if (resp.status === 403 && !retried) { this.cookies = ''; return this.resumeTorrent(hash, true); }
			return resp.ok;
		} catch { return false; }
	}

	async reannounceTorrent(hash: string, retried = false): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/torrents/reannounce`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this.cookies },
				body: new URLSearchParams({ hashes: hash })
			});
			if (resp.status === 403 && !retried) { this.cookies = ''; return this.reannounceTorrent(hash, true); }
			return resp.ok;
		} catch { return false; }
	}

	async recheckTorrent(hash: string, retried = false): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/torrents/recheck`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this.cookies },
				body: new URLSearchParams({ hashes: hash })
			});
			if (resp.status === 403 && !retried) { this.cookies = ''; return this.recheckTorrent(hash, true); }
			return resp.ok;
		} catch { return false; }
	}

	async getSpeedMode(): Promise<0 | 1 | null> {
		if (!(await this.login())) return null;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/transfer/speedLimitsMode`, {
				headers: { Cookie: this.cookies }
			});
			if (!resp.ok) return null;
			const text = await resp.text();
			return parseInt(text.trim()) === 1 ? 1 : 0;
		} catch { return null; }
	}

	async toggleSpeedMode(retried = false): Promise<boolean> {
		if (!(await this.login())) return false;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/transfer/toggleSpeedLimitsMode`, {
				method: 'POST',
				headers: { Cookie: this.cookies }
			});
			if (resp.status === 403 && !retried) { this.cookies = ''; return this.toggleSpeedMode(true); }
			return resp.ok;
		} catch { return false; }
	}

	async setTorrentDownloadLimit(hash: string, limitBytesPerSec: number, retried = false): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/torrents/setDownloadLimit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this.cookies },
				body: new URLSearchParams({ hashes: hash, limit: limitBytesPerSec.toString() })
			});
			if (resp.status === 403 && !retried) { this.cookies = ''; return this.setTorrentDownloadLimit(hash, limitBytesPerSec, true); }
			return resp.ok;
		} catch { return false; }
	}

	async setTorrentUploadLimit(hash: string, limitBytesPerSec: number, retried = false): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/torrents/setUploadLimit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this.cookies },
				body: new URLSearchParams({ hashes: hash, limit: limitBytesPerSec.toString() })
			});
			if (resp.status === 403 && !retried) { this.cookies = ''; return this.setTorrentUploadLimit(hash, limitBytesPerSec, true); }
			return resp.ok;
		} catch { return false; }
	}
}

export const qbitService = new QBitService();
