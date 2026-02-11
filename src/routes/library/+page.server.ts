import { db } from '$lib/server/database.js';
import { games, releases } from '$lib/server/schema.js';
import { eq, sql } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types.js';
import { fail } from '@sveltejs/kit';
import { normalizeTitle, cleanGameTitle, toTitleCaseWords } from '$lib/server/utils.js';
import { isIgdbEnabled } from '$lib/server/config.js';
import { getGameMetadata } from '$lib/server/igdb.js';
import { searchForGame } from '$lib/server/prowlarr.js';
import { logger } from '$lib/server/logger.js';

export const load: PageServerLoad = async () => {
	let allGames = db.select().from(games).orderBy(games.title).all();

	// Backfill missing Steam App IDs from IGDB for direct Steam/SteamDB links
	if (isIgdbEnabled()) {
		for (const game of allGames) {
			if (game.steamAppId) continue;
			try {
				const cleanedTitle = cleanGameTitle(game.title);
				const metadata = await getGameMetadata(cleanedTitle);
				if (!metadata) continue;

				const updates: Record<string, unknown> = {};
				if (!game.steamAppId && metadata.steamAppId) updates.steamAppId = metadata.steamAppId;
				if (!game.coverUrl && metadata.coverUrl) updates.coverUrl = metadata.coverUrl;
				if (Object.keys(updates).length === 0) continue;

				db.update(games).set(updates).where(eq(games.id, game.id)).run();
			} catch (error) {
				logger.warn(`Failed to backfill metadata for ${game.title}: ${error}`);
			}
		}

		allGames = db.select().from(games).orderBy(games.title).all();
	}

	// Get release counts per game
	const releaseCounts = db
		.select({
			gameId: releases.gameId,
			count: sql<number>`count(*)`
		})
		.from(releases)
		.where(eq(releases.isIgnored, false))
		.groupBy(releases.gameId)
		.all();

	const countMap = new Map(releaseCounts.map((r) => [r.gameId, r.count]));

	const gamesWithCounts = allGames.map((g) => ({
		...g,
		updateCount: countMap.get(g.id) || 0,
		cleanTitle: toTitleCaseWords(cleanGameTitle(g.title)),
		cleanSearchQuery: toTitleCaseWords(g.searchQuery)
	}));

	const stats = {
		totalGames: allGames.length,
		monitoredGames: allGames.filter((g) => g.status === 'monitored').length,
		pendingUpdates: releaseCounts.reduce((sum, r) => sum + r.count, 0)
	};

	return { games: gamesWithCounts, stats };
};

export const actions: Actions = {
	addGame: async ({ request }) => {
		const form = await request.formData();
		const titleRaw = (form.get('title') as string)?.trim();
		const searchQueryRaw = (form.get('search_query') as string)?.trim();
		const mode = form.get('mode') as string;
		const platformFilter = (form.get('platform_filter') as string) || 'Windows';
		const excludeKeywords = (form.get('exclude_keywords') as string)?.trim() || null;

		if (!titleRaw) return fail(400, { error: 'Title is required' });
		if (!searchQueryRaw) return fail(400, { error: 'Search query is required' });

		const title = toTitleCaseWords(titleRaw);
		const searchQuery = toTitleCaseWords(searchQueryRaw);

		// Check duplicates
		const normalizedTitle = normalizeTitle(title);
		const allGames = db.select().from(games).all();
		const duplicate = allGames.find((g) => normalizeTitle(g.title) === normalizedTitle);
		if (duplicate) {
			return fail(400, { error: `A similar game already exists: '${duplicate.title}'` });
		}

		const versionDate = new Date(0).toISOString();

		// Try IGDB metadata
		let coverUrl: string | null = null;
		let steamAppId: number | null = null;
		if (isIgdbEnabled()) {
			try {
				const cleanedTitle = cleanGameTitle(title);
				const metadata = await getGameMetadata(cleanedTitle);
				if (metadata) {
					coverUrl = metadata.coverUrl ?? null;
					steamAppId = metadata.steamAppId ?? null;
				}
			} catch (error) {
				logger.warn(`Failed to fetch IGDB metadata for ${title}: ${error}`);
			}
		}

		const result = db
			.insert(games)
			.values({
				title,
				searchQuery,
				currentVersionDate: versionDate,
				currentVersion: null,
				status: 'monitored',
				coverUrl,
				steamAppId,
				isManual: true,
				platformFilter,
				excludeKeywords
			})
			.returning()
			.get();

		// If download_now mode, search immediately
		if (mode === 'download_now' && result) {
			const searchResult = await searchForGame(result.id);
			return { 
				success: true, 
				gameId: result.id,
				foundReleases: searchResult.added,
				redirectToDashboard: mode === 'download_now'
			};
		}

		return { success: true, gameId: result.id };
	},

	updateGame: async ({ request }) => {
		const form = await request.formData();
		const id = parseInt(form.get('id') as string, 10);
		const titleRaw = (form.get('title') as string)?.trim();
		const searchQueryRaw = (form.get('search_query') as string)?.trim();
		const versionDate = form.get('version_date') as string;
		const version = (form.get('version') as string)?.trim() || null;
		const platformFilter = (form.get('platform_filter') as string) || 'Windows';
		const excludeKeywords = (form.get('exclude_keywords') as string)?.trim() || null;
		const igdbIdStr = form.get('igdb_id')?.toString();
		const igdbId = igdbIdStr ? parseInt(igdbIdStr) : null;

		if (!id) return fail(400, { error: 'Invalid game ID' });

		const title = titleRaw ? toTitleCaseWords(titleRaw) : undefined;
		const searchQuery = searchQueryRaw ? toTitleCaseWords(searchQueryRaw) : undefined;

		let parsedDate: string;
		try {
			parsedDate = new Date(versionDate).toISOString();
		} catch {
			return fail(400, { error: 'Invalid date format' });
		}

		db.update(games)
			.set({
				title,
				searchQuery,
				currentVersionDate: parsedDate,
				currentVersion: version,
				platformFilter,
				excludeKeywords,
				igdbId: isNaN(igdbId!) ? null : igdbId
			})
			.where(eq(games.id, id))
			.run();

		return { success: true };
	},

	deleteGame: async ({ request }) => {
		const form = await request.formData();
		const id = parseInt(form.get('id') as string, 10);
		if (!id) return fail(400, { error: 'Invalid game ID' });

		db.delete(games).where(eq(games.id, id)).run();
		return { success: true };
	},

	toggleMonitor: async ({ request }) => {
		const form = await request.formData();
		const id = parseInt(form.get('id') as string, 10);
		if (!id) return fail(400, { error: 'Invalid game ID' });

		const game = db.select().from(games).where(eq(games.id, id)).get();
		if (!game) return fail(404, { error: 'Game not found' });

		const newStatus = game.status === 'monitored' ? 'ignored' : 'monitored';
		db.update(games).set({ status: newStatus }).where(eq(games.id, id)).run();

		return { success: true };
	},

	updateQuery: async ({ request }) => {
		const form = await request.formData();
		const id = parseInt(form.get('id') as string, 10);
		const searchQuery = (form.get('search_query') as string)?.trim();

		if (!id || !searchQuery) return fail(400, { error: 'Invalid input' });

		db.update(games).set({ searchQuery }).where(eq(games.id, id)).run();
		return { success: true };
	}
};
