import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { QBitService } from '$lib/server/qbit.js';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async () => {
	const qbit = new QBitService();

	try {
		const synced = await qbit.syncGames();
		return json({ success: true, added: synced });
	} catch (error) {
		logger.error('Sync error:', error);
		return json({ success: false, message: String(error).slice(0, 100) }, { status: 500 });
	}
};
