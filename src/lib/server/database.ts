import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { existsSync, mkdirSync } from 'fs';
import { logger } from './logger.js';

let _db: BetterSQLite3Database<typeof schema> | null = null;
let _sqlite: Database.Database | null = null;

function getDataDir(): string {
	return process.env.DATA_DIR || '/app/data';
}

function createDb(): BetterSQLite3Database<typeof schema> {
	const dataDir = getDataDir();

	if (!existsSync(dataDir)) {
		mkdirSync(dataDir, { recursive: true });
	}

	const dbPath = `${dataDir}/repackarr.db`;
	_sqlite = new Database(dbPath);

	_sqlite.pragma('journal_mode = WAL');
	_sqlite.pragma('foreign_keys = ON');

	return drizzle(_sqlite, { schema });
}

export const db = new Proxy({} as BetterSQLite3Database<typeof schema>, {
	get(_target, prop, receiver) {
		if (!_db) {
			_db = createDb();
		}
		return Reflect.get(_db, prop, receiver);
	}
});

/**
 * Execute multiple database operations in a transaction
 * @param fn - Function containing database operations
 * @returns Result of the function or throws on error
 */
export function transaction<T>(fn: () => T): T {
	if (!_sqlite) {
		// Initialize database if not already done
		if (!_db) {
			_db = createDb();
		}
	}
	
	if (!_sqlite) {
		throw new Error('Database not initialized');
	}

	const trans = _sqlite.transaction(fn);
	return trans();
}

/**
 * Initialize database tables using Drizzle schema
 * Better approach: use drizzle-kit migrations in production
 */
export function initDatabase(): void {
	if (!_db) {
		_db = createDb();
	}

	if (!_sqlite) {
		throw new Error('Database initialization failed');
	}

	// Create tables using raw SQL for initial setup
	// In production, use drizzle-kit migrations instead
	_sqlite.exec(`
		CREATE TABLE IF NOT EXISTS game (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			search_query TEXT NOT NULL,
			current_version_date TEXT NOT NULL,
			current_version TEXT,
			status TEXT NOT NULL DEFAULT 'monitored',
			platform_filter TEXT NOT NULL DEFAULT 'Windows',
			exclude_keywords TEXT,
			is_manual INTEGER NOT NULL DEFAULT 0,
			qbit_synced_at TEXT,
			igdb_id INTEGER,
			cover_url TEXT,
			steam_app_id INTEGER,
			source_url TEXT,
			created_at TEXT NOT NULL,
			last_scanned_at TEXT
		);

		CREATE TABLE IF NOT EXISTS release (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
			raw_title TEXT NOT NULL,
			parsed_version TEXT,
			upload_date TEXT NOT NULL,
			indexer TEXT NOT NULL,
			magnet_url TEXT,
			info_url TEXT,
			size TEXT,
			seeders INTEGER,
			leechers INTEGER,
			grabs INTEGER,
			is_ignored INTEGER NOT NULL DEFAULT 0,
			found_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS app_setting (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS scan_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			started_at TEXT NOT NULL,
			duration_seconds REAL NOT NULL DEFAULT 0,
			games_processed INTEGER NOT NULL DEFAULT 0,
			updates_found INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'success',
			details TEXT,
			skip_details TEXT
		);

		CREATE TABLE IF NOT EXISTS ignored_release (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
			release_title TEXT NOT NULL,
			raw_title TEXT NOT NULL,
			ignored_at TEXT NOT NULL,
			UNIQUE(game_id, release_title)
		);

		-- Note: UNIQUE constraint on (game_id, release_title) prevents duplicate ignores
		-- release_title and raw_title should be the same at insertion time
		-- This ensures a user cannot ignore the same release twice for a game

		CREATE INDEX IF NOT EXISTS idx_game_title ON game(title);
		CREATE INDEX IF NOT EXISTS idx_release_game_id ON release(game_id);
		CREATE INDEX IF NOT EXISTS idx_ignored_release_game_id ON ignored_release(game_id);
		CREATE INDEX IF NOT EXISTS idx_release_raw_title ON release(raw_title);
	`);

	// Backward-compatible column additions for existing databases
	const gameColumns = _sqlite
		.prepare('PRAGMA table_info(game)')
		.all() as Array<{ name: string }>;
	const gameColumnNames = new Set(gameColumns.map((c) => c.name));
	if (!gameColumnNames.has('source_url')) {
		_sqlite.exec('ALTER TABLE game ADD COLUMN source_url TEXT;');
	}

	const releaseColumns = _sqlite
		.prepare('PRAGMA table_info(release)')
		.all() as Array<{ name: string }>;
	const releaseColumnNames = new Set(releaseColumns.map((c) => c.name));
	if (!releaseColumnNames.has('seeders')) {
		_sqlite.exec('ALTER TABLE release ADD COLUMN seeders INTEGER;');
	}
	if (!releaseColumnNames.has('leechers')) {
		_sqlite.exec('ALTER TABLE release ADD COLUMN leechers INTEGER;');
	}
	if (!releaseColumnNames.has('grabs')) {
		_sqlite.exec('ALTER TABLE release ADD COLUMN grabs INTEGER;');
	}

	logger.info('Database initialized successfully');
}
