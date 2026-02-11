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

	// Get the last scan log with skip details
	const lastScan = db
		.select()
		.from(scanLogs)
		.where(sql`skip_details IS NOT NULL`)
		.orderBy(sql`started_at DESC`)
		.limit(1)
		.get();

	if (!lastScan?.skipDetails) {
		return json({ skipped: [] });
	}

	try {
		const allSkipped = JSON.parse(lastScan.skipDetails) as Array<{
			game: string;
			game_id: number;
			items: Array<Record<string, unknown>>;
		}>;

		const gameData = allSkipped.find((g) => g.game_id === gameId);
		if (!gameData?.items) {
			return json({ skipped: [], hasMore: false });
		}

		const sortedItems = [...gameData.items].sort(
			(a, b) => getDateTimestamp(b['date']) - getDateTimestamp(a['date'])
		);
		const limit = 50;
		const items = sortedItems.slice(0, limit);
		const hasMore = sortedItems.length > limit;

		// Return with pagination info
		return json({ skipped: items, hasMore, total: sortedItems.length });
	} catch (error) {
		logger.error('Failed to parse skip data:', error);
		return json({ skipped: [], hasMore: false, error: 'Failed to parse skip data' }, { status: 500 });
	}
};
