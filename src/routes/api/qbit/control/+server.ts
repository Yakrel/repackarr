import { json } from '@sveltejs/kit';
import { torrentClient } from '$lib/server/torrentClient.js';
import { logError } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { action, hash } = body;

		if (!hash || typeof hash !== 'string' || !/^[a-fA-F0-9]{40}$/.test(hash)) {
			return json({ error: 'Invalid hash' }, { status: 400 });
		}

		let ok = false;
		switch (action) {
			case 'pause':
				ok = await torrentClient.pauseTorrent(hash);
				break;
			case 'resume':
				ok = await torrentClient.resumeTorrent(hash);
				break;
			case 'recheck':
				ok = await torrentClient.recheckTorrent(hash);
				break;
			case 'reannounce':
				ok = await torrentClient.reannounceTorrent(hash);
				break;
			case 'setDlLimit': {
				const limitKbps: number = body.limitKbps ?? 0;
				const limitBytes = limitKbps > 0 ? Math.round(limitKbps * 1024) : 0;
				ok = await torrentClient.setTorrentDownloadLimit(hash, limitBytes);
				break;
			}
			case 'setUpLimit': {
				const limitKbps: number = body.limitKbps ?? 0;
				const limitBytes = limitKbps > 0 ? Math.round(limitKbps * 1024) : 0;
				ok = await torrentClient.setTorrentUploadLimit(hash, limitBytes);
				break;
			}
			default:
				return json({ error: 'Unknown action' }, { status: 400 });
		}

		if (!ok) return json({ error: 'Torrent client action failed' }, { status: 502 });
		return json({ success: true });
	} catch (error) {
		logError('torrent client control error', error);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
