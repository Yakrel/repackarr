import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
 * Run Drizzle Kit migrations against the database.
 * Migration files in ./drizzle/ are applied in order; already-applied ones are skipped.
 */
export function runMigrations(): void {
	if (!_db) {
		_db = createDb();
	}

	const migrationsFolder = process.env.MIGRATIONS_DIR || './drizzle';
	logger.info('Running database migrations...');
	migrate(_db, { migrationsFolder });
	logger.info('Database migrations complete.');
}
