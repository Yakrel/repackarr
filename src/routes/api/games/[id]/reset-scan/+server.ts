import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { games, releases } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';
import { searchForGame } from '$lib/server/prowlarr.js';
import { validateId, successResponse, errorResponse } from '$lib/server/validators.js';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async ({ params }) => {
	const id = validateId(params.id);
	if (id === null) {
		return json(errorResponse('Invalid game ID'), { status: 400 });
	}

	const game = db.select().from(games).where(eq(games.id, id)).get();
	if (!game) {
		return json(errorResponse('Game not found'), { status: 404 });
	}

	// Delete existing releases first
	try {
		db.delete(releases).where(eq(releases.gameId, id)).run();
	} catch (error) {
		logger.error('Failed to delete existing releases:', error);
		return json(errorResponse('Failed to reset releases'), { status: 500 });
	}

	// Trigger immediate search
	try {
		const result = await searchForGame(id);
		return json(successResponse('Scan completed', {
			added: result.added,
			totalFound: result.totalFound
		}));
	} catch (error) {
		logger.error(`Reset scan failed for game ${id}:`, error);
		return json(errorResponse('Search failed: ' + String(error).slice(0, 80)), { status: 500 });
	}
};
