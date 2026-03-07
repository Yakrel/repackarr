import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { APP_VERSION } from '$lib/version.js';

export const GET: RequestHandler = async () => {
	return json({ status: 'ok', version: APP_VERSION });
};
