import cron, { type ScheduledTask } from 'node-cron';
import { settings, updateSettings } from './config.js';
import { db, initDatabase } from './database.js';
import { appSettings } from './schema.js';
import { runScanCycle } from './manager.js';
import { logger, logError } from './logger.js';

let cronJob: ScheduledTask | null = null;

function minutesToCron(minutes: number): string {
	if (minutes < 60) return `*/${minutes} * * * *`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	if (remainingMinutes === 0) return `0 */${hours} * * *`;
	return `${remainingMinutes} */${hours} * * *`;
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
	const cronExpression = minutesToCron(settings.CRON_INTERVAL_MINUTES);

	if (cronJob) {
		cronJob.stop();
	}

	cronJob = cron.schedule(cronExpression, () => {
		runScanCycle().catch((error) => logError('Scheduled scan failed', error));
	});

	logger.info(
		`Scheduler started (interval: ${settings.CRON_INTERVAL_MINUTES} min, cron: ${cronExpression})`
	);
}

export function rescheduleJob(minutes: number): void {
	settings.CRON_INTERVAL_MINUTES = minutes;
	startScheduler();
}

export function initApp(): void {
	logger.info(`Starting Repackarr v0.1.0`);

	initDatabase();
	logger.info('Database initialized');

	loadSettingsFromDb();

	startScheduler();
}
