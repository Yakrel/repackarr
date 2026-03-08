import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/database.js';
import { notifications } from '$lib/server/schema.js';
import { desc } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	const all = db
		.select()
		.from(notifications)
		.orderBy(desc(notifications.createdAt))
		.limit(50)
		.all();

	const unreadCount = all.filter((n) => !n.isRead).length;

	return json({ notifications: all, unreadCount });
};
