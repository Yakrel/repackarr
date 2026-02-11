import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';

export const logDir = process.env.LOG_DIR || 'logs';

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
	level: process.env.LOG_LEVEL || 'info',
	transports: [
		fileTransport,
		consoleTransport
	]
});

// Helper to log errors with stack traces cleanly
export function logError(message: string, error: unknown) {
	if (error instanceof Error) {
		logger.error(`${message}: ${error.message}`, { stack: error.stack });
	} else {
		logger.error(`${message}: ${String(error)}`);
	}
}
