import { settings, updateSettings } from './config.js';
import { db, runMigrations } from './database.js';
import { appSettings } from './schema.js';
import { runScanCycle } from './manager.js';
import { logger, logError } from './logger.js';
import { APP_VERSION_LABEL } from '../version.js';

type SchedulerState = {
	intervalHandle: ReturnType<typeof setInterval> | null;
	currentScan: Promise<void> | null;
	initialized: boolean;
	intervalMinutesOverride: number | null;
	nextRunAt: string | null;
};

const globalScheduler = globalThis as typeof globalThis & {
	__repackarrSchedulerState?: SchedulerState;
};

if (!globalScheduler.__repackarrSchedulerState) {
	globalScheduler.__repackarrSchedulerState = {
		intervalHandle: null,
		currentScan: null,
		initialized: false,
		intervalMinutesOverride: null,
		nextRunAt: null
	};
}

const schedulerState = globalScheduler.__repackarrSchedulerState;

function getIntervalMinutes(): number {
	return schedulerState.intervalMinutesOverride ?? settings.CRON_INTERVAL_MINUTES;
}

function getIntervalMs(): number {
	return getIntervalMinutes() * 60 * 1000;
}

function updateNextRunAt(intervalMs: number): void {
	schedulerState.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
}

async function runScheduledScan(trigger: 'startup' | 'interval'): Promise<void> {
	if (schedulerState.currentScan) {
		logger.warn(`[Scheduler] Skipping ${trigger} scan because another scan is already running.`);
		return;
	}

	logger.info(`[Scheduler] Starting ${trigger} full scan...`);

	const scanPromise = runScanCycle()
		.catch((error) => logError(`[Scheduler] ${trigger} scan failed`, error))
		.finally(() => {
			if (schedulerState.currentScan === scanPromise) {
				schedulerState.currentScan = null;
			}
		});

	schedulerState.currentScan = scanPromise;
	await scanPromise;
}

export function loadSettingsFromDb(): void {
	try {
		const dbSettings = db.select().from(appSettings).all();
		const updates: Record<string, unknown> = {};

		for (const s of dbSettings) {
			if (s.key in settings) {
				const currentValue = settings[s.key as keyof typeof settings];
				if (typeof currentValue === 'number') {
					updates[s.key] = parseInt(s.value, 10);
				} else if (typeof currentValue === 'boolean') {
					updates[s.key] = s.value.toLowerCase() === 'true';
				} else {
					updates[s.key] = s.value;
				}
			}
		}

		if (Object.keys(updates).length > 0) {
			updateSettings(updates);
			logger.info(`Loaded ${Object.keys(updates).length} setting(s) from DB`);
		}
	} catch (error) {
		logError('Failed to load settings from DB', error);
	}
}

export function startScheduler(): void {
	const intervalMinutes = getIntervalMinutes();
	const intervalMs = getIntervalMs();

	if (schedulerState.intervalHandle) {
		clearInterval(schedulerState.intervalHandle);
	}

	updateNextRunAt(intervalMs);
	schedulerState.intervalHandle = setInterval(() => {
		updateNextRunAt(intervalMs);
		void runScheduledScan('interval');
	}, intervalMs);

	logger.info(
		`Scheduler started (interval: ${intervalMinutes} min, startup scan: enabled, next run at: ${schedulerState.nextRunAt})`
	);
}

export function rescheduleJob(minutes: number): void {
	schedulerState.intervalMinutesOverride = minutes;
	startScheduler();
}

export function initApp(): void {
	if (schedulerState.initialized) {
		return;
	}

	logger.info(`Starting Repackarr ${APP_VERSION_LABEL}`);

	runMigrations();

	loadSettingsFromDb();

	startScheduler();
	schedulerState.initialized = true;
	void runScheduledScan('startup');
}
