import { z } from 'zod';
import dotenv from 'dotenv';
import { db } from './database.js';
import { appSettings } from './schema.js';
import { eq } from 'drizzle-orm';
import { logger } from './logger.js';

// Load environment variables from .env file
dotenv.config();

// Core settings are infrastructure related and stay in .env
const hostSchema = z.preprocess((val) => {
	if (typeof val !== 'string') return '';
	let trimmed = val.trim();
	if (!trimmed) return '';
	if (!/^https?:\/\//i.test(trimmed)) {
		trimmed = 'http://' + trimmed;
	}
	try {
		new URL(trimmed);
		return trimmed;
	} catch {
		return '';
	}
}, z.string().default(''));

const coreSettingsSchema = z.object({
	QBIT_HOST: hostSchema,
	QBIT_USERNAME: z.string().default(''),
	QBIT_PASSWORD: z.string().default(''),
	QBIT_CATEGORY: z.string().default('games'),
	TRANSMISSION_HOST: hostSchema,
	TRANSMISSION_USERNAME: z.string().default(''),
	TRANSMISSION_PASSWORD: z.string().default(''),
	TRANSMISSION_LABEL: z.string().default('games'),
	PROWLARR_URL: hostSchema,
	PROWLARR_API_KEY: z.string().default(''),
	AUTH_USERNAME: z.string().optional().default(''),
	AUTH_PASSWORD: z.string().optional().default(''),
	CRON_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(360),
	STARTUP_SCAN_DELAY_SECONDS: z.coerce.number().int().min(0).max(3600).default(120),
	IGDB_CLIENT_ID: z.string().optional().default(''),
	IGDB_CLIENT_SECRET: z.string().optional().default(''),
	DATA_DIR: z.string().default('/app/data')
});

// App settings are user-facing filters and are stored in the database
const DEFAULT_APP_SETTINGS = {
	PLATFORM_FILTER: 'Windows',
	IGNORED_KEYWORDS: 'OST,Soundtrack,Wallpaper,Update Only,Crack Only,PS2,PS3,PS4,PS5,Xbox,Xbox360,Switch,Nintendo,Wii,WiiU,Console,[NSP],[XCI],Mod,Translation,Patch,FLAC,MP3,Lossless,Discography,Diskografiya,Hi-Res,Vinyl,Remaster,24-bit,Lossy,Album,EP,Single',
	ALLOWED_INDEXERS: 'NoNaMe Club, RuTracker.org'
};

export type CoreSettings = z.infer<typeof coreSettingsSchema>;
export type AppSettings = typeof DEFAULT_APP_SETTINGS;
export type Settings = CoreSettings & AppSettings;

let _coreSettings: CoreSettings | null = null;
let _appSettingsCache: AppSettings | null = null;

function loadCoreSettings(): CoreSettings {
	if (_coreSettings) return _coreSettings;
	_coreSettings = coreSettingsSchema.parse({
		QBIT_HOST: process.env.QBIT_HOST,
		QBIT_USERNAME: process.env.QBIT_USERNAME,
		QBIT_PASSWORD: process.env.QBIT_PASSWORD,
		QBIT_CATEGORY: process.env.QBIT_CATEGORY,
		TRANSMISSION_HOST: process.env.TRANSMISSION_HOST,
		TRANSMISSION_USERNAME: process.env.TRANSMISSION_USERNAME,
		TRANSMISSION_PASSWORD: process.env.TRANSMISSION_PASSWORD,
		TRANSMISSION_LABEL: process.env.TRANSMISSION_LABEL,
		PROWLARR_URL: process.env.PROWLARR_URL,
		PROWLARR_API_KEY: process.env.PROWLARR_API_KEY,
		AUTH_USERNAME: process.env.AUTH_USERNAME,
		AUTH_PASSWORD: process.env.AUTH_PASSWORD,
		CRON_INTERVAL_MINUTES: process.env.CRON_INTERVAL_MINUTES,
		STARTUP_SCAN_DELAY_SECONDS: process.env.STARTUP_SCAN_DELAY_SECONDS,
		IGDB_CLIENT_ID: process.env.IGDB_CLIENT_ID,
		IGDB_CLIENT_SECRET: process.env.IGDB_CLIENT_SECRET,
		DATA_DIR: process.env.DATA_DIR
	});
	if (_coreSettings.QBIT_HOST && _coreSettings.TRANSMISSION_HOST) {
		logger.warn('[Config] CONFLICT: Both QBIT_HOST and TRANSMISSION_HOST are set. Repackarr expects only ONE torrent client.');
	} else if (!_coreSettings.QBIT_HOST && !_coreSettings.TRANSMISSION_HOST) {
		logger.warn('[Config] No torrent client configured (missing QBIT_HOST or TRANSMISSION_HOST) — downloading will be unavailable.');
	}
	if (!_coreSettings.PROWLARR_URL)
		logger.warn('[Config] PROWLARR_URL is not set or invalid — Prowlarr searches will fail.');
	return _coreSettings;
}

/**
 * Loads application settings from the database.
 * If database is empty, it seeds with default values.
 */
function loadAppSettings(): AppSettings {
	if (_appSettingsCache) return _appSettingsCache;

	try {
		const rows = db.select().from(appSettings).all();
		const settingsMap = new Map(rows.map(r => [r.key, r.value]));
		
		const result: any = {};
		let needsUpdate = false;

		for (const [key, defaultValue] of Object.entries(DEFAULT_APP_SETTINGS)) {
			if (settingsMap.has(key)) {
				result[key] = settingsMap.get(key);
			} else {
				result[key] = defaultValue;
				// Seed missing setting
				db.insert(appSettings).values({ key, value: defaultValue }).run();
				needsUpdate = true;
			}
		}

		_appSettingsCache = result as AppSettings;
		return _appSettingsCache;
	} catch (e) {
		// Fallback for first run/migration
		return DEFAULT_APP_SETTINGS;
	}
}

export const settings: Settings = new Proxy({} as Settings, {
	get(_target, prop) {
		const core = loadCoreSettings();
		if (prop in core) return core[prop as keyof CoreSettings];
		
		const app = loadAppSettings();
		if (prop in app) return app[prop as keyof AppSettings];
		
		return undefined;
	}
});

export function getIgnoredKeywordsList(): string[] {
	const val = settings.IGNORED_KEYWORDS;
	return val.split(',')
		.map((k) => k.trim().toLowerCase())
		.filter(Boolean);
}

export function getAllowedIndexersList(): string[] {
	const val = settings.ALLOWED_INDEXERS;
	return val.split(',')
		.map((a) => a.trim().toLowerCase())
		.filter(Boolean);
}

export function isAuthEnabled(): boolean {
	return Boolean(settings.AUTH_USERNAME && settings.AUTH_PASSWORD);
}

export function isIgdbEnabled(): boolean {
	return Boolean(settings.IGDB_CLIENT_ID && settings.IGDB_CLIENT_SECRET);
}

/**
 * Updates settings. Core settings are not updateable via this function 
 * (they must be changed in .env). App settings are saved to the database.
 */
export function updateSettings(updates: Partial<AppSettings>): void {
	for (const [key, value] of Object.entries(updates)) {
		if (key in DEFAULT_APP_SETTINGS) {
			db.insert(appSettings)
				.values({ key, value, updatedAt: new Date().toISOString() })
				.onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date().toISOString() } })
				.run();
		}
	}
	_appSettingsCache = null; // Invalidate cache
}

export function resetAppSettings(): void {
	updateSettings(DEFAULT_APP_SETTINGS);
}
