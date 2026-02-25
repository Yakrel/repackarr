import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runSearchUpdates } from '$lib/server/manager.js';
import { progressManager } from '$lib/server/progress.js';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async () => {
	try {
		// Start the search updates in background
		runSearchUpdates().then(() => {
			progressManager.complete();
		});
		
		return json({
			success: true,
			message: 'Update search started'
		});
	} catch (error) {
		logger.error('Error checking updates:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Internal server error'
			},
			{ status: 500 }
		);
	}
};
