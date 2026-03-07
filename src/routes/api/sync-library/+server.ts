import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runSyncLibrary } from '$lib/server/manager.js';
import { logger } from '$lib/server/logger.js';
import { progressManager } from '$lib/server/progress.js';

export const POST: RequestHandler = async () => {
	try {
		const synced = await runSyncLibrary(undefined, { throwOnError: true });
		return json({ success: true, added: synced });
	} catch (error) {
		logger.error('Sync error:', error);
		return json({ success: false, message: 'Internal server error' }, { status: 500 });
	} finally {
		progressManager.complete();
	}
};
