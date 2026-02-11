import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { releases, ignoredReleases } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';
import { validateId, successResponse, errorResponse } from '$lib/server/validators.js';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async ({ params }) => {
	const id = validateId(params.id);
	if (id === null) {
		return json(errorResponse('Invalid release ID'), { status: 400 });
	}

	const release = db.select().from(releases).where(eq(releases.id, id)).get();
	if (!release) {
		return json(errorResponse('Release not found'), { status: 404 });
	}

	try {
		// Add to ignored releases list
		db.insert(ignoredReleases)
			.values({
				gameId: release.gameId,
				releaseTitle: release.rawTitle,
				rawTitle: release.rawTitle
			})
			.run();
	} catch (error) {
		// Duplicate ignore entry is acceptable, but log other errors
		if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint')) {
			logger.warn('Failed to add ignored release:', error);
		}
	}

	// Delete the release from active releases
	db.delete(releases).where(eq(releases.id, id)).run();

	return json(successResponse('Release permanently ignored'));
};
