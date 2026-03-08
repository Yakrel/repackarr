import { db, transaction } from './database.js';
import { games, releases, notifications, appSettings } from './schema.js';
import { eq, and, lt } from 'drizzle-orm';
import { qbitService } from './qbit.js';
import { logger } from './logger.js';
import { extractMagnetHash } from './validators.js';
import { rankGameReleases } from './releaseSelection.js';

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

const METADATA_POLL_INTERVAL_MS = 1000;
const METADATA_WAIT_TIMEOUT_MS = 10000;
const AUTO_DOWNLOAD_CONCURRENCY = 3;

function isActivelyDownloading(state: string): boolean {
	return ACTIVE_DOWNLOAD_STATES.has(state);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
	selectionReason?: string;
	recommendationScore?: number;
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

	const { selectedRelease } = rankGameReleases(game, gameReleases);
	if (!selectedRelease) {
		return { success: false, skipped: true, reason: 'No qualifying release found' };
	}

	const release = selectedRelease;
	const selectionReason = release.recommendationReason || 'Top-ranked auto-download candidate';
	logger.info(
		`[Auto-Download] Selected '${release.rawTitle}' for '${game.title}' (${selectionReason}; score: ${release.recommendationScore})`
	);

	// Check if the candidate version is the same as what we already have
	if (release.parsedVersion && game.currentVersion === release.parsedVersion) {
		return {
			success: false,
			skipped: true,
			reason: 'Already on this version',
			version: release.parsedVersion,
			releaseTitle: release.rawTitle,
			selectionReason,
			recommendationScore: release.recommendationScore
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
					version: release.parsedVersion ?? undefined,
					selectionReason,
					recommendationScore: release.recommendationScore
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
		return {
			success: false,
			skipped: false,
			reason: 'No download URL',
			releaseTitle: release.rawTitle,
			selectionReason,
			recommendationScore: release.recommendationScore
		};
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
			releaseTitle: release.rawTitle,
			selectionReason,
			recommendationScore: release.recommendationScore
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
		return {
			success: false,
			skipped: false,
			reason: 'DB update failed',
			releaseTitle: release.rawTitle,
			selectionReason,
			recommendationScore: release.recommendationScore
		};
	}

	const versionStr = release.parsedVersion ? `v${release.parsedVersion}` : 'latest version';
	const msg = `${game.title} ${versionStr} was automatically downloaded and added to qBittorrent.`;
	logger.info(`[Auto-Download] ✅ ${msg}`);
	await createNotification('auto_download_success', game.id, game.title, msg);

	return {
		success: true,
		skipped: false,
		releaseTitle: release.rawTitle,
		version: release.parsedVersion ?? undefined,
		selectionReason,
		recommendationScore: release.recommendationScore
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
