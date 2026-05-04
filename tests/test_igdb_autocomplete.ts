import assert from 'node:assert/strict';
import type { IGDBGame } from '../src/lib/server/types.js';

process.env.IGDB_CLIENT_ID = 'test-client';
process.env.IGDB_CLIENT_SECRET = 'test-secret';

const { buildAutocompleteQuery, rankAutocompleteGames, searchGamesAutocomplete } = await import(
	'../src/lib/server/igdb.js'
);

const subnauticaResults: IGDBGame[] = [
	{
		id: 143025,
		name: 'Subnautica + Subnautica Below Zero Double Pack',
		first_release_date: 1620950400,
		platforms: [48, 6, 167, 49, 130],
		hypes: 1
	},
	{
		id: 107315,
		name: 'Subnautica: Below Zero',
		first_release_date: 1620864000,
		platforms: [169, 48, 508, 6, 167, 14, 49, 130],
		rating_count: 131,
		total_rating_count: 136
	},
	{
		id: 320140,
		name: 'Subnautica 2',
		platforms: [169, 6],
		hypes: 77
	},
	{
		id: 9254,
		name: 'Subnautica',
		first_release_date: 1516665600,
		platforms: [169, 48, 508, 34, 6, 39, 163, 167, 14, 385, 49, 130],
		rating_count: 566,
		total_rating_count: 577,
		external_games: [{ external_game_source: 1, uid: '264710' }]
	}
];

const query = buildAutocompleteQuery('subna', 'Windows');
assert.match(query, /where name ~ \*"subna"\* & platforms = \(6\)/);
assert.match(query, /sort total_rating_count desc/);
assert.doesNotMatch(query, /search "subna"/);

const ranked = rankAutocompleteGames('subna', subnauticaResults);
assert.equal(ranked[0].name, 'Subnautica', 'base game should rank above bundles and sequels');

let igdbRequestBody = '';
let requestCount = 0;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
	requestCount++;
	const target = String(url);
	if (target.includes('oauth2/token')) {
		return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600, token_type: 'bearer' }));
	}

	igdbRequestBody = String(init?.body ?? '');
	return new Response(JSON.stringify([...subnauticaResults, subnauticaResults[3]]));
}) as typeof fetch;

const suggestions = await searchGamesAutocomplete('subna', 'Windows');
assert.equal(suggestions[0].name, 'Subnautica');
assert.equal(suggestions[0].igdbId, 9254);
assert.equal(suggestions[0].year, 2018);
assert.equal(suggestions[0].steamAppId, 264710);
assert.equal(suggestions.filter((suggestion) => suggestion.igdbId === 9254).length, 1);
assert.match(igdbRequestBody, /where name ~ \*"subna"\*/);
assert.equal(requestCount, 2, 'should only call token endpoint and one wildcard IGDB query');

globalThis.fetch = (async (url: string | URL) => {
	if (String(url).includes('oauth2/token')) {
		return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600, token_type: 'bearer' }));
	}
	return new Response('bad request', { status: 400 });
}) as typeof fetch;

const failedSuggestions = await searchGamesAutocomplete('never-cache-this-query', 'Windows');
assert.deepEqual(failedSuggestions, []);

console.log('SUCCESS: IGDB autocomplete verified.');
