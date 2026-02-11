import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { settings } from '$lib/server/config.js';

export const POST: RequestHandler = async () => {
	try {
		const resp = await fetch(`${settings.PROWLARR_URL}/api/v1/health`, {
			headers: { 'X-Api-Key': settings.PROWLARR_API_KEY }
		});

		if (resp.ok) {
			return json({ success: true, message: 'Connection successful' });
		}
		return json({ success: false, message: `HTTP ${resp.status}` });
	} catch (error) {
		return json({ success: false, message: `Error: ${String(error).slice(0, 100)}` }, { status: 500 });
	}
};
