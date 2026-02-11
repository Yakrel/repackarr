/**
 * Frontend type definitions for API responses and component data
 */

/**
 * Scan log entry
 */
export interface ScanLog {
	id: number;
	startedAt: string;
	durationSeconds: number;
	gamesProcessed: number;
	updatesFound: number;
	status: 'success' | 'partial_success' | 'failed';
	details?: string;
	skipDetails?: string;
}

/**
 * Scan log details response
 */
export interface ScanLogDetails {
	log: ScanLog;
	details?: {
		total_results_found?: number;
		errors?: string[];
	};
	skipSummary?: Array<{
		game: string;
		game_id: number;
		items: SkipInfo[];
	}>;
}

/**
 * Skip info for a release
 */
export interface SkipInfo {
	gameId: number;
	gameTitle: string;
	title: string;
	date: string;
	reason: string;
	category: string;
	indexer: string;
	isNewerDate: boolean;
	magnetUrl: string | null;
	infoUrl: string | null;
	size: string;
}

/**
 * Action feedback state
 */
export interface ActionFeedback {
	type: 'success' | 'error' | 'loading';
	message: string;
}

/**
 * API response format
 */
export interface ApiResponse<T = unknown> {
	success: boolean;
	message?: string;
	error?: string;
	data?: T;
}
