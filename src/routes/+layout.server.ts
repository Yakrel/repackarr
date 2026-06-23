import { settings } from '$lib/server/config.js';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async () => {
	return {
		torrentClientType: settings.TRANSMISSION_HOST ? 'Transmission' : 'qBittorrent'
	};
};
