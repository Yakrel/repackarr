import { settings, isIgdbEnabled } from './config.js';
import { db } from './database.js';
import { games } from './schema.js';
import { eq } from 'drizzle-orm';
import { logger } from './logger.js';
import {
	extractVersion,
	sanitizeSearchQuery,
	fuzzyMatchTitles,
	parseTorrentTitle
} from './utils.js';
import type { TorrentInfo } from './types.js';

class TransmissionService {
	private baseUrl: string;
	private sessionId: string | null = null;
	private defaultDownloadDir: string | null = null;

	constructor() {
		this.baseUrl = (settings.TRANSMISSION_HOST || '').replace(/\/$/, '') + '/transmission/rpc';
	}

	private get authHeader(): string {
		if (settings.TRANSMISSION_USERNAME && settings.TRANSMISSION_PASSWORD) {
			return 'Basic ' + Buffer.from(`${settings.TRANSMISSION_USERNAME}:${settings.TRANSMISSION_PASSWORD}`).toString('base64');
		}
		return '';
	}

	async rpcCall(method: string, args: any = {}, retried = false): Promise<any> {
		if (!settings.TRANSMISSION_HOST) return null;
		
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};
		if (this.sessionId) headers['X-Transmission-Session-Id'] = this.sessionId;
		const auth = this.authHeader;
		if (auth) headers['Authorization'] = auth;

		try {
			const resp = await fetch(this.baseUrl, {
				method: 'POST',
				headers,
				body: JSON.stringify({ method, arguments: args })
			});

			if (resp.status === 409) {
				const newSessionId = resp.headers.get('X-Transmission-Session-Id');
				if (newSessionId) {
					this.sessionId = newSessionId;
					if (!retried) return this.rpcCall(method, args, true);
				}
				return null;
			}
			
			if (resp.status === 401) {
				logger.error('[Transmission] Authentication failed (401 Unauthorized)');
				return null;
			}

			if (!resp.ok) return null;
			const data = await resp.json();
			if (data.result !== 'success') {
				logger.error(`[Transmission] RPC Error: ${data.result}`);
				return null;
			}
			return data.arguments;
		} catch (e) {
			return null;
		}
	}

	async login(): Promise<boolean> {
		if (!settings.TRANSMISSION_HOST) {
			logger.warn('[Transmission] TRANSMISSION_HOST is not configured.');
			return false;
		}
		if (this.sessionId && this.defaultDownloadDir) return true;
		const args = await this.rpcCall('session-get');
		if (args) {
			this.defaultDownloadDir = args['download-dir'];
			return true;
		}
		return false;
	}

	private mapTorrent(t: any): TorrentInfo {
		let state = 'pausedDL';
		switch (t.status) {
			case 0: state = t.percentDone === 1 ? 'pausedUP' : 'pausedDL'; break; // Stopped
			case 1: 
			case 2: state = 'checkingDL'; break; // Check pending / Checking
			case 3: state = 'queuedDL'; break; // Download pending
			case 4: state = t.rateDownload === 0 ? 'stalledDL' : 'downloading'; break; // Downloading
			case 5: state = 'queuedUP'; break; // Seed pending
			case 6: state = t.rateUpload === 0 ? 'stalledUP' : 'uploading'; break; // Seeding
		}

		return {
			name: t.name,
			hash: t.hashString,
			comment: t.comment,
			state: state,
			progress: t.percentDone,
			dlspeed: t.rateDownload,
			upspeed: t.rateUpload,
			dl_limit: (t.downloadLimit || 0) * 1024,
			up_limit: (t.uploadLimit || 0) * 1024,
			eta: t.eta,
			category: Array.isArray(t.labels) ? t.labels.join(',') : '',
			added_on: t.addedDate,
			completion_on: t.doneDate,
			total_size: t.totalSize,
			num_seeds: t.peersSendingToUs,
			num_leechs: t.peersGettingFromUs
		};
	}

	private async fetchTorrents(): Promise<TorrentInfo[]> {
		if (!(await this.login())) return [];
		const args = await this.rpcCall('torrent-get', {
			fields: [
				"id", "name", "hashString", "status", "percentDone", "rateDownload", "rateUpload",
				"downloadLimit", "uploadLimit", "eta", "labels", "addedDate", "doneDate",
				"totalSize", "peersSendingToUs", "peersGettingFromUs", "comment"
			]
		});
		if (!args || !args.torrents) return [];
		
		const allTorrents = args.torrents;
		// Filter by label
		const targetLabel = settings.TRANSMISSION_LABEL || 'games';
		const filtered = allTorrents.filter((t: any) => t.labels && t.labels.includes(targetLabel));
		
		return filtered.map((t: any) => this.mapTorrent(t));
	}

	async getActiveDownloads(): Promise<TorrentInfo[]> {
		return this.fetchTorrents();
	}

	async getTorrent(hash: string): Promise<TorrentInfo | null> {
		if (!(await this.login())) return null;
		const args = await this.rpcCall('torrent-get', {
			ids: [hash],
			fields: [
				"id", "name", "hashString", "status", "percentDone", "rateDownload", "rateUpload",
				"downloadLimit", "uploadLimit", "eta", "labels", "addedDate", "doneDate",
				"totalSize", "peersSendingToUs", "peersGettingFromUs", "comment"
			]
		});
		if (!args || !args.torrents || args.torrents.length === 0) return null;
		return this.mapTorrent(args.torrents[0]);
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
				logger.error(`[Transmission] Error processing torrent ${torrent.name || ''}: ${error}`);
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
		
		const targetLabel = settings.TRANSMISSION_LABEL || 'games';
		let downloadDir = undefined;
		if (this.defaultDownloadDir) {
			downloadDir = `${this.defaultDownloadDir}/${targetLabel}`;
		}

		const args: any = {
			labels: [targetLabel]
		};

		if (downloadDir) {
			args['download-dir'] = downloadDir;
		}
		
		if (magnetUrl.startsWith('http://') || magnetUrl.startsWith('https://')) {
			try {
				logger.debug(`[Transmission] Downloading .torrent from URL before sending to client...`);
				const response = await fetch(magnetUrl);
				if (!response.ok) {
					logger.error(`[Transmission] Failed to download .torrent file: ${response.status} ${response.statusText}`);
					return false;
				}
				const arrayBuffer = await response.arrayBuffer();
				args['metainfo'] = Buffer.from(arrayBuffer).toString('base64');
			} catch (error) {
				logger.error(`[Transmission] Error downloading .torrent file: ${error}`);
				return false;
			}
		} else {
			args['filename'] = magnetUrl;
		}

		const result = await this.rpcCall('torrent-add', args);
		return result !== null;
	}

	async removeTorrent(hash: string, deleteFiles = false): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		const result = await this.rpcCall('torrent-remove', {
			ids: [hash],
			"delete-local-data": deleteFiles
		});
		return result !== null;
	}

	async pauseTorrent(hash: string): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		const result = await this.rpcCall('torrent-stop', { ids: [hash] });
		return result !== null;
	}

	async resumeTorrent(hash: string): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		const result = await this.rpcCall('torrent-start', { ids: [hash] });
		return result !== null;
	}

	async reannounceTorrent(hash: string): Promise<boolean> {
		// Transmission doesn't expose a "force reannounce" method via RPC.
		// As requested, return true (no-op).
		return true;
	}

	async recheckTorrent(hash: string): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		const result = await this.rpcCall('torrent-verify', { ids: [hash] });
		return result !== null;
	}

	async getSpeedMode(): Promise<0 | 1 | null> {
		if (!(await this.login())) return null;
		const result = await this.rpcCall('session-get', { fields: ["alt-speed-enabled"] });
		if (!result) return null;
		return result["alt-speed-enabled"] ? 1 : 0;
	}

	async toggleSpeedMode(): Promise<boolean> {
		const currentMode = await this.getSpeedMode();
		if (currentMode === null) return false;
		const result = await this.rpcCall('session-set', { "alt-speed-enabled": !currentMode });
		return result !== null;
	}

	async setTorrentDownloadLimit(hash: string, limitBytesPerSec: number): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		const limitKBps = Math.floor(limitBytesPerSec / 1024);
		const result = await this.rpcCall('torrent-set', {
			ids: [hash],
			downloadLimit: limitKBps,
			downloadLimited: limitKBps > 0
		});
		return result !== null;
	}

	async setTorrentUploadLimit(hash: string, limitBytesPerSec: number): Promise<boolean> {
		if (!hash || !(await this.login())) return false;
		const limitKBps = Math.floor(limitBytesPerSec / 1024);
		const result = await this.rpcCall('torrent-set', {
			ids: [hash],
			uploadLimit: limitKBps,
			uploadLimited: limitKBps > 0
		});
		return result !== null;
	}
}

export const transmissionService = new TransmissionService();
