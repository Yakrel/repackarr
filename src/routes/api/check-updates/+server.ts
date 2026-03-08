import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runSearchUpdates } from '$lib/server/manager.js';
import { progressManager } from '$lib/server/progress.js';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async () => {
	try {
		const scanned = await runSearchUpdates(undefined, { throwOnError: true });

		return json({
			success: true,
			message: 'Update check complete',
			scanned
		});
	} catch (error) {
		logger.error('Error checking updates:', error);
		return json(
			{
				success: false,
				error: 'Internal server error'
			},
			{ status: 500 }
		);
	} finally {
		progressManager.complete();
	}
};
