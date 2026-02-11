import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async () => {
	return json({ status: 'ok', version: '2.0.0' });
};
