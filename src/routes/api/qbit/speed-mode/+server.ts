import { json } from '@sveltejs/kit';
import { torrentClient } from '$lib/server/torrentClient.js';
import { logError } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async () => {
	try {
		const mode = await torrentClient.getSpeedMode();
		if (mode === null) return json({ error: 'Torrent client unavailable' }, { status: 502 });
		return json({ mode }); // 0 = normal, 1 = alt (throttled)
	} catch (error) {
		logError('Failed to get speed mode', error);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

export const POST: RequestHandler = async () => {
	try {
		const ok = await torrentClient.toggleSpeedMode();
		if (!ok) return json({ error: 'Torrent client unavailable' }, { status: 502 });
		const mode = await torrentClient.getSpeedMode();
		return json({ mode });
	} catch (error) {
		logError('Failed to toggle speed mode', error);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
