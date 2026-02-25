import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { settings } from '$lib/server/config.js';

export const POST: RequestHandler = async () => {
	if (!settings.PROWLARR_URL) {
		return json({ success: false, message: 'PROWLARR_URL not set — add it to your .env file' });
	}
	if (!settings.PROWLARR_API_KEY) {
		return json({ success: false, message: 'PROWLARR_API_KEY not set — add it to your .env file' });
	}
	try {
		const resp = await fetch(`${settings.PROWLARR_URL}/api/v1/health`, {
			headers: { 'X-Api-Key': settings.PROWLARR_API_KEY }
		});

		if (resp.ok) {
			return json({ success: true, message: 'Connection successful' });
		}
		if (resp.status === 401) {
			return json({ success: false, message: 'Invalid API key' });
		}
		return json({ success: false, message: `HTTP ${resp.status}` });
	} catch {
		return json({ success: false, message: 'Network error — is Prowlarr reachable at this URL?' }, { status: 500 });
	}
};
