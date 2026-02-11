import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { games, releases } from '$lib/server/schema.js';
import { eq, and } from 'drizzle-orm';
import { extractVersion } from '$lib/server/utils.js';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const data = await request.json();
		const { gameId, title, indexer, magnetUrl, infoUrl, size, date } = data;

		if (!gameId || !title) {
			return json({ success: false, error: 'Missing required fields' }, { status: 400 });
		}

		// Check if game exists
		const game = db.select().from(games).where(eq(games.id, gameId)).get();
		if (!game) {
			return json({ success: false, error: 'Game not found' }, { status: 404 });
		}

		// Check if release already exists
		const existing = db
			.select()
			.from(releases)
			.where(and(eq(releases.gameId, gameId), eq(releases.rawTitle, title)))
			.get();

		if (existing) {
			return json({ success: false, error: 'Release already exists' }, { status: 400 });
		}

		// Parse date
		let uploadDate = new Date();
		if (date && date !== 'N/A') {
			try {
				uploadDate = new Date(date);
			} catch {
				// Use current date if parsing fails
			}
		}

		// Extract version
		const parsedVersion = extractVersion(title);

		// Insert release
		db.insert(releases)
			.values({
				gameId,
				rawTitle: title,
				parsedVersion,
				uploadDate: uploadDate.toISOString(),
				indexer: indexer || 'Unknown',
				magnetUrl: magnetUrl || null,
				infoUrl: infoUrl || null,
				size: size || null,
				isIgnored: false
			})
			.run();

		return json({ success: true, message: 'Release added successfully' });
	} catch (error) {
		logger.error('Error force-adding release:', error);
		return json(
			{ success: false, error: 'Internal server error' },
			{ status: 500 }
		);
	}
};
