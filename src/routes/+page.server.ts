import { db } from '$lib/server/database.js';
import { games, releases, scanLogs } from '$lib/server/schema.js';
import { eq, sql } from 'drizzle-orm';
import { compareVersions, estimateVersionConfidence, toTitleCaseWords } from '$lib/server/utils.js';
import type { PageServerLoad } from './$types.js';

const EPOCH_DATE = '1970-01-01T00:00:00.000Z';

function toTimestamp(value: string): number {
	const ts = Date.parse(value);
	return isNaN(ts) ? 0 : ts;
}

function getRecencyScore(uploadDate: string): number {
	const ts = toTimestamp(uploadDate);
	if (!ts) return 0;

	const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
	return Math.max(0, Math.round(40 - ageDays * 0.9));
}

function normalizeMetric(value: number | null | undefined): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
	return Math.trunc(value);
}

function getSeederScore(seeders: number | null): number {
	if (!seeders || seeders <= 0) return 0;
	const clamped = Math.min(seeders, 500);
	return Math.round((Math.log10(clamped + 1) / Math.log10(501)) * 24);
}

function getGrabScore(grabs: number | null): number {
	if (!grabs || grabs <= 0) return 0;
	const clamped = Math.min(grabs, 1000);
	return Math.round((Math.log10(clamped + 1) / Math.log10(1001)) * 10);
}

function getVersionScore(
	currentVersion: string | null,
	parsedVersion: string | null
): { score: number; state: 'newer' | 'same' | 'older' | 'unknown' } {
	if (!parsedVersion) return { score: 8, state: 'unknown' };
	if (!currentVersion) return { score: 26, state: 'unknown' };

	const cmp = compareVersions(currentVersion, parsedVersion);
	if (cmp === 1) return { score: 40, state: 'newer' };
	if (cmp === 0) return { score: 22, state: 'same' };
	if (cmp === -1) return { score: 0, state: 'older' };
	return { score: 12, state: 'unknown' };
}

export const load: PageServerLoad = async () => {
	const totalGames = db.select({ count: sql<number>`count(*)` }).from(games).get()?.count ?? 0;
	const monitoredGames =
		db
			.select({ count: sql<number>`count(*)` })
			.from(games)
			.where(eq(games.status, 'monitored'))
			.get()?.count ?? 0;
	const pendingUpdates =
		db
			.select({ count: sql<number>`count(*)` })
			.from(releases)
			.where(eq(releases.isIgnored, false))
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
	const latestVersionByGame = new Map<number, string>();

	for (const rel of allReleases) {
		if (!rel.parsedVersion) continue;

		const currentLatest = latestVersionByGame.get(rel.gameId);
		if (!currentLatest) {
			latestVersionByGame.set(rel.gameId, rel.parsedVersion);
			continue;
		}

		const cmp = compareVersions(currentLatest, rel.parsedVersion);
		if (cmp === 1) {
			latestVersionByGame.set(rel.gameId, rel.parsedVersion);
		}
	}

	type ScoredRelease = (typeof allReleases)[0] & {
		recommendationScore: number;
		recommendationTier: 'high' | 'medium' | 'low';
		confidenceScore: number;
		freshnessScore: number;
		popularityScore: number;
		seederScore: number;
		grabScore: number;
		versionState: 'newer' | 'same' | 'older' | 'unknown';
		recommendationCandidate: boolean;
		recommendationReason: string;
	};

	const grouped: Record<
		number,
		{
			game: (typeof allGames)[0];
			releases: ScoredRelease[];
		}
	> = {};

	for (const rel of allReleases) {
		const game = gameMap.get(rel.gameId);
		if (!game) continue;
		if (!grouped[game.id]) {
			grouped[game.id] = {
				game: {
					...game,
					title: toTitleCaseWords(game.title)
				},
				releases: []
			};
		}
		const confidenceRaw = estimateVersionConfidence(rel.rawTitle, rel.parsedVersion);
		const confidenceScore = Math.round((confidenceRaw / 100) * 20);
		const freshnessScore = getRecencyScore(rel.uploadDate);
		const seeders = normalizeMetric(rel.seeders);
		const leechers = normalizeMetric(rel.leechers);
		const grabs = normalizeMetric(rel.grabs);
		const seederScore = getSeederScore(seeders);
		const grabScore = getGrabScore(grabs);
		const popularityScore = seederScore + grabScore;
		const hasOwnedVersion = Boolean(
			game.currentVersion && game.currentVersionDate && game.currentVersionDate !== EPOCH_DATE
		);
		const effectiveCurrentVersion = hasOwnedVersion ? game.currentVersion : null;
		const version = getVersionScore(effectiveCurrentVersion, rel.parsedVersion);
		const latestVersion = latestVersionByGame.get(game.id) ?? null;
		const isTopVersionCandidate =
			!hasOwnedVersion &&
			Boolean(rel.parsedVersion) &&
			Boolean(latestVersion) &&
			compareVersions(latestVersion!, rel.parsedVersion!) === 0;
		let hasNewerVersionAvailable = false;
		if (hasOwnedVersion && effectiveCurrentVersion && latestVersion) {
			hasNewerVersionAvailable =
				compareVersions(effectiveCurrentVersion, latestVersion) === 1;
		}
		const versionScore = hasOwnedVersion
			? version.score
			: isTopVersionCandidate
				? 40
				: rel.parsedVersion
					? 12
					: 8;
		const recommendationScore = versionScore + confidenceScore + freshnessScore + popularityScore;
		const shouldRecommend = hasOwnedVersion
			? version.state === 'newer' || (!hasNewerVersionAvailable && version.state === 'same')
			: isTopVersionCandidate;
		const recommendationLabel = hasOwnedVersion
			? version.state === 'newer'
				? 'Newer than owned version'
				: !hasNewerVersionAvailable && version.state === 'same'
					? 'Best same-version match'
					: null
			: isTopVersionCandidate
				? 'Best available version'
				: null;
		const recommendationReason = recommendationLabel
			? [
					recommendationLabel,
					seeders !== null ? `${seeders} seeders` : null,
					leechers !== null ? `${leechers} leechers` : null,
					grabs !== null ? `${grabs} grabs` : null
				]
					.filter((part): part is string => Boolean(part))
					.join(' • ')
			: '';

		grouped[game.id].releases.push({
			...rel,
			recommendationScore,
			recommendationTier: 'low',
			confidenceScore,
			freshnessScore,
			popularityScore,
			seederScore,
			grabScore,
			versionState: version.state,
			recommendationCandidate: shouldRecommend,
			recommendationReason
		});
	}

	for (const group of Object.values(grouped)) {
		const sortedReleases = group.releases
			.sort((a, b) => {
				if (b.recommendationScore !== a.recommendationScore) {
					return b.recommendationScore - a.recommendationScore;
				}
				const seederDiff = (normalizeMetric(b.seeders) ?? 0) - (normalizeMetric(a.seeders) ?? 0);
				if (seederDiff !== 0) {
					return seederDiff;
				}
				return toTimestamp(b.uploadDate) - toTimestamp(a.uploadDate);
			})
			.slice(0, 10);

		const recommendedVersions = new Set<string>();
		let recommendedCount = 0;
		const maxRecommendationsPerGame = 2;

		group.releases = sortedReleases.map((rel) => {
			if (!rel.recommendationCandidate) {
				return rel;
			}

			const versionKey = rel.parsedVersion ?? `release-${rel.id}`;
			if (
				recommendedCount >= maxRecommendationsPerGame ||
				recommendedVersions.has(versionKey)
			) {
				return { ...rel, recommendationTier: 'low' };
			}

			recommendedVersions.add(versionKey);
			recommendedCount++;

			return {
				...rel,
				recommendationTier: rel.recommendationScore >= 88 ? 'high' : 'medium'
			};
		});
	}

	const updates = Object.values(grouped);

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
