import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const settingsSchema = z.object({
	QBIT_HOST: z.string().url(),
	QBIT_USERNAME: z.string().min(1),
	QBIT_PASSWORD: z.string().min(1),
	QBIT_CATEGORY: z.string().default('games'),
	PROWLARR_URL: z.string().url(),
	PROWLARR_API_KEY: z.string().min(1),
	AUTH_USERNAME: z.string().optional().default(''),
	AUTH_PASSWORD: z.string().optional().default(''),
	CRON_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(360),
	PLATFORM_FILTER: z.string().default('Windows,Linux'),
	IGNORED_KEYWORDS: z.string().default('OST,Soundtrack,Wallpaper,Update Only,Crack Only,PS2,PS3,PS4,PS5,Xbox,Xbox360,Switch,NSW,Nintendo,Wii,WiiU,Console,[NSP],[XCI],Mod,Translation,Patch'),
	ALLOWED_INDEXERS: z.string().default('NoNaMe Club, RuTracker.org'),
	IGDB_CLIENT_ID: z.string().optional().default(''),
	IGDB_CLIENT_SECRET: z.string().optional().default(''),
	DATA_DIR: z.string().default('/app/data')
});

export type Settings = z.infer<typeof settingsSchema>;

let _settings: Settings | null = null;

function loadSettings(): Settings {
	if (_settings) return _settings;

	_settings = settingsSchema.parse({
		QBIT_HOST: process.env.QBIT_HOST,
		QBIT_USERNAME: process.env.QBIT_USERNAME,
		QBIT_PASSWORD: process.env.QBIT_PASSWORD,
		QBIT_CATEGORY: process.env.QBIT_CATEGORY,
		PROWLARR_URL: process.env.PROWLARR_URL,
		PROWLARR_API_KEY: process.env.PROWLARR_API_KEY,
		AUTH_USERNAME: process.env.AUTH_USERNAME,
		AUTH_PASSWORD: process.env.AUTH_PASSWORD,
		CRON_INTERVAL_MINUTES: process.env.CRON_INTERVAL_MINUTES,
		PLATFORM_FILTER: process.env.PLATFORM_FILTER,
		IGNORED_KEYWORDS: process.env.IGNORED_KEYWORDS,
		ALLOWED_INDEXERS: process.env.ALLOWED_INDEXERS,
		IGDB_CLIENT_ID: process.env.IGDB_CLIENT_ID,
		IGDB_CLIENT_SECRET: process.env.IGDB_CLIENT_SECRET,
		DATA_DIR: process.env.DATA_DIR
	});
	return _settings;
}

export const settings: Settings = new Proxy({} as Settings, {
	get(_target, prop) {
		return loadSettings()[prop as keyof Settings];
	},
	set(_target, prop, value) {
		const s = loadSettings();
		(s as Record<string, unknown>)[prop as string] = value;
		return true;
	}
});

export function getIgnoredKeywordsList(s: Settings = loadSettings()): string[] {
	return s.IGNORED_KEYWORDS.split(',')
		.map((k) => k.trim().toLowerCase())
		.filter(Boolean);
}

export function getAllowedIndexersList(s: Settings = loadSettings()): string[] {
	return s.ALLOWED_INDEXERS.split(',')
		.map((a) => a.trim().toLowerCase())
		.filter(Boolean);
}

export function isAuthEnabled(s: Settings = loadSettings()): boolean {
	return Boolean(s.AUTH_USERNAME && s.AUTH_PASSWORD);
}

export function isIgdbEnabled(s: Settings = loadSettings()): boolean {
	return Boolean(s.IGDB_CLIENT_ID && s.IGDB_CLIENT_SECRET);
}

export function updateSettings(updates: Partial<Settings>): void {
	const s = loadSettings();
	Object.assign(s, updates);
}
