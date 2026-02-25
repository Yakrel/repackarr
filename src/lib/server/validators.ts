import { z } from 'zod';

/**
 * Validates and parses an ID parameter from URL params
 * @param id - The ID string to validate
 * @returns Parsed integer ID or null if invalid
 */
export function validateId(id: string | undefined): number | null {
	if (!id) return null;
	const parsed = parseInt(id, 10);
	return isNaN(parsed) || parsed <= 0 ? null : parsed;
}

/**
 * API Response schemas for consistent error handling
 */
export const ApiSuccessSchema = z.object({
	success: z.literal(true),
	message: z.string().optional(),
	data: z.unknown().optional()
});

export const ApiErrorSchema = z.object({
	success: z.literal(false),
	error: z.string()
});

export type ApiSuccess = z.infer<typeof ApiSuccessSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiResponse = ApiSuccess | ApiError;

/**
 * Creates a standardized success response
 */
export function successResponse(message?: string, data?: unknown): ApiSuccess {
	const response: ApiSuccess = { success: true };
	if (message) response.message = message;
	if (data !== undefined) response.data = data;
	return response;
}

/**
 * Creates a standardized error response
 */
export function errorResponse(error: string): ApiError {
	return { success: false, error };
}

/**
 * Validates a magnet URL or info URL
 */
export function validateDownloadUrl(url: string | null | undefined): boolean {
	if (!url) return false;
	const trimmed = url.trim();
	return trimmed.startsWith('magnet:') || trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

/**
 * Retry options for async operations
 */
export interface RetryOptions {
	maxAttempts?: number;
	delayMs?: number;
	backoffMultiplier?: number;
	onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Retries an async operation with exponential backoff
 * @param fn - Async function to retry
 * @param options - Retry configuration
 * @returns Promise that resolves with function result or rejects after all attempts
 */
export async function retryAsync<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {}
): Promise<T> {
	const {
		maxAttempts = 3,
		delayMs = 1000,
		backoffMultiplier = 2,
		onRetry
	} = options;

	let lastError: unknown;
	
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			
			if (attempt < maxAttempts) {
				const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);
				if (onRetry) {
					onRetry(attempt, error);
				}
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}
	
	throw lastError;
}
