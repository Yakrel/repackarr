import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs/promises';

export const logDir = path.resolve(process.env.LOG_DIR || 'logs');
const LOG_FILE_RETENTION_DAYS = 14;
const LOG_FILE_PATTERN = /^repackarr-(\d{4})-(\d{2})-(\d{2})\.log$/;

const fileTransport = new winston.transports.DailyRotateFile({
	filename: path.join(logDir, 'repackarr-%DATE%.log'),
	datePattern: 'YYYY-MM-DD',
	zippedArchive: false,
	maxSize: '20m',
	maxFiles: '14d',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.errors({ stack: true }),
		winston.format.json()
	)
});

const consoleTransport = new winston.transports.Console({
	format: winston.format.combine(
		winston.format.colorize(),
		winston.format.timestamp({ format: 'HH:mm:ss' }),
		winston.format.errors({ stack: true }),
		winston.format.printf(({ level, message, timestamp, stack }) => {
			if (stack) return `${timestamp} ${level}: ${message}\n${stack}`;
			return `${timestamp} ${level}: ${message}`;
		})
	)
});

export const logger = winston.createLogger({
	level: process.env.LOG_LEVEL || 'debug',
	transports: [
		fileTransport,
		consoleTransport
	]
});

function getLogRetentionCutoff(): Date {
	const cutoff = new Date();
	cutoff.setHours(0, 0, 0, 0);
	cutoff.setDate(cutoff.getDate() - LOG_FILE_RETENTION_DAYS);
	return cutoff;
}

function parseLogFileDate(fileName: string): Date | null {
	const match = LOG_FILE_PATTERN.exec(fileName);
	if (!match) return null;

	const [, year, month, day] = match;
	return new Date(Number(year), Number(month) - 1, Number(day));
}

export async function cleanupOldLogFiles(): Promise<void> {
	let files: string[];
	try {
		files = await fs.readdir(logDir);
	} catch (error) {
		const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : null;
		if (code === 'ENOENT') {
			logger.debug(`Log cleanup skipped because log directory does not exist: ${logDir}`);
			return;
		}
		logError('Failed to read log directory for cleanup', error);
		return;
	}

	const cutoff = getLogRetentionCutoff();
	let removedCount = 0;

	for (const file of files) {
		const fileDate = parseLogFileDate(file);
		if (!fileDate || fileDate >= cutoff) continue;

		const filePath = path.join(logDir, file);
		try {
			const stat = await fs.lstat(filePath);
			if (!stat.isFile()) continue;
			await fs.unlink(filePath);
			removedCount++;
		} catch (error) {
			logError(`Failed to remove old log file ${file}`, error);
		}
	}

	if (removedCount > 0) {
		logger.info(`Cleaned up ${removedCount} old log file(s), keeping last ${LOG_FILE_RETENTION_DAYS} days.`);
	} else {
		logger.debug(`Log file cleanup completed; no files older than ${LOG_FILE_RETENTION_DAYS} days found.`);
	}
}

// Helper to log errors with stack traces cleanly
export function logError(message: string, error: unknown) {
	if (error instanceof Error) {
		logger.error(`${message}: ${error.message}`, { stack: error.stack });
	} else {
		logger.error(`${message}: ${String(error)}`);
	}
}
