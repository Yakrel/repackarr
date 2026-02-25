import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { settings } from '$lib/server/config.js';

export const POST: RequestHandler = async () => {
	try {
		if (!settings.IGDB_CLIENT_ID || !settings.IGDB_CLIENT_SECRET) {
			return json({ success: false, message: 'IGDB credentials not configured' });
		}

		// Test IGDB OAuth
		const authResp = await fetch('https://id.twitch.tv/oauth2/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: settings.IGDB_CLIENT_ID,
				client_secret: settings.IGDB_CLIENT_SECRET,
				grant_type: 'client_credentials'
			})
		});

		if (authResp.ok) {
			return json({ success: true, message: 'IGDB connection successful' });
		}

		const error = await authResp.text();
		return json({ success: false, message: `Authentication failed: ${error.slice(0, 50)}` });
	} catch (error) {
		return json({ success: false, message: `Error: ${String(error).slice(0, 100)}` }, { status: 500 });
	}
};
