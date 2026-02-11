import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { ignoredReleases } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';
import { validateId, successResponse, errorResponse } from '$lib/server/validators.js';
import { logger } from '$lib/server/logger.js';

export const POST: RequestHandler = async ({ params }) => {
	const id = validateId(params.id);
	if (id === null) {
		return json(errorResponse('Invalid ignored release ID'), { status: 400 });
	}

	try {
		// Check if ignored release exists
		const ignored = db.select().from(ignoredReleases).where(eq(ignoredReleases.id, id)).get();
		if (!ignored) {
			return json(errorResponse('Ignored release not found'), { status: 404 });
		}

		// Delete the ignored release entry
		db.delete(ignoredReleases).where(eq(ignoredReleases.id, id)).run();

		return json(successResponse('Ignored release restored'));
	} catch (error) {
		logger.error('Error restoring ignored release:', error);
		return json(errorResponse('Internal server error'), { status: 500 });
	}
};
