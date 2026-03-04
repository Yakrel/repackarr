import { json } from '@sveltejs/kit';
import { qbitService } from '$lib/server/qbit.js';
import { logError } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async () => {
	try {
		const mode = await qbitService.getSpeedMode();
		if (mode === null) return json({ error: 'qBittorrent unavailable' }, { status: 502 });
		return json({ mode }); // 0 = normal, 1 = alt (throttled)
	} catch (error) {
		logError('Failed to get speed mode', error);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

export const POST: RequestHandler = async () => {
	try {
		const ok = await qbitService.toggleSpeedMode();
		if (!ok) return json({ error: 'qBittorrent unavailable' }, { status: 502 });
		const mode = await qbitService.getSpeedMode();
		return json({ mode });
	} catch (error) {
		logError('Failed to toggle speed mode', error);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
