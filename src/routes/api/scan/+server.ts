import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runScanCycle, runSyncLibrary, runSearchUpdates } from '$lib/server/manager.js';
import { progressManager } from '$lib/server/progress.js';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async ({ url }) => {
	const type = url.searchParams.get('type') || 'full';

	try {
		if (type === 'sync') {
			await runSyncLibrary();
			await progressManager.complete();
		} else if (type === 'updates') {
			await runSearchUpdates();
			await progressManager.complete();
		} else {
			await runScanCycle();
		}
		return json({ success: true });
	} catch (error) {
		logger.error(`Scan failed: ${error}`);
		return json({ success: false, error: String(error) }, { status: 500 });
	}
};
