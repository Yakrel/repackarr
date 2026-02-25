import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { scanLogs } from '$lib/server/schema.js';
import { sql } from 'drizzle-orm';
import { validateId } from '$lib/server/validators.js';
import { logger } from '$lib/server/logger.js';

function getDateTimestamp(value: unknown): number {
	if (typeof value !== 'string' || !value.trim()) {
		return 0;
	}
	const parsed = Date.parse(value.replace(' ', 'T'));
	return Number.isNaN(parsed) ? 0 : parsed;
}

export const GET: RequestHandler = async ({ params }) => {
	const gameId = validateId(params.id);
	if (gameId === null) {
		return json({ skipped: [], error: 'Invalid game ID' }, { status: 400 });
	}

	// Find the most recent scan log that actually contains skip data for THIS specific game
	const logs = db
		.select()
		.from(scanLogs)
		.where(sql`skip_details IS NOT NULL`)
		.orderBy(sql`started_at DESC`)
		.limit(10) // Check last 10 logs
		.all();

	let gameData = null;
	for (const log of logs) {
		if (!log.skipDetails) continue;
		try {
			const allSkipped = JSON.parse(log.skipDetails) as Array<{
				game: string;
				game_id: number;
				items: Array<Record<string, unknown>>;
			}>;
			gameData = allSkipped.find((g) => g.game_id === gameId);
			if (gameData?.items?.length) break;
		} catch (e) {
			logger.error(`Failed to parse skip details in log ${log.id}:`, e);
		}
	}

	if (!gameData?.items) {
		return json({ skipped: [], hasMore: false });
	}

	try {
		const sortedItems = [...gameData.items].sort(
			(a, b) => getDateTimestamp(b['date']) - getDateTimestamp(a['date'])
		);
		const limit = 50;
		const items = sortedItems.slice(0, limit);
		const hasMore = sortedItems.length > limit;

		// Return with pagination info
		return json({ skipped: items, hasMore, total: sortedItems.length });
	} catch (error) {
		logger.error('Failed to sort skip data:', error);
		return json({ skipped: [], hasMore: false, error: 'Failed to process skip data' }, { status: 500 });
	}
};
