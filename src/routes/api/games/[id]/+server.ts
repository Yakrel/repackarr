import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { games } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';
import { qbitService } from '$lib/server/qbit.js';
import { logger } from '$lib/server/logger.js';

export const DELETE: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id, 10);
	if (!id) return json({ error: 'Invalid game ID' }, { status: 400 });

	const { deleteFromQbit = false, deleteFiles = false } = await request.json().catch(() => ({}));

	try {
		if (deleteFromQbit) {
			const game = db.select({ infoHash: games.infoHash, title: games.title }).from(games).where(eq(games.id, id)).get();
			if (game?.infoHash) {
				const ok = await qbitService.removeTorrent(game.infoHash, deleteFiles);
				if (!ok) {
					logger.warn(`Failed to remove torrent from qBittorrent for game "${game.title}" (hash: ${game.infoHash})`);
				} else {
					logger.info(`Removed torrent from qBittorrent for game "${game.title}" (deleteFiles: ${deleteFiles})`);
				}
			}
		}

		db.delete(games).where(eq(games.id, id)).run();
		logger.info(`Deleted game id=${id} from library`);
		return json({ success: true });
	} catch (error) {
		logger.error(`Failed to delete game id=${id}: ${error}`);
		return json({ error: 'Failed to delete game' }, { status: 500 });
	}
};
