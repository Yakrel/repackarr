import { initApp } from '$lib/server/scheduler.js';
import { settings, isAuthEnabled } from '$lib/server/config.js';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { logger, logError } from '$lib/server/logger.js';
import { building } from '$app/environment';
import { timingSafeEqual, createHash } from 'crypto';

// Initialize application on server start
if (!building) {
	try {
		initApp();
	} catch (error) {
		logError('Failed to initialize app', error);
		throw error;
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	// Health check bypass auth
	if (event.url.pathname === '/health') {
		return resolve(event);
	}

	// Check Basic Auth if enabled
	if (isAuthEnabled()) {
		const auth = event.request.headers.get('authorization');

		if (!auth || !auth.startsWith('Basic ')) {
			return new Response('Authentication required', {
				status: 401,
				headers: { 'WWW-Authenticate': 'Basic realm="Repackarr"' }
			});
		}

		const decoded = atob(auth.slice(6));
		const [username, password] = decoded.split(':');

		const validUser = username === settings.AUTH_USERNAME;
		const expectedHash = createHash('sha256').update(settings.AUTH_PASSWORD).digest();
		const actualHash = createHash('sha256').update(password ?? '').digest();
		const validPass = timingSafeEqual(expectedHash, actualHash);

		if (!validUser || !validPass) {
			return new Response('Invalid credentials', {
				status: 401,
				headers: { 'WWW-Authenticate': 'Basic realm="Repackarr"' }
			});
		}
	}

	return resolve(event);
};

export const handleError: HandleServerError = ({ error, event }) => {
	logger.error(`Server error at ${event.url.pathname}:`, error);
	
	return {
		message: 'Internal server error'
	};
};
