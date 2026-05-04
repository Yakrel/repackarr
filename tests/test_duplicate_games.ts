import assert from 'node:assert/strict';
import { findDuplicateGame } from '../src/lib/server/gameDuplicates.js';

const games = [
	{
		id: 1,
		title: 'Nioh 3 Digital Deluxe Edition',
		searchQuery: 'Nioh 3 Digital Deluxe Edition',
		igdbId: 347123,
		steamAppId: 3681010
	},
	{
		id: 2,
		title: 'The Last Of Us Part I',
		searchQuery: 'The Last Of Us Part I',
		igdbId: 204350,
		steamAppId: 1888930
	},
	{
		id: 3,
		title: 'The Last Of Us Part II Remastered',
		searchQuery: 'The Last Of Us Part II Remastered',
		igdbId: 277143,
		steamAppId: 2531310
	},
	{
		id: 4,
		title: 'Five Hearts Under One Roof / Пять Сердец Под Одной Крышей',
		searchQuery: 'Five Hearts Under One Roof',
		igdbId: 318806,
		steamAppId: 3021100
	}
];

assert.equal(
	findDuplicateGame(games, { title: 'nioh 3 digital deluxe edition', searchQuery: 'nioh 3' })?.id,
	1,
	'exact title duplicate should match case-insensitively'
);

assert.equal(
	findDuplicateGame(games, { title: 'Five Hearts Under One Roof', searchQuery: 'five hearts under one roof' })?.id,
	4,
	'search query duplicate should match existing game'
);

assert.equal(
	findDuplicateGame(games, { title: 'Nioh 3', searchQuery: 'Nioh 3' })?.id,
	1,
	'edition suffix duplicate should match base title'
);

assert.equal(
	findDuplicateGame(games, {
		title: 'Some Different Name',
		searchQuery: 'Some Different Name',
		metadata: { name: 'Nioh 3', igdbId: 347123, steamAppId: 3681010 }
	})?.id,
	1,
	'IGDB and Steam IDs should match duplicates'
);

assert.equal(
	findDuplicateGame(games, { title: 'The Last Of Us Part II', searchQuery: 'The Last Of Us Part II' })?.id,
	3,
	'part II should match part II'
);

assert.equal(
	findDuplicateGame(games, { title: 'The Last Of Us Part I', searchQuery: 'The Last Of Us Part I' })?.id,
	2,
	'part I should not match part II'
);

assert.equal(
	findDuplicateGame(games, { title: 'Subnautica', searchQuery: 'Subnautica' }),
	null,
	'unrelated game should not match'
);

console.log('SUCCESS: duplicate game detection verified.');
