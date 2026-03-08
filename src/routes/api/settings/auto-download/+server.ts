import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { appSettings } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';

const KEY = 'autoDownload';

export const GET: RequestHandler = async () => {
	const setting = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
	const enabled = setting?.value === 'true';
	return json({ enabled });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	let enabled: boolean;

	if (body && typeof body.enabled === 'boolean') {
		enabled = body.enabled;
	} else {
		// Toggle if no value provided
		const current = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
		enabled = current?.value !== 'true';
	}

	const value = enabled ? 'true' : 'false';
	db.insert(appSettings)
		.values({ key: KEY, value })
		.onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date().toISOString() } })
		.run();

	return json({ enabled });
};
