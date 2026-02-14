import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { searchGamesAutocomplete } from '$lib/server/igdb.js';

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q') || '';
	const platform = url.searchParams.get('platform') || 'Windows';
	const suggestions = await searchGamesAutocomplete(q, platform);
	return json({ suggestions });
};
