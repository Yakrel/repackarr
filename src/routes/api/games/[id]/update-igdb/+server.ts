import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { games } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';
import { validateId, successResponse, errorResponse } from '$lib/server/validators.js';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = validateId(params.id);
	if (id === null) {
		return json(errorResponse('Invalid game ID'), { status: 400 });
	}

	try {
		const body = await request.json();
		const igdbId = parseInt(body.igdbId);

		if (isNaN(igdbId)) {
			return json(errorResponse('Invalid IGDB ID'), { status: 400 });
		}

		// Update game with manual IGDB ID
		// In a real implementation, we would also fetch the new metadata immediately
		// For now, we update the ID so the next scan picks it up, or the user can manually refresh
		db.update(games)
			.set({ igdbId })
			.where(eq(games.id, id))
			.run();

		logger.info(`Updated IGDB ID for game ${id} to ${igdbId}`);
		return json(successResponse('IGDB ID updated'));
	} catch (error) {
		logger.error('Failed to update IGDB ID', error);
		return json(errorResponse('Failed to update IGDB ID'), { status: 500 });
	}
};
