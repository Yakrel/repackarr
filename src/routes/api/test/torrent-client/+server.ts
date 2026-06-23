import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { settings } from '$lib/server/config.js';
import { torrentClient } from '$lib/server/torrentClient.js';

export const POST: RequestHandler = async () => {
	const isTransmission = !!settings.TRANSMISSION_HOST;
	const host = isTransmission ? settings.TRANSMISSION_HOST : settings.QBIT_HOST;

	if (!host) {
		return json({ success: false, message: 'Torrent client host not set — add it to your .env file' });
	}
	
	try {
		const success = await torrentClient.login();
		if (success) {
			return json({ success: true, message: 'Connection successful' });
		}
		return json({ success: false, message: 'Invalid credentials or connection refused' });
	} catch (error) {
		return json({ success: false, message: 'Network error — is the torrent client reachable at this URL?' }, { status: 500 });
	}
};

