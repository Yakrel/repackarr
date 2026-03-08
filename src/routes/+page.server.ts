import { db } from '$lib/server/database.js';
import { games, releases, scanLogs } from '$lib/server/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { rankGameReleases } from '$lib/server/releaseSelection.js';
import { toTitleCaseWords } from '$lib/server/utils.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
	const totalGames = db.select({ count: sql<number>`count(*)` }).from(games).get()?.count ?? 0;
	const monitoredGames =
		db
			.select({ count: sql<number>`count(*)` })
			.from(games)
			.where(eq(games.status, 'monitored'))
			.get()?.count ?? 0;

	// Count unique games that have at least one non-ignored release
	const pendingUpdates =
		db
			.select({ count: sql<number>`count(distinct ${releases.gameId})` })
			.from(releases)
			.innerJoin(games, eq(releases.gameId, games.id))
			.where(and(eq(releases.isIgnored, false), eq(games.status, 'monitored')))
			.get()?.count ?? 0;

	// Get updates grouped by game (limit to 10 most recent per game)
	const allReleases = db
		.select()
		.from(releases)
		.where(eq(releases.isIgnored, false))
		.orderBy(sql`upload_date DESC`)
		.all();

	const allGames = db.select().from(games).all();
	const gameMap = new Map(allGames.map((g) => [g.id, g]));

	const grouped: Record<
		number,
		{
			game: (typeof allGames)[0];
			releases: (typeof allReleases)[0][];
		}
	> = {};

	for (const rel of allReleases) {
		const game = gameMap.get(rel.gameId);
		if (!game || game.status !== 'monitored') continue;
		if (!grouped[game.id]) {
			grouped[game.id] = {
				game: {
					...game,
					title: toTitleCaseWords(game.title)
				},
				releases: []
			};
		}
		grouped[game.id].releases.push(rel);
	}

	const updates = Object.values(grouped).map((group) => ({
		game: group.game,
		releases: rankGameReleases(group.game, group.releases).rankedReleases
	}));

	// Recent logs
	const logs = db
		.select()
		.from(scanLogs)
		.orderBy(sql`started_at DESC`)
		.limit(5)
		.all();

	return {
		stats: { totalGames, monitoredGames, pendingUpdates },
		updates,
		logs
	};
};
