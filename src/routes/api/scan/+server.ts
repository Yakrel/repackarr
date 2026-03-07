import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runScanCycle, runSyncLibrary, runSearchUpdates } from '$lib/server/manager.js';
import { progressManager } from '$lib/server/progress.js';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async ({ url }) => {
	const type = url.searchParams.get('type') || 'full';

	try {
		if (type === 'sync') {
			const synced = await runSyncLibrary(undefined, { throwOnError: true });
			return json({ success: true, added: synced });
		} else if (type === 'updates') {
			const scanned = await runSearchUpdates(undefined, { throwOnError: true });
			return json({ success: true, scanned });
		} else {
			await runScanCycle();
			return json({ success: true });
		}
	} catch (error) {
		logger.error(`Scan failed: ${error}`);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	} finally {
		if (type !== 'full') {
			progressManager.complete();
		}
	}
};
