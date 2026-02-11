import { db } from './database.js';
import { games, scanLogs } from './schema.js';
import { eq } from 'drizzle-orm';
import { QBitService } from './qbit.js';
import { searchForGame, type SkipInfo } from './prowlarr.js';
import { progressManager } from './progress.js';
import { logger, logError } from './logger.js';

/**
 * Syncs game library from qBittorrent
 * Fetches torrents from qBit and updates local database
 * @returns Number of games synced
 */
export async function runSyncLibrary(): Promise<number> {
	logger.info('Starting library sync from qBittorrent...');

	try {
		await progressManager.startScan('Syncing', 1);
		await progressManager.update(0, 'Connecting to qBittorrent...');

		const qbit = new QBitService();
		const synced = await qbit.syncGames();

		await progressManager.update(1, 'Library sync complete');
		logger.info(`Library sync completed. ${synced} game(s) processed.`);
		return synced;
	} catch (error) {
		logError('Library sync failed', error);
		return 0;
	}
}

/**
 * Searches Prowlarr for updates to monitored games
 * Scans all monitored games and saves results to database
 * @returns Number of games scanned
 */
export async function runSearchUpdates(): Promise<number> {
	const startTime = Date.now();
	logger.info('Starting Prowlarr update search...');

	let scanned = 0;
	let totalFound = 0;
	let totalAdded = 0;
	const scanDetails: string[] = [];
	const allSkipped: Array<{ game: string; game_id: number; items: SkipInfo[] }> = [];

	try {
		const monitoredGames = db
			.select()
			.from(games)
			.where(eq(games.status, 'monitored'))
			.all();

		scanned = monitoredGames.length;
		logger.info(`Scanning ${scanned} monitored game(s)...`);
		await progressManager.startScan('Searching', scanned);

		for (let i = 0; i < monitoredGames.length; i++) {
			const game = monitoredGames[i];
			await progressManager.update(i, `Searching: ${game.title}`);

			try {
				const res = await searchForGame(game.id);
				totalFound += res.totalFound;
				totalAdded += res.added;

				if (res.error) {
					logger.warn(`Search error for ${game.title}: ${res.error}`);
					scanDetails.push(`${game.title}: ${res.error}`);
				}
				if (res.skipped.length > 0) {
					allSkipped.push({
						game: game.title,
						game_id: game.id,
						items: res.skipped
					});
				}
			} catch (error) {
				logError(`Exception while searching for ${game.title}`, error);
				scanDetails.push(`${game.title}: Exception ${String(error)}`);
			}
		}

		await progressManager.update(scanned, 'Search complete');
	} catch (error) {
		logError('Update search global failed', error);
		scanDetails.push(`Global Error: ${String(error)}`);
	}

	// Save scan log
	const duration = (Date.now() - startTime) / 1000;

	try {
		db.insert(scanLogs)
			.values({
				startedAt: new Date(startTime).toISOString(),
				durationSeconds: duration,
				gamesProcessed: scanned,
				updatesFound: totalAdded,
				status: scanDetails.length ? 'partial_success' : 'success',
				details: JSON.stringify({
					total_results_found: totalFound,
					errors: scanDetails.slice(0, 10)
				}),
				skipDetails: allSkipped.length ? JSON.stringify(allSkipped) : null
			})
			.run();
	} catch (error) {
		logError('Failed to save scan log to DB', error);
	}

	logger.info(`Update search completed. Found ${totalAdded} updates in ${duration.toFixed(1)}s.`);
	return scanned;
}

/**
 * Runs a full scan cycle: sync library + search for updates
 * This is the main scheduled task that runs periodically
 */
export async function runScanCycle(): Promise<void> {
	const startTime = Date.now();
	logger.info('==================================================');
	logger.info('Starting full scan cycle...');

	try {
		await runSyncLibrary();
		await runSearchUpdates();
	} catch (error) {
		logError('Full scan cycle encountered an error', error);
	} finally {
		await progressManager.complete();
	}

	const duration = (Date.now() - startTime) / 1000;
	logger.info(`Scan cycle completed in ${duration.toFixed(1)}s`);
	logger.info('==================================================');
}
