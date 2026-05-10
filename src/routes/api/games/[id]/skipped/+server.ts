import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { appSettings } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';
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

	const snapshotSetting = db
		.select()
		.from(appSettings)
		.where(eq(appSettings.key, `skipped_releases:${gameId}`))
		.get();

	if (!snapshotSetting?.value) {
		return json({ skipped: [], hasMore: false });
	}

	try {
		const snapshot = JSON.parse(snapshotSetting.value) as { items?: Array<Record<string, unknown>> };
		const parsedItems = snapshot.items ?? [];
		const sortedItems = [...parsedItems].sort(
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
