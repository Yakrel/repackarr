import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { games } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';
import { validateId, errorResponse } from '$lib/server/validators.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = validateId(params.id);
	if (id === null) return json(errorResponse('Invalid game ID'), { status: 400 });

	const game = db.select().from(games).where(eq(games.id, id)).get();
	if (!game) return json(errorResponse('Game not found'), { status: 404 });

	const body = await request.json().catch(() => null);

	// enabled: true = always, false = never, null = use global
	let autoDownloadEnabled: boolean | null = null;
	if (body && body.enabled === true) autoDownloadEnabled = true;
	else if (body && body.enabled === false) autoDownloadEnabled = false;
	// else null = global

	db.update(games)
		.set({ autoDownloadEnabled })
		.where(eq(games.id, id))
		.run();

	return json({ success: true, autoDownloadEnabled });
};
