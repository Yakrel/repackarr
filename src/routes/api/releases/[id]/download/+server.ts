import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db, transaction } from '$lib/server/database.js';
import { releases, games } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';
import { torrentClient } from '$lib/server/torrentClient.js';
import {
	validateId,
	validateDownloadUrl,
	successResponse,
	errorResponse,
	extractMagnetHash
} from '$lib/server/validators.js';
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
                return json(errorResponse('No valid download link available'), { status: 400 });
        }

	const game = db.select().from(games).where(eq(games.id, release.gameId)).get();
	if (!game) {
		return json(errorResponse('Associated game not found'), { status: 404 });
	}

	// 1. Get existing torrents to compare later
	let existingHashes = new Set<string>();
	try {
		const existingTorrents = await torrentClient.getActiveDownloads();
		existingHashes = new Set(existingTorrents.map((t) => t.hash));
	} catch (err) {
		logger.warn(`Could not check existing torrents for '${game.title}': ${err}`);
	}

	// 2. Send new torrent to client
	const clientSuccess = await torrentClient.addTorrent(magnet!);
	if (!clientSuccess) {
		return json(errorResponse('Failed to send to client'), { status: 502 });
	}

	// 3. Wait for the new torrent to appear in client
	let newHash = extractMagnetHash(magnet!);
	let newTorrentFound = false;

	if (!newHash) {
		logger.info(`Adding HTTP/Prowlarr link; waiting for torrent to appear in client...`);
		let attempts = 0;
		const maxAttempts = 30; // 30 saniye boyunca dene (1sn aralıklarla)

		while (attempts < maxAttempts) {
			const currentTorrents = await torrentClient.getActiveDownloads();
			const match = currentTorrents.find((t) => !existingHashes.has(t.hash));
			if (match) {
				newHash = match.hash;
				newTorrentFound = true;
				break;
			}
			attempts++;
			await new Promise((r) => setTimeout(r, 1000));
		}
	} else {
		newTorrentFound = true;
	}

	if (!newTorrentFound || !newHash) {
		logger.error(`Torrent added but did not appear in client within 30s. It may have failed to download/add.`);
		return json(errorResponse('Torrent failed to download/add in client. Please check client logs.'), { status: 504 });
	}

	logger.info(`Detected new torrent for '${game.title}' in client (hash: ${newHash})`);

	// 4. Wait for metadata if size is 0 (for magnet links)
	const torrentInfo = await torrentClient.getTorrent(newHash);
	if (torrentInfo && torrentInfo.total_size === 0) {
		logger.info(`Waiting for metadata for '${game.title}' (hash: ${newHash})...`);
		let metadataReceived = false;
		let attempts = 0;
		const maxAttempts = 30;

		while (attempts < maxAttempts) {
			const torrent = await torrentClient.getTorrent(newHash);
			if (torrent && torrent.total_size > 0) {
				metadataReceived = true;
				break;
			}
			attempts++;
			await new Promise((r) => setTimeout(r, 1000));
		}

		if (metadataReceived) {
			logger.info(`Metadata received for '${game.title}', starting force recheck.`);
			await torrentClient.recheckTorrent(newHash);
		} else {
			logger.warn(`Metadata not received for '${game.title}' within 30s. Recheck might not work correctly.`);
			await torrentClient.recheckTorrent(newHash);
		}
	} else {
		logger.info(`Metadata/files already resolved for '${game.title}', starting force recheck.`);
		await torrentClient.recheckTorrent(newHash);
	}

	// 5. Remove old torrent from client only AFTER successful addition (keep files on disk)
	if (game.infoHash && game.infoHash !== newHash) {
		const removed = await torrentClient.removeTorrent(game.infoHash);
		if (removed) {
			logger.info(`Removed old torrent from client for '${game.title}' (hash: ${game.infoHash})`);
		} else {
			logger.warn(`Could not remove old torrent from client for '${game.title}' — may already be gone`);
		}
	}

	// Only after successful client addition, update database in a transaction
	// This ensures atomicity: either all DB updates succeed or none do
	try {
		const nextRawName = release.rawTitle;
		const nextInfoHash = newHash ?? null;
		const nextSourceUrl = release.infoUrl ?? null;
		transaction(() => {
			// Update game version
			db.update(games)
				.set({
					currentVersionDate: release.uploadDate,
					rawName: nextRawName,
					infoHash: nextInfoHash,
					sourceUrl: nextSourceUrl,
					...(release.parsedVersion ? { currentVersion: release.parsedVersion } : {})
				})
				.where(eq(games.id, game.id))
				.run();

			// Delete all releases for this game
			db.delete(releases).where(eq(releases.gameId, game.id)).run();
		});
		
		return json(successResponse('Sent to client'));
	} catch (error) {
		logger.error('Failed to update database after successful client addition:', error);
		return json(errorResponse('Torrent added to client but failed to update database. Please refresh.'), { status: 500 });
	}
};
