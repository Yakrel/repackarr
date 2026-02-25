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
					const setCookie = resp.headers.get('set-cookie');
					if (setCookie) this.cookies = setCookie.split(';')[0];
					return true;
				},
				{ maxAttempts: 2, delayMs: 1000 }
			);
			return success;
		} catch { return false; }
	}

	private async fetchTorrents(retried = false): Promise<QBitTorrentInfo[]> {
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

	async getActiveDownloads(): Promise<QBitTorrentInfo[]> {
		return this.fetchTorrents();
	}

	async getTorrent(hash: string, retried = false): Promise<QBitTorrentInfo | null> {
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
		const allGames = db.select().from(games).all();
		const results = await Promise.allSettled(torrents.map((torrent) => this.processTorrent(torrent, allGames)));
		
		const currentGames = db.select().from(games).all();
		const gamesToUnlink = currentGames.filter(g => g.qbitSyncedAt && g.qbitSyncedAt < syncStartTime);
		for (const g of gamesToUnlink) {
			db.update(games).set({ qbitSyncedAt: null }).where(eq(games.id, g.id)).run();
			logger.info(`Unlinked '${g.title}'`);
		}
		return results.filter(r => r.status === 'fulfilled' && r.value).length;
	}

	private async processTorrent(torrent: QBitTorrentInfo, allGames: Array<typeof games.$inferSelect>): Promise<boolean> {
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

		const matchedGame = allGames.find((g) => fuzzyMatchTitles(g.title, title));
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
					const resp = await fetch(`${this.baseUrl}/api/v2/torrents/add`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this.cookies },
						body: new URLSearchParams({ urls: magnetUrl, category: settings.QBIT_CATEGORY })
					});
					return resp.ok;
				},
				{ maxAttempts: 2, delayMs: 1000 }
			);
			return success;
		} catch { return false; }
	}

	async removeTorrent(hash: string): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/torrents/delete`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this.cookies },
				body: new URLSearchParams({ hashes: hash, deleteFiles: 'false' })
			});
			return resp.ok;
		} catch { return false; }
	}

	async recheckTorrent(hash: string): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		try {
			const resp = await fetch(`${this.baseUrl}/api/v2/torrents/recheck`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this.cookies },
				body: new URLSearchParams({ hashes: hash })
			});
			return resp.ok;
		} catch { return false; }
	}
}

export const qbitService = new QBitService();
