import { db } from './database.js';
import { games, scanLogs, releases } from './schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { qbitService } from './qbit.js';
import { searchForGame, type SkipInfo } from './prowlarr.js';
import { progressManager } from './progress.js';
import { logger, logError } from './logger.js';
import { compareVersions } from './utils.js';
import { tryAutoDownloadForGames } from './autoDownload.js';

type ScanOptions = {
	throwOnError?: boolean;
};

export async function runSyncLibrary(
	currentProgress?: { start: number; total: number },
	options: ScanOptions = {}
): Promise<number> {
    logger.info('Starting library sync from qBittorrent...');
    try {
        if (currentProgress) {
            progressManager.update(currentProgress.start, 'Connecting to qBittorrent...');
        } else {
            progressManager.startScan('Syncing', 1);
            progressManager.update(0, 'Connecting to qBittorrent...');
        }
        const synced = await qbitService.syncGames();
        if (currentProgress) {
            progressManager.update(currentProgress.start + 1, 'Library sync complete');
        } else {
            progressManager.update(1, 'Library sync complete');
        }
        logger.info(`Library sync completed. ${synced} game(s) processed.`);
        return synced;
    } catch (error) {
        logError('Library sync failed', error);
        if (options.throwOnError) {
            throw error;
        }
        return 0;
    }
}

export async function runSearchUpdates(
	currentProgress?: { start: number; total: number },
	options: ScanOptions = {}
): Promise<number> {
    const startTime = Date.now();
    logger.info('Starting Prowlarr update search...');
    let scanned = 0, totalFound = 0, totalAdded = 0;
    const scanDetails: string[] = [];
    const allSkipped: Array<{ game: string; game_id: number; items: SkipInfo[] }> = [];
    let fatalError: unknown = null;

    try {
        const monitoredGames = db.select().from(games).where(eq(games.status, 'monitored')).all();
        scanned = monitoredGames.length;
        if (!currentProgress) progressManager.startScan('Searching', scanned);

        const concurrencyLimit = 5;
        const chunks = [];
        for (let i = 0; i < monitoredGames.length; i += concurrencyLimit) {
            chunks.push(monitoredGames.slice(i, i + concurrencyLimit));
        }

        let processedCount = 0;
        const startOffset = currentProgress ? currentProgress.start : 0;

        for (const chunk of chunks) {
            await Promise.all(chunk.map(async (game) => {
                try {
                    const res = await searchForGame(game.id);
                    totalFound += res.totalFound;
                    totalAdded += res.added;
                    if (res.error) scanDetails.push(`${game.title}: ${res.error}`);
                    if (res.skipped.length > 0) {
                        allSkipped.push({ game: game.title, game_id: game.id, items: res.skipped });
                    }
                } catch (error) {
                    logError(`Exception while searching for ${game.title}`, error);
                    scanDetails.push(`${game.title}: Exception ${String(error)}`);
                } finally {
                    processedCount++;
                    progressManager.update(startOffset + processedCount, `Searched: ${game.title}`);
                }
            }));
        }

        // --- STALE RELEASES CLEANUP ---
        // Final check to remove any releases that are now same/older than owned version
        const allGames = db.select().from(games).all();
        const staleIds: number[] = [];
        for (const game of allGames) {
            if (!game.currentVersion) continue;
            const gameReleases = db.select().from(releases).where(eq(releases.gameId, game.id)).all();
            for (const rel of gameReleases) {
                if (rel.parsedVersion) {
                    const cmp = compareVersions(game.currentVersion, rel.parsedVersion);
                    if (cmp === 0 || cmp === 1) {
                        staleIds.push(rel.id);
                        const skipItem: SkipInfo = {
                            gameId: game.id, gameTitle: game.title, title: rel.rawTitle,
                            date: rel.uploadDate, reason: `Owned version ${game.currentVersion} is same/newer`,
                            category: 'cleanup', indexer: rel.indexer, isNewerDate: false,
                            magnetUrl: rel.magnetUrl, infoUrl: rel.infoUrl, size: rel.size || '?'
                        };
                        const existing = allSkipped.find(s => s.game_id === game.id);
                        if (existing) existing.items.push(skipItem);
                        else allSkipped.push({ game: game.title, game_id: game.id, items: [skipItem] });
                    }
                }
            }
        }
        if (staleIds.length > 0) {
            db.delete(releases).where(inArray(releases.id, staleIds)).run();
            logger.info(`Cleaned up ${staleIds.length} stale release(s).`);
        }

        // --- ZERO-SEEDER CLEANUP ---
        const zeroSeederReleases = db.select().from(releases).all().filter(r => r.seeders === 0);
        if (zeroSeederReleases.length > 0) {
            db.delete(releases).where(inArray(releases.id, zeroSeederReleases.map(r => r.id))).run();
            logger.info(`Cleaned up ${zeroSeederReleases.length} zero-seeder release(s).`);
        }

    } catch (error) {
        logError('Update search failed', error);
        fatalError = error;
    }

    // Auto-download: attempt for all monitored games that now have qualifying releases
    const monitoredGameIds = db
        .select({ id: games.id })
        .from(games)
        .where(eq(games.status, 'monitored'))
        .all()
        .map((g) => g.id);

    if (monitoredGameIds.length > 0) {
        logger.info(`[Auto-Download] Running auto-download check for ${monitoredGameIds.length} game(s)...`);
        const downloaded = await tryAutoDownloadForGames(monitoredGameIds);
        if (downloaded > 0) {
            logger.info(`[Auto-Download] Auto-downloaded ${downloaded} game(s).`);
        }
    }

    const duration = (Date.now() - startTime) / 1000;
    try {
        db.insert(scanLogs).values({
            startedAt: new Date(startTime).toISOString(), durationSeconds: duration,
            gamesProcessed: scanned, updatesFound: totalAdded,
            status: fatalError ? 'failed' : scanDetails.length ? 'partial_success' : 'success',
            details: JSON.stringify({
                total_results_found: totalFound,
                errors: scanDetails.slice(0, 10),
                fatal_error: fatalError instanceof Error ? fatalError.message : fatalError ? String(fatalError) : null
            }),
            skipDetails: allSkipped.length ? JSON.stringify(allSkipped) : null
        }).run();
    } catch (e) { logError('Failed to save scan log', e); }

    if (fatalError && options.throwOnError) {
        throw fatalError;
    }

    return scanned;
}

export async function runScanCycle(): Promise<void> {
    const startTime = Date.now();
    try {
        let monitored = db.select().from(games).where(eq(games.status, 'monitored')).all();
        progressManager.startScan('Full Scan', 1 + monitored.length);
        await runSyncLibrary({ start: 0, total: 1 + monitored.length });
        
        monitored = db.select().from(games).where(eq(games.status, 'monitored')).all();
        progressManager.startScan('Full Scan', 1 + monitored.length);
        await runSearchUpdates({ start: 1, total: 1 + monitored.length });
    } catch (error) {
        logError('Full scan failed', error);
    } finally {
        progressManager.complete();
    }
}
