import { db } from '$lib/server/database.js';
import { games, ignoredReleases, appSettings } from '$lib/server/schema.js';
import { eq, sql } from 'drizzle-orm';
import { settings, updateSettings } from '$lib/server/config.js';
import { rescheduleJob } from '$lib/server/scheduler.js';
import { refreshIndexerCache } from '$lib/server/prowlarr.js';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types.js';

export const load: PageServerLoad = async () => {
	const ignored = db
		.select({
			ignored: ignoredReleases,
			gameTitle: games.title
		})
		.from(ignoredReleases)
		.innerJoin(games, eq(ignoredReleases.gameId, games.id))
		.orderBy(sql`ignored_at DESC`)
		.all();

	const stats = db
		.select({
			indexer: sql`indexer`,
			count: sql`count(*)`
		})
		.from(sql`release`)
		.groupBy(sql`indexer`)
		.all() as Array<{ indexer: string; count: number }>;

	return {
		settings: {
			CRON_INTERVAL_MINUTES: settings.CRON_INTERVAL_MINUTES,
			QBIT_HOST: settings.QBIT_HOST,
			QBIT_USERNAME: settings.QBIT_USERNAME,
			QBIT_PASSWORD: settings.QBIT_PASSWORD,
			QBIT_CATEGORY: settings.QBIT_CATEGORY,
			PROWLARR_URL: settings.PROWLARR_URL,
			PROWLARR_API_KEY: settings.PROWLARR_API_KEY,
			IGDB_CLIENT_ID: settings.IGDB_CLIENT_ID,
			IGDB_CLIENT_SECRET: settings.IGDB_CLIENT_SECRET,
			PLATFORM_FILTER: settings.PLATFORM_FILTER,
			IGNORED_KEYWORDS: settings.IGNORED_KEYWORDS,
			ALLOWED_INDEXERS: settings.ALLOWED_INDEXERS
		},
		ignoredReleases: ignored,
		stats
	};
};

export const actions: Actions = {
	saveSettings: async ({ request }) => {
		const form = await request.formData();

		const formData: Record<string, string> = {
			CRON_INTERVAL_MINUTES: form.get('CRON_INTERVAL_MINUTES') as string,
			QBIT_HOST: form.get('QBIT_HOST') as string,
			QBIT_USERNAME: form.get('QBIT_USERNAME') as string,
			QBIT_PASSWORD: form.get('QBIT_PASSWORD') as string,
			QBIT_CATEGORY: form.get('QBIT_CATEGORY') as string,
			PROWLARR_URL: form.get('PROWLARR_URL') as string,
			PROWLARR_API_KEY: form.get('PROWLARR_API_KEY') as string,
			IGDB_CLIENT_ID: (form.get('IGDB_CLIENT_ID') as string) || '',
			IGDB_CLIENT_SECRET: (form.get('IGDB_CLIENT_SECRET') as string) || '',
			PLATFORM_FILTER: form.get('PLATFORM_FILTER') as string,
			IGNORED_KEYWORDS: (form.get('IGNORED_KEYWORDS') as string) || '',
			ALLOWED_INDEXERS: (form.get('ALLOWED_INDEXERS') as string) || ''
		};

		// Save to DB
		for (const [key, value] of Object.entries(formData)) {
			const existing = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
			if (existing) {
				db.update(appSettings)
					.set({ value, updatedAt: new Date().toISOString() })
					.where(eq(appSettings.key, key))
					.run();
			} else {
				db.insert(appSettings).values({ key, value }).run();
			}
		}

		const oldInterval = settings.CRON_INTERVAL_MINUTES;
		const oldIndexers = settings.ALLOWED_INDEXERS;

		// Update runtime config
		updateSettings({
			CRON_INTERVAL_MINUTES: parseInt(formData.CRON_INTERVAL_MINUTES, 10),
			QBIT_HOST: formData.QBIT_HOST,
			QBIT_USERNAME: formData.QBIT_USERNAME,
			QBIT_PASSWORD: formData.QBIT_PASSWORD,
			QBIT_CATEGORY: formData.QBIT_CATEGORY,
			PROWLARR_URL: formData.PROWLARR_URL,
			PROWLARR_API_KEY: formData.PROWLARR_API_KEY,
			IGDB_CLIENT_ID: formData.IGDB_CLIENT_ID || '',
			IGDB_CLIENT_SECRET: formData.IGDB_CLIENT_SECRET || '',
			PLATFORM_FILTER: formData.PLATFORM_FILTER,
			IGNORED_KEYWORDS: formData.IGNORED_KEYWORDS,
			ALLOWED_INDEXERS: formData.ALLOWED_INDEXERS
		});

		// Refresh indexer cache if changed
		if (oldIndexers !== formData.ALLOWED_INDEXERS) {
			await refreshIndexerCache();
		}

		// Reschedule if interval changed
		const newInterval = parseInt(formData.CRON_INTERVAL_MINUTES, 10);
		if (oldInterval !== newInterval) {
			rescheduleJob(newInterval);
		}

		return { success: true };
	},

	restoreIgnored: async ({ request }) => {
		const form = await request.formData();
		const id = parseInt(form.get('id') as string, 10);
		if (!id) return fail(400, { error: 'Invalid ID' });

		db.delete(ignoredReleases).where(eq(ignoredReleases.id, id)).run();
		return { success: true };
	}
};
