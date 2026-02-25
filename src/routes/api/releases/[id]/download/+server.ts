import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db, transaction } from '$lib/server/database.js';
import { releases, games } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';
import { qbitService } from '$lib/server/qbit.js';
import { validateId, validateDownloadUrl, successResponse, errorResponse } from '$lib/server/validators.js';
import { logger } from '$lib/server/logger.js';

function extractMagnetHash(url: string): string | null {
	const match = url.match(/btih:([a-fA-F0-9]{40})/i);
	return match ? match[1].toLowerCase() : null;
}

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
                return json(errorResponse('No valid download link available'), { status: 400 });
        }

	const game = db.select().from(games).where(eq(games.id, release.gameId)).get();
	if (!game) {
		return json(errorResponse('Associated game not found'), { status: 404 });
	}

	// Remove old torrent from qBit before adding new one (keep files on disk)
	if (game.infoHash) {
		const removed = await qbitService.removeTorrent(game.infoHash);
		if (removed) {
			logger.info(`Removed old torrent from qBit for '${game.title}' (hash: ${game.infoHash})`);
		} else {
			logger.warn(`Could not remove old torrent from qBit for '${game.title}' — may already be gone`);
		}
	}

        // Send new torrent to qBittorrent
        const qbitSuccess = await qbitService.addTorrent(magnet!);
	if (!qbitSuccess) {
		return json(errorResponse('Failed to send to qBittorrent'), { status: 502 });
	}

	// Wait for metadata and trigger recheck
	const newHash = extractMagnetHash(magnet!);
	if (newHash) {
		logger.info(`Waiting for metadata for '${game.title}' (hash: ${newHash})...`);
		
		let metadataReceived = false;
		let attempts = 0;
		const maxAttempts = 30; // 30 saniye boyunca dene (1sn aralıklarla)

		while (attempts < maxAttempts) {
			const torrent = await qbitService.getTorrent(newHash);
			
			// qBittorrent'te torrentin boyutu 0'dan büyükse metadata gelmiş demektir
			if (torrent && torrent.total_size > 0) {
				metadataReceived = true;
				break;
			}
			
			attempts++;
			await new Promise(r => setTimeout(r, 1000));
		}

		if (metadataReceived) {
			logger.info(`Metadata received for '${game.title}', starting force recheck.`);
			const rechecked = await qbitService.recheckTorrent(newHash);
			if (rechecked) logger.info(`Force recheck triggered successfully.`);
		} else {
			logger.warn(`Metadata not received for '${game.title}' within 30s. Recheck might not work correctly.`);
			// Yine de son bir kez deniyoruz
			await qbitService.recheckTorrent(newHash);
		}
	}

	// Only after successful qBit addition, update database in a transaction
	// This ensures atomicity: either all DB updates succeed or none do
	try {
		transaction(() => {
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
		return json(errorResponse('Torrent added to qBittorrent but failed to update database. Please refresh.'), { status: 500 });
	}
};
