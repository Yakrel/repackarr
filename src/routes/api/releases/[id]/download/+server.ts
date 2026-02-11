import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db, transaction } from '$lib/server/database.js';
import { releases, games } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';
import { QBitService } from '$lib/server/qbit.js';
import { validateId, validateDownloadUrl, successResponse, errorResponse } from '$lib/server/validators.js';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async ({ params }) => {
	// Validate ID parameter
	const id = validateId(params.id);
	if (id === null) {
		return json(errorResponse('Invalid release ID'), { status: 400 });
	}

	const release = db.select().from(releases).where(eq(releases.id, id)).get();
	if (!release) {
		return json(errorResponse('Release not found'), { status: 404 });
	}

	// Validate download URL
	const magnet = release.magnetUrl || release.infoUrl;
	if (!validateDownloadUrl(magnet)) {
		return json(errorResponse('No valid download link available'));
	}

	// First, send to qBittorrent
	const qbit = new QBitService();
	const qbitSuccess = await qbit.addTorrent(magnet!);

	if (!qbitSuccess) {
		return json(errorResponse('Failed to send to qBittorrent'));
	}

	// Only after successful qBit addition, update database in a transaction
	// This ensures atomicity: either all DB updates succeed or none do
	try {
		transaction(() => {
			const game = db.select().from(games).where(eq(games.id, release.gameId)).get();
			if (!game) {
				throw new Error('Associated game not found');
			}

			// Update game version
			db.update(games)
				.set({
					currentVersionDate: release.uploadDate,
					...(release.parsedVersion ? { currentVersion: release.parsedVersion } : {})
				})
				.where(eq(games.id, game.id))
				.run();

			// Delete all releases for this game
			db.delete(releases).where(eq(releases.gameId, game.id)).run();
		});
		
		return json(successResponse('Sent to qBittorrent'));
	} catch (error) {
		logger.error('Failed to update database after successful qBit addition:', error);
		// Release was added to qBittorrent but DB update failed
		// Return error since the database state is now inconsistent
		return json(errorResponse('Torrent added to qBittorrent but failed to update database. Please refresh.'), { status: 500 });
	}
};
