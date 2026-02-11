import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const games = sqliteTable('game', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	title: text('title').notNull(),
	searchQuery: text('search_query').notNull(),
	currentVersionDate: text('current_version_date').notNull(),
	currentVersion: text('current_version'),
	status: text('status', { enum: ['monitored', 'ignored'] })
		.notNull()
		.default('monitored'),
	platformFilter: text('platform_filter').notNull().default('Windows'),
	excludeKeywords: text('exclude_keywords'),
	isManual: integer('is_manual', { mode: 'boolean' }).notNull().default(false),
	qbitSyncedAt: text('qbit_synced_at'),
	igdbId: integer('igdb_id'),
	coverUrl: text('cover_url'),
	steamAppId: integer('steam_app_id'),
	sourceUrl: text('source_url'),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	lastScannedAt: text('last_scanned_at')
});

export const releases = sqliteTable('release', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	gameId: integer('game_id')
		.notNull()
		.references(() => games.id, { onDelete: 'cascade' }),
	rawTitle: text('raw_title').notNull(),
	parsedVersion: text('parsed_version'),
	uploadDate: text('upload_date').notNull(),
	indexer: text('indexer').notNull(),
	magnetUrl: text('magnet_url'),
	infoUrl: text('info_url'),
	size: text('size'),
	seeders: integer('seeders'),
	leechers: integer('leechers'),
	grabs: integer('grabs'),
	isIgnored: integer('is_ignored', { mode: 'boolean' }).notNull().default(false),
	foundAt: text('found_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const appSettings = sqliteTable('app_setting', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: text('updated_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const scanLogs = sqliteTable('scan_log', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	startedAt: text('started_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	durationSeconds: real('duration_seconds').notNull().default(0),
	gamesProcessed: integer('games_processed').notNull().default(0),
	updatesFound: integer('updates_found').notNull().default(0),
	status: text('status').notNull().default('success'),
	details: text('details'),
	skipDetails: text('skip_details')
});

export const ignoredReleases = sqliteTable('ignored_release', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	gameId: integer('game_id')
		.notNull()
		.references(() => games.id, { onDelete: 'cascade' }),
	releaseTitle: text('release_title').notNull(),
	rawTitle: text('raw_title').notNull(),
	ignoredAt: text('ignored_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type Release = typeof releases.$inferSelect;
export type NewRelease = typeof releases.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;
export type ScanLog = typeof scanLogs.$inferSelect;
export type IgnoredRelease = typeof ignoredReleases.$inferSelect;
