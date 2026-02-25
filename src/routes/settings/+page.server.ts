import { db } from '$lib/server/database.js';
import { games, ignoredReleases } from '$lib/server/schema.js';
import { eq, sql } from 'drizzle-orm';
import { settings, updateSettings, resetAppSettings, type AppSettings } from '$lib/server/config.js';
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
			QBIT_PASSWORD: settings.QBIT_PASSWORD ? '********' : '',
			QBIT_CATEGORY: settings.QBIT_CATEGORY,
			PROWLARR_URL: settings.PROWLARR_URL,
			PROWLARR_API_KEY: settings.PROWLARR_API_KEY ? `${settings.PROWLARR_API_KEY.slice(0, 4)}...${settings.PROWLARR_API_KEY.slice(-4)}` : '',
			IGDB_CLIENT_ID: settings.IGDB_CLIENT_ID ? `${settings.IGDB_CLIENT_ID.slice(0, 4)}...` : '',
			IGDB_CLIENT_SECRET: settings.IGDB_CLIENT_SECRET ? '********' : '',
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

		// Only AppSettings can be saved via UI
		const appSettingKeys: (keyof AppSettings)[] = [
			'PLATFORM_FILTER',
			'IGNORED_KEYWORDS',
			'ALLOWED_INDEXERS'
		];

		const updates: Partial<AppSettings> = {};
		let changed = false;

		for (const key of appSettingKeys) {
			const value = form.get(key);
			if (value !== null) {
				const valStr = value as string;
				if (settings[key] !== valStr) {
					updates[key] = valStr;
					changed = true;
				}
			}
		}

		if (changed) {
			const oldIndexers = settings.ALLOWED_INDEXERS;
			updateSettings(updates);

			// Refresh indexer cache if changed
			if (updates.ALLOWED_INDEXERS !== undefined && oldIndexers !== updates.ALLOWED_INDEXERS) {
				await refreshIndexerCache();
			}
		}

		return { success: true };
	},

	resetDefaults: async () => {
		resetAppSettings();
		await refreshIndexerCache();
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
