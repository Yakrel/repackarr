import { json } from '@sveltejs/kit';
import { qbitService } from '$lib/server/qbit.js';
import { db } from '$lib/server/database.js';
import { games } from '$lib/server/schema.js';
import { logError, logger } from '$lib/server/logger.js';
import { fuzzyMatchTitles, parseTorrentTitle, formatSize } from '$lib/server/utils.js';
import type { RequestHandler } from './$types.js';

type QbitStatus = {
	name: string;
	hash: string;
	progress: number;
	state: string;
	dlspeed: string;
	upspeed: string;
	dlLimit: number;
	ulLimit: number;
	eta: string;
	rawEta: number;
	numSeeds: number;
	numLeechs: number;
};

const STATUS_CACHE_TTL_MS = 2000;

let cachedStatus: Record<number, QbitStatus> | null = null;
let cacheExpiresAt = 0;
let pendingRequest: Promise<Record<number, QbitStatus>> | null = null;

async function buildStatusMap(): Promise<Record<number, QbitStatus>> {
	const startedAt = Date.now();
	const torrents = await qbitService.getActiveDownloads();
	const allGames = db.select().from(games).all();
	const statusMap: Record<number, QbitStatus> = {};

	for (const torrent of torrents) {
		const torrentTitle = parseTorrentTitle(torrent.name);
		if (!torrentTitle) continue;

		const matchedGame = allGames.find((g) => fuzzyMatchTitles(g.title, torrentTitle));
		if (!matchedGame) continue;

		if (!statusMap[matchedGame.id] || statusMap[matchedGame.id].progress < torrent.progress) {
			statusMap[matchedGame.id] = {
				name: torrent.name,
				hash: torrent.hash,
				progress: Math.round(torrent.progress * 1000) / 10,
				state: torrent.state,
				dlspeed: `${formatSize(torrent.dlspeed)}/s`,
				upspeed: `${formatSize(torrent.upspeed)}/s`,
				dlLimit: torrent.dl_limit > 0 ? Math.round(torrent.dl_limit / 1024) : 0,
				ulLimit: torrent.up_limit > 0 ? Math.round(torrent.up_limit / 1024) : 0,
				eta: formatSeconds(torrent.eta),
				rawEta: torrent.eta,
				numSeeds: torrent.num_seeds ?? 0,
				numLeechs: torrent.num_leechs ?? 0
			};
		}
	}

	return statusMap;
}

export const GET: RequestHandler = async () => {
	const now = Date.now();
	if (cachedStatus && now < cacheExpiresAt) {
		return json(cachedStatus);
	}

	if (!pendingRequest) {
		pendingRequest = buildStatusMap()
			.then((statusMap) => {
				cachedStatus = statusMap;
				cacheExpiresAt = Date.now() + STATUS_CACHE_TTL_MS;
				return statusMap;
			})
			.finally(() => {
				pendingRequest = null;
			});
	}

	try {
		const statusMap = await pendingRequest;
		return json(statusMap ?? {});
	} catch (error) {
		logError('Failed to fetch qbit status', error);
		return json({}, { status: 500 });
	}
};

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		cachedStatus = null;
		cacheExpiresAt = 0;
		pendingRequest = null;
	});
}

function formatSeconds(seconds: number): string {
	if (seconds <= 0 || seconds >= 8640000) return '∞';
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	const hours = Math.floor(seconds / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	return `${hours}h ${mins}m`;
}
