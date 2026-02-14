/**
 * Type definitions for external API responses
 */

/**
 * qBittorrent torrent info response
 */
export interface QBitTorrentInfo {
	name: string;
	hash: string;
	comment?: string;
	size: number;
	progress: number;
	dlspeed: number;
	upspeed: number;
	priority: number;
	num_seeds: number;
	num_leechs: number;
	ratio: number;
	eta: number;
	state: string;
	seq_dl: boolean;
	f_l_piece_prio: boolean;
	category: string;
	tags: string;
	super_seeding: boolean;
	force_start: boolean;
	save_path: string;
	added_on: number;
	completion_on: number;
	tracker: string;
	dl_limit: number;
	up_limit: number;
	downloaded: number;
	uploaded: number;
	downloaded_session: number;
	uploaded_session: number;
	amount_left: number;
	completed: number;
	max_ratio: number;
	max_seeding_time: number;
	ratio_limit: number;
	seeding_time_limit: number;
	seen_complete: number;
	last_seen_complete: number;
	auto_tmm: boolean;
	time_active: number;
	seeding_time: number;
	availability: number;
	magnet_uri: string;
}

/**
 * Prowlarr indexer response
 */
export interface ProwlarrIndexer {
	id: number;
	name: string;
	fields: Array<{
		name: string;
		value: unknown;
	}>;
	implementationName: string;
	implementation: string;
	configContract: string;
	infoLink: string;
	tags: number[];
	indexerUrls: string[];
	legacyUrls: string[];
	definitionName: string;
	description: string;
	encoding: string;
	language: string;
	protocol: string;
	privacy: string;
	capabilities: {
		supportsRss: boolean;
		supportsSearch: boolean;
		supportsRedirect: boolean;
		supportedSearchParameters: string[];
	};
	supportsRss: boolean;
	supportsSearch: boolean;
	enable: boolean;
	redirect: boolean;
	priority: number;
	downloadClientId: number;
	added: string;
}

/**
 * Prowlarr search result item
 */
export interface ProwlarrSearchResult {
	guid: string;
	title: string;
	indexer: string;
	indexerId: number;
	publishDate?: string;
	added?: string;
	ageMinutes?: number;
	age?: number;
	size?: number;
	files?: number;
	grabs?: number;
	indexerFlags?: number;
	categories?: Array<{
		id: number;
		name: string;
	}>;
	downloadUrl?: string;
	magnetUrl?: string;
	infoUrl?: string;
	seeders?: number;
	leechers?: number;
	protocol?: string;
	infoHash?: string;
}

/**
 * IGDB game search response
 */
export interface IGDBGame {
	id: number;
	name: string;
	cover?: {
		id: number;
		url: string;
		image_id: string;
	};
	external_games?: Array<{
		category?: number;
		external_game_source?: number;
		uid?: string;
		url?: string;
	}>;
	first_release_date?: number;
	genres?: Array<{
		id: number;
		name: string;
	}>;
	platforms?: Array<{
		id: number;
		name: string;
	}>;
	summary?: string;
}

/**
 * IGDB OAuth token response
 */
export interface IGDBTokenResponse {
	access_token: string;
	expires_in: number;
	token_type: string;
}

/**
 * Game metadata from IGDB
 */
export interface GameMetadata {
	name: string | undefined;
	igdbId: number | undefined;
	coverUrl: string | undefined;
	steamAppId: number | undefined;
}
