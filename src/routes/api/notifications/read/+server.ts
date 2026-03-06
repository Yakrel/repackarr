import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { notifications } from '$lib/server/schema.js';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async () => {
	db.update(notifications).set({ isRead: true }).where(eq(notifications.isRead, false)).run();
	return json({ success: true });
};
