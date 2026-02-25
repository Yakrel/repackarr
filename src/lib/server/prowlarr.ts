import { settings, getAllowedIndexersList, getIgnoredKeywordsList } from './config.js';
import { db } from './database.js';
import { games, releases, ignoredReleases } from './schema.js';
import { eq } from 'drizzle-orm';
import { logger, logError } from './logger.js';
import {
	extractVersion,
	formatSize,
	compareVersions,
	normalizeTitle
} from './utils.js';
import type { ProwlarrIndexer, ProwlarrSearchResult } from './types.js';

class IndexerCache {
    private cachedIds: number[] = [];
    private cacheTime = 0;
    private refreshPromise: Promise<number[]> | null = null;
    private readonly CACHE_DURATION = 60 * 60 * 1000;

    async getIds(): Promise<number[]> {
        if (this.cachedIds.length && Date.now() - this.cacheTime < this.CACHE_DURATION) return this.cachedIds;
        if (this.refreshPromise) return this.refreshPromise;
        this.refreshPromise = this.fetchFromProwlarr().then(ids => {
            this.cachedIds = ids;
            this.cacheTime = Date.now();
            this.refreshPromise = null;
            return ids;
        });
        return this.refreshPromise;
    }

    private async fetchFromProwlarr(): Promise<number[]> {
        const allowedList = getAllowedIndexersList();
        try {
            const resp = await fetch(`${settings.PROWLARR_URL}/api/v1/indexer`, {
                headers: { 'X-Api-Key': settings.PROWLARR_API_KEY }
            });
            if (!resp.ok) {
                logger.warn(`[IndexerCache] Failed to fetch indexers from Prowlarr: HTTP ${resp.status}`);
                return [];
            }
            const indexers: ProwlarrIndexer[] = await resp.json();
            const filtered = indexers.filter(i => allowedList.some(a => (i.name || '').toLowerCase().includes(a.toLowerCase())));
            logger.info(`[IndexerCache] Found ${indexers.length} indexer(s) in Prowlarr, ${filtered.length} matched allowed list [${allowedList.join(', ')}]: [${filtered.map(i => i.name).join(', ')}]`);
            if (filtered.length === 0 && allowedList.length > 0) {
                logger.warn(`[IndexerCache] No indexers matched. Available: [${indexers.map(i => i.name).join(', ')}]. Check ALLOWED_INDEXERS setting.`);
            }
            return filtered.map(i => i.id!);
        } catch (e) {
            logError('[IndexerCache] Exception fetching indexers from Prowlarr', e);
            return [];
        }
    }
}

const indexerCache = new IndexerCache();

export async function refreshIndexerCache(): Promise<void> {
	await indexerCache.getIds();
}

export interface SkipInfo {
    gameId: number; gameTitle: string; title: string; date: string; reason: string;
    category: string; indexer: string; isNewerDate: boolean; magnetUrl: string | null;
    infoUrl: string | null; size: string;
}

export interface SearchResult {
    gameId: number; totalFound: number; added: number; skipped: SkipInfo[]; error: string | null;
}

function parseDate(item: ProwlarrSearchResult): string | null {
    const dStr = item.publishDate || item.added;
    if (!dStr) return null;
    try {
        const d = new Date(dStr.replace('Z', '+00:00'));
        return isNaN(d.getTime()) ? null : d.toISOString();
    } catch { return null; }
}

export async function searchForGame(gameId: number): Promise<SearchResult> {
    const stats: SearchResult = { gameId, totalFound: 0, added: 0, skipped: [], error: null };
    const game = db.select().from(games).where(eq(games.id, gameId)).get();
    if (!game) return { ...stats, error: 'Game not found' };

    try {
        const indexerIds = await indexerCache.getIds();
        
        const params = new URLSearchParams({ 
            query: game.searchQuery, 
            type: 'search', 
            limit: '50'
        });
        indexerIds.forEach(id => params.append('indexerIds', String(id)));

        if (indexerIds.length === 0) {
            logger.warn(`[Prowlarr] No indexer IDs for search of '${game.title}' — searching all enabled indexers`);
        }
        logger.info(`[Prowlarr] Searching for '${game.title}' | query="${game.searchQuery}" | indexers=[${indexerIds.join(',')}]`);

        const resp = await fetch(`${settings.PROWLARR_URL}/api/v1/search?${params}`, {
            headers: { 'X-Api-Key': settings.PROWLARR_API_KEY }
        });
        if (!resp.ok) {
            logger.error(`[Prowlarr] Search request failed for '${game.title}': HTTP ${resp.status}`);
            return { ...stats, error: `HTTP ${resp.status}` };
        }

        const results = (await resp.json()) as ProwlarrSearchResult[];
        logger.debug(`[Prowlarr] '${game.title}': ${results.length} result(s) received from Prowlarr`);
        stats.totalFound = results.length;

        const ignoredKeywords = getIgnoredKeywordsList();
        const queryPattern = new RegExp(`\\b${normalizeTitle(game.searchQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

        const existingReleasesMap = new Map(db.select().from(releases).where(eq(releases.gameId, game.id)).all().map(r => [r.rawTitle, r]));
        const ignoredTitlesSet = new Set(db.select().from(ignoredReleases).where(eq(ignoredReleases.gameId, game.id)).all().map(r => r.releaseTitle));

        // 1. PHASE: Healing
        for (const item of results) {
            checkAndHealVersion(item, game);
        }

        // 2. PHASE: Filtering
        for (const item of results) {
            const processed = processSearchResult(item, game, ignoredKeywords, queryPattern, ignoredTitlesSet, existingReleasesMap);
            if (processed.release) {
                db.insert(releases).values(processed.release).run();
                stats.added++;
            } else if (processed.skipInfo) {
                stats.skipped.push(processed.skipInfo);
            }
        }

        db.update(games).set({ lastScannedAt: new Date().toISOString() }).where(eq(games.id, gameId)).run();
    } catch (e) { stats.error = String(e); }
    return stats;
}

function checkAndHealVersion(item: ProwlarrSearchResult, game: any): void {
    if (game.currentVersion) return;

    const itemUrl = item.infoUrl || (item.guid?.startsWith('http') ? item.guid : null);
    const remoteVersion = extractVersion(item.title || '');
    
    if (!remoteVersion) return;

    // URL/Topic Match + Download Timing
    // publishDate on RuTracker/NNM reflects the last torrent upload date (not original post date),
    // so if the post was updated after the user's download, we skip to avoid assigning a version they don't have.
    // 4-hour buffer handles timezone/sync differences.
    if (game.sourceUrl && itemUrl && (game.sourceUrl.includes(itemUrl) || itemUrl.includes(game.sourceUrl))) {
        const uploadDate = parseDate(item);
        if (uploadDate) {
            const qbitTime = new Date(game.currentVersionDate).getTime();
            const prowlarrTime = new Date(uploadDate).getTime();
            
            if (qbitTime >= (prowlarrTime - 4 * 60 * 60 * 1000)) {
                logger.info(`[Healing] Found version for '${game.title}': ${remoteVersion} (Reason: URL + Date sequence match)`);
                db.update(games).set({ currentVersion: remoteVersion }).where(eq(games.id, game.id)).run();
                game.currentVersion = remoteVersion;
            } else {
                logger.debug(`[Healing Skip] Topic for '${game.title}' is newer than download. Proof might be gone.`);
            }
        }
    }
}

function processSearchResult(
    item: ProwlarrSearchResult,
    game: typeof games.$inferSelect,
    ignoredKeywords: string[],
    queryPattern: RegExp,
    ignoredTitlesSet: Set<string>,
    existingReleasesMap: Map<string, any>
): { release?: any; skipInfo?: SkipInfo } {
    const title = item.title || '';
    const indexer = item.indexer || 'Unknown';
    const uploadDate = parseDate(item);
    const remoteVersion = extractVersion(title);
    const isNewerDate = uploadDate ? uploadDate > game.currentVersionDate : false;
    const size = item.size ? formatSize(item.size) : '?';
    const infoUrl = item.infoUrl || (item.guid && item.guid.startsWith('http') ? item.guid : null);

    function makeSkip(reason: string, category: string): { skipInfo: SkipInfo } {
        return {
            skipInfo: {
                gameId: game.id, gameTitle: game.title, title,
                date: uploadDate ? new Date(uploadDate).toISOString().slice(0, 16).replace('T', ' ') : 'N/A',
                reason, category, indexer, isNewerDate,
                magnetUrl: item.magnetUrl || item.downloadUrl || null,
                infoUrl, size
            }
        };
    }

    if (!queryPattern.test(normalizeTitle(title))) return makeSkip('Title mismatch', 'title');
    if (ignoredTitlesSet.has(title)) return makeSkip('User ignored', 'ignored');

    const titleL = title.toLowerCase();
    const matchedKeyword = ignoredKeywords.find(k => {
        // Use word boundaries for plain alphabetic keywords (e.g. "ep" must not match inside "repack")
        if (/^[a-z]+$/.test(k)) return new RegExp(`\\b${k}\\b`).test(titleL);
        return titleL.includes(k);
    });
    if (matchedKeyword) return makeSkip(`Ignored keyword found: "${matchedKeyword}"`, 'keyword');

    const platforms = ['ps5', 'ps4', 'xbox', 'switch', 'android'];
    const foundPlatform = platforms.find(p => titleL.includes(p));
    if (foundPlatform) return makeSkip(`Platform excluded (${foundPlatform})`, 'platform');

    const isWine = titleL.includes('[wine]') || titleL.includes('[proton]');
    const isMac  = titleL.includes('[mac]') || titleL.includes('macintosh');
    if (game.platformFilter === 'Windows' && (isWine || isMac))
        return makeSkip(`Platform excluded (${isWine ? 'Wine/Linux' : 'macOS'})`, 'platform');
    if (game.platformFilter === 'macOS' && isWine)
        return makeSkip('Platform excluded (Wine/Linux)', 'platform');
    if (game.platformFilter === 'Linux' && isMac)
        return makeSkip('Platform excluded (macOS)', 'platform');
    
    if (remoteVersion && game.currentVersion) {
        const cmp = compareVersions(game.currentVersion, remoteVersion);
        if (cmp === 0) return makeSkip(`Version ${remoteVersion} matches owned`, 'version');
        if (cmp === 1) return makeSkip(`Version ${remoteVersion} is older than owned`, 'version');
    }

    if (!isNewerDate) return makeSkip('Date not newer than owned version date', 'older');
    if (existingReleasesMap.has(title)) return makeSkip('Already in library', 'duplicate');

    return {
        release: {
            gameId: game.id, rawTitle: title, parsedVersion: remoteVersion,
            uploadDate: uploadDate || new Date(0).toISOString(), indexer,
            magnetUrl: item.magnetUrl || item.downloadUrl, size,
            seeders: item.seeders, leechers: item.leechers, grabs: item.grabs,
            infoUrl
        }
    };
}
