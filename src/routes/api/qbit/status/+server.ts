import { json } from '@sveltejs/kit';
import { QBitService } from '$lib/server/qbit.js';
import { db } from '$lib/server/database.js';
import { games } from '$lib/server/schema.js';
import { fuzzyMatchTitles, parseTorrentTitle, formatSize } from '$lib/server/utils.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async () => {
	try {
		const qbit = new QBitService();
		const torrents = await qbit.getActiveDownloads();
		const allGames = db.select().from(games).all();

		const statusMap: Record<number, any> = {};

		for (const torrent of torrents) {
			const torrentTitle = parseTorrentTitle(torrent.name);
			if (!torrentTitle) continue;

			const matchedGame = allGames.find((g) => fuzzyMatchTitles(g.title, torrentTitle));
			if (matchedGame) {
				// If multiple torrents match the same game, we might want the one with most progress or just the first one
				// For now, let's just take the first one or update if progress is higher
				if (!statusMap[matchedGame.id] || statusMap[matchedGame.id].progress < torrent.progress) {
					statusMap[matchedGame.id] = {
						name: torrent.name,
						progress: Math.round(torrent.progress * 1000) / 10, // 0.1234 -> 12.3
						state: torrent.state,
						dlspeed: formatSize(torrent.dlspeed) + '/s',
						eta: formatSeconds(torrent.eta),
						rawEta: torrent.eta
					};
				}
			}
		}

		return json(statusMap);
	} catch (error) {
		console.error('Failed to fetch qbit status:', error);
		return json({}, { status: 500 });
	}
};

function formatSeconds(seconds: number): string {
	if (seconds <= 0 || seconds >= 8640000) return '∞';
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	const hours = Math.floor(seconds / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	return `${hours}h ${mins}m`;
}
