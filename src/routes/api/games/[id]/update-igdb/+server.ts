import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { games } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';
import { validateId, successResponse, errorResponse } from '$lib/server/validators.js';
import { logger } from '$lib/server/logger.js';
import { getGameMetadata } from '$lib/server/igdb.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = validateId(params.id);
	if (id === null) {
		return json(errorResponse('Invalid game ID'), { status: 400 });
	}

	try {
		const body = await request.json();
		const igdbId = parseInt(body.igdbId);
		const gameName = body.gameName; // Optional: Use the selected name from autocomplete

		if (isNaN(igdbId)) {
			return json(errorResponse('Invalid IGDB ID'), { status: 400 });
		}

		// Update game with manual IGDB ID and metadata
		// If we have a name, use it for title and search query to fix messy qBit names
		const updates: any = { igdbId };
		
		if (gameName) {
			updates.searchQuery = gameName;
			updates.title = gameName;
		}

		// Fetch latest metadata for this IGDB ID to get cover and steam ID
		try {
			// We search by the name provided or current game title to get metadata
			const metadata = await getGameMetadata(gameName || '');
			if (metadata) {
				if (metadata.coverUrl) updates.coverUrl = metadata.coverUrl;
				if (metadata.steamAppId) updates.steamAppId = metadata.steamAppId;
				if (metadata.name && !gameName) {
					updates.searchQuery = metadata.name;
					updates.title = metadata.name;
				}
			}
		} catch (e) {
			logger.warn(`Failed to fetch extra metadata during ID update: ${e}`);
		}

		db.update(games)
			.set(updates)
			.where(eq(games.id, id))
			.run();

		logger.info(`Updated game ${id} with IGDB ID ${igdbId} and query: ${updates.searchQuery}`);
		return json(successResponse('Game metadata updated successfully'));
	} catch (error) {
		logger.error('Failed to update game metadata', error);
		return json(errorResponse('Failed to update game metadata'), { status: 500 });
	}
};
