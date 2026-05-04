import type { GameMetadata } from './types.js';
import { normalizeTitle } from './utils.js';

type DuplicateCandidate = {
	id: number;
	title: string;
	searchQuery: string;
	igdbId: number | null;
	steamAppId: number | null;
};

type DuplicateInput = {
	title: string;
	searchQuery: string;
	metadata?: Pick<GameMetadata, 'igdbId' | 'steamAppId' | 'name'> | null;
};

function normalizedGameKeys(title: string, searchQuery: string): Set<string> {
	return new Set([normalizeTitle(title), normalizeTitle(searchQuery)].filter(Boolean));
}

export function findDuplicateGame<T extends DuplicateCandidate>(
	existingGames: T[],
	input: DuplicateInput
): T | null {
	const inputKeys = normalizedGameKeys(input.title, input.searchQuery);
	const metadataName = input.metadata?.name ? normalizeTitle(input.metadata.name) : '';
	if (metadataName) inputKeys.add(metadataName);

	const metadataIgdbId = input.metadata?.igdbId ?? null;
	const metadataSteamAppId = input.metadata?.steamAppId ?? null;

	return (
		existingGames.find((game) => {
			if (metadataIgdbId && game.igdbId === metadataIgdbId) return true;
			if (metadataSteamAppId && game.steamAppId === metadataSteamAppId) return true;

			const existingKeys = normalizedGameKeys(game.title, game.searchQuery);
			for (const key of inputKeys) {
				if (existingKeys.has(key)) return true;
			}
			return false;
		}) ?? null
	);
}
