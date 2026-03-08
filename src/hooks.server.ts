import { initApp } from '$lib/server/scheduler.js';
import { settings, isAuthEnabled } from '$lib/server/config.js';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { logger, logError } from '$lib/server/logger.js';
import { building } from '$app/environment';
import { timingSafeEqual, createHash } from 'crypto';

function hashCredential(value: string): Buffer {
	return createHash('sha256').update(value).digest();
}

function unauthorizedResponse(message: string): Response {
	return new Response(message, {
		status: 401,
		headers: { 'WWW-Authenticate': 'Basic realm="Repackarr"' }
	});
}

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
			return unauthorizedResponse('Authentication required');
		}

		let decoded: string;
		try {
			decoded = atob(auth.slice(6));
		} catch {
			return unauthorizedResponse('Invalid credentials');
		}

		const separatorIndex = decoded.indexOf(':');
		const username = separatorIndex === -1 ? decoded : decoded.slice(0, separatorIndex);
		const password = separatorIndex === -1 ? '' : decoded.slice(separatorIndex + 1);

		const validUser = timingSafeEqual(hashCredential(username), hashCredential(settings.AUTH_USERNAME));
		const expectedHash = hashCredential(settings.AUTH_PASSWORD);
		const actualHash = hashCredential(password);
		const validPass = timingSafeEqual(expectedHash, actualHash);

		if (!validUser || !validPass) {
			return unauthorizedResponse('Invalid credentials');
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
