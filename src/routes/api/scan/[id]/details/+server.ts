import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { scanLogs } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id, 10);
	const log = db.select().from(scanLogs).where(eq(scanLogs.id, id)).get();

	if (!log) {
		return json({ error: 'Log not found' }, { status: 404 });
	}

	let details: Record<string, unknown> = {};
	if (log.details) {
		try {
			details = JSON.parse(log.details);
		} catch {
			details = { error: 'Could not parse details' };
		}
	}

	let skipSummary: Array<Record<string, unknown>> = [];
	if (log.skipDetails) {
		try {
			skipSummary = JSON.parse(log.skipDetails);
		} catch {
			skipSummary = [];
		}
	}

	return json({
		log,
		details,
		skipSummary
	});
};
