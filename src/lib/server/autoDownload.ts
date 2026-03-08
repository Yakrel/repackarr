import { db, transaction } from './database.js';
import { games, releases, notifications, appSettings } from './schema.js';
import { eq, and, lt } from 'drizzle-orm';
import { qbitService } from './qbit.js';
import { compareVersions, estimateVersionConfidence } from './utils.js';
import { logger } from './logger.js';
import { extractMagnetHash } from './validators.js';

// qBittorrent states that indicate an active, in-progress download
const ACTIVE_DOWNLOAD_STATES = new Set([
	'downloading',
	'stalledDL',
	'checkingDL',
	'allocating',
	'metaDL',
	'queuedDL',
	'forcedDL',
	'moving'
]);

const EPOCH_DATE = '1970-01-01T00:00:00.000Z';
const METADATA_POLL_INTERVAL_MS = 1000;
const METADATA_WAIT_TIMEOUT_MS = 10000;
const AUTO_DOWNLOAD_CONCURRENCY = 3;

function isActivelyDownloading(state: string): boolean {
	return ACTIVE_DOWNLOAD_STATES.has(state);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRecencyScore(uploadDate: string): number {
	const ts = Date.parse(uploadDate);
	if (!ts || isNaN(ts)) return 0;
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

type AutoDownloadCandidate = {
	release: typeof releases.$inferSelect;
	score: number;
	isTopCandidate: boolean; // true for new games with no owned version
};

function findBestCandidate(
	gameReleases: Array<typeof releases.$inferSelect>,
	game: typeof games.$inferSelect
): AutoDownloadCandidate | null {
	if (gameReleases.length === 0) return null;

	const hasOwnedVersion = Boolean(
		game.currentVersion &&
			game.currentVersionDate &&
			game.currentVersionDate !== EPOCH_DATE
	);

	// Find the latest version among all releases (for new-game "top candidate" logic)
	let latestVersion: string | null = null;
	for (const rel of gameReleases) {
		if (!rel.parsedVersion) continue;
		if (!latestVersion) {
			latestVersion = rel.parsedVersion;
			continue;
		}
		if (compareVersions(latestVersion, rel.parsedVersion) === -1) {
			latestVersion = rel.parsedVersion;
		}
	}

	const candidates: AutoDownloadCandidate[] = [];

	for (const rel of gameReleases) {
		const confidenceScore = Math.round((estimateVersionConfidence(rel.rawTitle, rel.parsedVersion) / 100) * 20);
		const freshnessScore = getRecencyScore(rel.uploadDate);
		const seederScore = getSeederScore(rel.seeders);
		const grabScore = getGrabScore(rel.grabs);
		const score = confidenceScore + freshnessScore + seederScore + grabScore;

		if (hasOwnedVersion) {
			// Only qualify if this release is newer than the owned version
			if (!rel.parsedVersion) continue;
			const cmp = compareVersions(game.currentVersion!, rel.parsedVersion);
			if (cmp !== -1) continue; // not newer, skip
			candidates.push({ release: rel, score, isTopCandidate: false });
		} else {
			// New game: only the top version candidate qualifies
			if (!rel.parsedVersion || rel.parsedVersion !== latestVersion) continue;
			candidates.push({ release: rel, score, isTopCandidate: true });
		}
	}

	if (candidates.length === 0) return null;

	// Return the highest scored candidate
	return candidates.sort((a, b) => b.score - a.score)[0];
}

async function isAutoDownloadEnabledForGame(game: typeof games.$inferSelect): Promise<boolean> {
	// Per-game override takes precedence
	if (game.autoDownloadEnabled !== null && game.autoDownloadEnabled !== undefined) {
		return Boolean(game.autoDownloadEnabled);
	}
	// Fall back to global setting
	const setting = db
		.select()
		.from(appSettings)
		.where(eq(appSettings.key, 'autoDownload'))
		.get();
	return setting?.value === 'true';
}

async function createNotification(
	type: 'auto_download_success' | 'auto_download_failed' | 'auto_download_skipped',
	gameId: number,
	gameTitle: string,
	message: string
): Promise<void> {
	try {
		db.insert(notifications).values({ type, gameId, gameTitle, message }).run();
		// Auto-cleanup: delete read notifications older than 30 days
		const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		db.delete(notifications).where(
			and(eq(notifications.isRead, true), lt(notifications.createdAt, cutoff))
		).run();
	} catch (err) {
		logger.warn(`Failed to create notification: ${err}`);
	}
}

async function waitForMetadataAndRecheck(hash: string, gameTitle: string): Promise<void> {
	const maxAttempts = Math.ceil(METADATA_WAIT_TIMEOUT_MS / METADATA_POLL_INTERVAL_MS);
	let metadataReceived = false;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const torrent = await qbitService.getTorrent(hash);
		if (torrent && torrent.total_size > 0) {
			metadataReceived = true;
			break;
		}

		if (attempt < maxAttempts - 1) {
			await delay(METADATA_POLL_INTERVAL_MS);
		}
	}

	if (!metadataReceived) {
		logger.warn(
			`[Auto-Download] Metadata not received for '${gameTitle}' within ${METADATA_WAIT_TIMEOUT_MS / 1000}s; requesting recheck anyway`
		);
	}

	const recheckStarted = await qbitService.recheckTorrent(hash);
	if (!recheckStarted) {
		logger.warn(`[Auto-Download] Failed to trigger recheck for '${gameTitle}' (hash: ${hash})`);
	}
}

export type AutoDownloadResult = {
	success: boolean;
	skipped: boolean;
	reason?: string;
	releaseTitle?: string;
	version?: string;
};

/**
 * Attempts to auto-download the best qualifying release for a game.
 * Returns a result object describing what happened.
 */
export async function tryAutoDownloadForGame(gameId: number): Promise<AutoDownloadResult> {
	const game = db.select().from(games).where(eq(games.id, gameId)).get();
	if (!game) return { success: false, skipped: true, reason: 'Game not found' };
	if (game.status !== 'monitored') return { success: false, skipped: true, reason: 'Game not monitored' };

	const enabled = await isAutoDownloadEnabledForGame(game);
	if (!enabled) return { success: false, skipped: true, reason: 'Auto-download disabled' };

	// Get all non-ignored releases for this game
	const gameReleases = db
		.select()
		.from(releases)
		.where(and(eq(releases.gameId, gameId), eq(releases.isIgnored, false)))
		.all();

	const candidate = findBestCandidate(gameReleases, game);
	if (!candidate) {
		return { success: false, skipped: true, reason: 'No qualifying release found' };
	}

	const { release } = candidate;

	// Check if the candidate version is the same as what we already have
	if (release.parsedVersion && game.currentVersion === release.parsedVersion) {
		return {
			success: false,
			skipped: true,
			reason: 'Already on this version',
			version: release.parsedVersion
		};
	}

	// Check for active download in qBittorrent
	if (game.infoHash) {
		try {
			const torrent = await qbitService.getTorrent(game.infoHash);
			if (torrent && isActivelyDownloading(torrent.state)) {
				const msg = `New version ${release.parsedVersion ?? 'unknown'} found, but ${game.title} is currently downloading (${Math.round(torrent.progress * 100)}%). Click to switch versions.`;
				logger.info(`[Auto-Download] Skipping ${game.title} — active download detected (state: ${torrent.state})`);
				await createNotification('auto_download_skipped', game.id, game.title, msg);
				return {
					success: false,
					skipped: true,
					reason: 'Active download in progress',
					releaseTitle: release.rawTitle,
					version: release.parsedVersion ?? undefined
				};
			}
		} catch (err) {
			logger.warn(`[Auto-Download] Could not check qBit state for ${game.title}: ${err}`);
			// Don't block auto-download if we can't check the state
		}
	}

	// Validate download URL
	const magnet = release.magnetUrl || release.infoUrl;
	if (!magnet) {
		const msg = `Failed to auto-download ${release.rawTitle} — no download link available.`;
		logger.warn(`[Auto-Download] ${msg}`);
		await createNotification('auto_download_failed', game.id, game.title, msg);
		return { success: false, skipped: false, reason: 'No download URL', releaseTitle: release.rawTitle };
	}

	// Remove old torrent from qBit (keep files on disk)
	if (game.infoHash) {
		const removed = await qbitService.removeTorrent(game.infoHash);
		if (removed) {
			logger.info(`[Auto-Download] Removed old torrent for '${game.title}' (hash: ${game.infoHash})`);
		} else {
			logger.warn(`[Auto-Download] Could not remove old torrent for '${game.title}' — may already be gone`);
		}
	}

	// Add new torrent to qBittorrent
	const qbitSuccess = await qbitService.addTorrent(magnet);
	if (!qbitSuccess) {
		const msg = `Failed to send ${release.rawTitle} to qBittorrent. Please check your qBittorrent connection.`;
		logger.error(`[Auto-Download] ${msg}`);
		await createNotification('auto_download_failed', game.id, game.title, msg);
		return {
			success: false,
			skipped: false,
			reason: 'qBittorrent add failed',
			releaseTitle: release.rawTitle
		};
	}

	// Kick off metadata polling/recheck without blocking the scan/request lifecycle.
	const newHash = extractMagnetHash(magnet);
	if (newHash) {
		void waitForMetadataAndRecheck(newHash, game.title).catch((err) => {
			logger.warn(`[Auto-Download] Post-add processing failed for '${game.title}': ${String(err)}`);
		});
	}

	// Update database atomically
	try {
		const nextRawName = release.rawTitle;
		const nextInfoHash = newHash ?? null;
		const nextSourceUrl = release.infoUrl ?? null;
		transaction(() => {
			db.update(games)
				.set({
					currentVersionDate: release.uploadDate,
					rawName: nextRawName,
					infoHash: nextInfoHash,
					sourceUrl: nextSourceUrl,
					...(release.parsedVersion ? { currentVersion: release.parsedVersion } : {})
				})
				.where(eq(games.id, game.id))
				.run();
			db.delete(releases).where(eq(releases.gameId, game.id)).run();
		});
	} catch (err) {
		logger.error(`[Auto-Download] DB update failed after successful qBit add for '${game.title}': ${err}`);
		const msg = `${release.rawTitle} was sent to qBittorrent but the database update failed. Please refresh.`;
		await createNotification('auto_download_failed', game.id, game.title, msg);
		return { success: false, skipped: false, reason: 'DB update failed', releaseTitle: release.rawTitle };
	}

	const versionStr = release.parsedVersion ? `v${release.parsedVersion}` : 'latest version';
	const msg = `${game.title} ${versionStr} was automatically downloaded and added to qBittorrent.`;
	logger.info(`[Auto-Download] ✅ ${msg}`);
	await createNotification('auto_download_success', game.id, game.title, msg);

	return {
		success: true,
		skipped: false,
		releaseTitle: release.rawTitle,
		version: release.parsedVersion ?? undefined
	};
}

/**
 * Attempts auto-download for multiple games (used after scan cycles).
 * Returns count of successful downloads.
 */
export async function tryAutoDownloadForGames(gameIds: number[]): Promise<number> {
	let downloadCount = 0;
	for (let i = 0; i < gameIds.length; i += AUTO_DOWNLOAD_CONCURRENCY) {
		const chunk = gameIds.slice(i, i + AUTO_DOWNLOAD_CONCURRENCY);
		const results = await Promise.all(
			chunk.map(async (gameId) => {
				try {
					return await tryAutoDownloadForGame(gameId);
				} catch (err) {
					logger.error(`[Auto-Download] Unexpected error for gameId ${gameId}: ${err}`);
					return null;
				}
			})
		);

		downloadCount += results.filter((result) => result?.success).length;
	}
	return downloadCount;
}
