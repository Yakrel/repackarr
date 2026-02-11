import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db, transaction } from '$lib/server/database.js';
import { releases, games } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';
import { validateId, successResponse, errorResponse } from '$lib/server/validators.js';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async ({ params }) => {
	const id = validateId(params.id);
	if (id === null) {
		return json(errorResponse('Invalid release ID'), { status: 400 });
	}

	const release = db.select().from(releases).where(eq(releases.id, id)).get();
	if (!release) {
		return json(errorResponse('Release not found'), { status: 404 });
	}

	const game = db.select().from(games).where(eq(games.id, release.gameId)).get();
	if (!game) {
		return json(errorResponse('Associated game not found'), { status: 404 });
	}

	try {
		// Use transaction to ensure atomicity
		transaction(() => {
			// Update game version
			db.update(games)
				.set({
					currentVersionDate: release.uploadDate,
					...(release.parsedVersion ? { currentVersion: release.parsedVersion } : {})
				})
				.where(eq(games.id, game.id))
				.run();

			// Delete ALL releases for this game (clean slate)
			db.delete(releases).where(eq(releases.gameId, game.id)).run();
		});

		return json(successResponse('Game marked as updated'));
	} catch (error) {
		logger.error('Failed to confirm release:', error);
		return json(errorResponse('Database operation failed'), { status: 500 });
	}
};
