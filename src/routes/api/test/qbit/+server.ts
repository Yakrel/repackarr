import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { settings } from '$lib/server/config.js';
import { qbitService } from '$lib/server/qbit.js';

export const POST: RequestHandler = async () => {
	if (!settings.QBIT_HOST) {
		return json({ success: false, message: 'QBIT_HOST not set — add it to your .env file' });
	}
	try {
		const resp = await fetch(`${settings.QBIT_HOST}/api/v2/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				username: settings.QBIT_USERNAME,
				password: settings.QBIT_PASSWORD
			})
		});
		if (resp.status === 403) {
			return json({ success: false, message: 'IP banned — too many failed login attempts' });
		}
		const text = await resp.text();
		if (text.trim() === 'Ok.') {
			await qbitService.login(true);
			return json({ success: true, message: 'Connection successful' });
		}
		return json({ success: false, message: 'Invalid username or password' });
	} catch {
		return json({ success: false, message: 'Network error — is qBittorrent reachable at this URL?' }, { status: 500 });
	}
};
