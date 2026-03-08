import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { notifications } from '$lib/server/schema.js';
import { desc, eq, sql } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	const all = db
		.select()
		.from(notifications)
		.orderBy(desc(notifications.createdAt))
		.limit(50)
		.all();

	const unreadCount = db
		.select({ count: sql<number>`count(*)` })
		.from(notifications)
		.where(eq(notifications.isRead, false))
		.get()?.count ?? 0;

	return json({ notifications: all, unreadCount });
};
