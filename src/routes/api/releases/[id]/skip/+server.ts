import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { releases } from '$lib/server/schema.js';
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
		// Skip just marks the release as ignored (seen but not wanted this time)
		db.update(releases)
			.set({ isIgnored: true })
			.where(eq(releases.id, id))
			.run();

		return json(successResponse('Release skipped'));
	} catch (error) {
		logger.error('Failed to skip release:', error);
		return json(errorResponse('Database operation failed'), { status: 500 });
	}
};
