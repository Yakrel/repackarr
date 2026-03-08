import { games, releases } from './schema.js';
import { compareVersions, estimateVersionConfidence } from './utils.js';

const EPOCH_DATE = '1970-01-01T00:00:00.000Z';

type GameRecord = typeof games.$inferSelect;
type ReleaseRecord = typeof releases.$inferSelect;

export type ReleaseVersionState = 'newer' | 'same' | 'older' | 'unknown';

export type RankedRelease = ReleaseRecord & {
	confidenceScore: number;
	freshnessScore: number;
	popularityScore: number;
	seederScore: number;
	grabScore: number;
	recommendationScore: number;
	versionState: ReleaseVersionState;
	hasDownloadLink: boolean;
	isAutoDownloadCandidate: boolean;
	isRecommended: boolean;
	recommendationTier: 'high' | 'low';
	recommendationReason: string;
};

export type GameReleaseSelection = {
	rankedReleases: RankedRelease[];
	selectedRelease: RankedRelease | null;
};

function toTimestamp(value: string): number {
	const ts = Date.parse(value);
	return isNaN(ts) ? 0 : ts;
}

function normalizeMetric(value: number | null | undefined): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
	return Math.trunc(value);
}

function getRecencyScore(uploadDate: string): number {
	const ts = toTimestamp(uploadDate);
	if (!ts) return 0;

	const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
	return Math.max(0, Math.round(40 - ageDays * 0.9));
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

function hasOwnedVersion(game: GameRecord): boolean {
	return Boolean(
		game.currentVersion &&
			game.currentVersionDate &&
			game.currentVersionDate !== EPOCH_DATE
	);
}

function getLatestParsedVersion(gameReleases: ReleaseRecord[]): string | null {
	let latestVersion: string | null = null;

	for (const release of gameReleases) {
		if (!release.parsedVersion) continue;
		if (!latestVersion) {
			latestVersion = release.parsedVersion;
			continue;
		}

		if (compareVersions(latestVersion, release.parsedVersion) === -1) {
			latestVersion = release.parsedVersion;
		}
	}

	return latestVersion;
}

function getVersionState(
	currentVersion: string | null,
	parsedVersion: string | null
): ReleaseVersionState {
	if (!parsedVersion) return 'unknown';
	if (!currentVersion) return 'unknown';

	const cmp = compareVersions(currentVersion, parsedVersion);
	if (cmp === -1) return 'newer';
	if (cmp === 0) return 'same';
	if (cmp === 1) return 'older';
	return 'unknown';
}

function getVersionScore(
	hasCurrentVersion: boolean,
	versionState: ReleaseVersionState,
	isAutoDownloadCandidate: boolean,
	parsedVersion: string | null
): number {
	if (isAutoDownloadCandidate) return 40;
	if (!hasCurrentVersion) return parsedVersion ? 12 : 8;
	if (versionState === 'same') return 22;
	if (versionState === 'unknown') return 12;
	return 0;
}

function buildRecommendationReason(
	release: RankedRelease,
	gameHasOwnedVersion: boolean
): string {
	const label = gameHasOwnedVersion ? 'Newer version' : 'Best match';

	return [
		label,
		release.seeders !== null ? `${release.seeders} seeders` : null,
		release.leechers !== null ? `${release.leechers} leechers` : null,
		release.grabs !== null ? `${release.grabs} grabs` : null
	]
		.filter((part): part is string => Boolean(part))
		.join(' • ');
}

export function rankGameReleases(
	game: GameRecord,
	gameReleases: ReleaseRecord[]
): GameReleaseSelection {
	const gameHasOwnedVersion = hasOwnedVersion(game);
	const currentVersion = gameHasOwnedVersion ? game.currentVersion : null;
	const latestParsedVersion = getLatestParsedVersion(gameReleases);

	const scoredReleases = gameReleases
		.map((release) => {
			const seeders = normalizeMetric(release.seeders);
			const grabs = normalizeMetric(release.grabs);
			const seederScore = getSeederScore(seeders);
			const grabScore = getGrabScore(grabs);
			const versionState = getVersionState(currentVersion, release.parsedVersion);
			const hasDownloadLink = Boolean(release.magnetUrl || release.infoUrl);
			const isAutoDownloadCandidate = hasDownloadLink && (
				gameHasOwnedVersion
					? versionState === 'newer'
					: Boolean(
							release.parsedVersion &&
							latestParsedVersion &&
							compareVersions(latestParsedVersion, release.parsedVersion) === 0
						)
			);
			const confidenceScore = Math.round(
				(estimateVersionConfidence(release.rawTitle, release.parsedVersion) / 100) * 20
			);
			const freshnessScore = getRecencyScore(release.uploadDate);
			const popularityScore = seederScore + grabScore;
			const versionScore = getVersionScore(
				gameHasOwnedVersion,
				versionState,
				isAutoDownloadCandidate,
				release.parsedVersion
			);

			return {
				...release,
				confidenceScore,
				freshnessScore,
				popularityScore,
				seederScore,
				grabScore,
				recommendationScore: versionScore + confidenceScore + freshnessScore + popularityScore,
				versionState,
				hasDownloadLink,
				isAutoDownloadCandidate,
				isRecommended: false,
				recommendationTier: 'low' as const,
				recommendationReason: ''
			};
		})
		.sort((a, b) => {
			if (a.isAutoDownloadCandidate !== b.isAutoDownloadCandidate) {
				return a.isAutoDownloadCandidate ? -1 : 1;
			}

			if (b.recommendationScore !== a.recommendationScore) {
				return b.recommendationScore - a.recommendationScore;
			}

			const seederDiff = (normalizeMetric(b.seeders) ?? 0) - (normalizeMetric(a.seeders) ?? 0);
			if (seederDiff !== 0) {
				return seederDiff;
			}

			return toTimestamp(b.uploadDate) - toTimestamp(a.uploadDate);
		});

	const selectedReleaseId =
		scoredReleases.find((release) => release.isAutoDownloadCandidate)?.id ?? null;

	const rankedReleases = scoredReleases.map((release) => {
		const isRecommended = release.id === selectedReleaseId;

		return {
			...release,
			isRecommended,
			recommendationTier: isRecommended ? ('high' as const) : ('low' as const),
			recommendationReason: isRecommended
				? buildRecommendationReason(release, gameHasOwnedVersion)
				: ''
		};
	});

	const selectedRelease =
		selectedReleaseId === null
			? null
			: rankedReleases.find((release) => release.id === selectedReleaseId) ?? null;

	return {
		rankedReleases,
		selectedRelease
	};
}
