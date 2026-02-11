const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

const VERSION_PATTERNS: RegExp[] = [
	/\b(\d+(?:\.\d+){1,6}(?:-[A-Za-z0-9]+){1,4})\b/i,
	/\bv(?:ersion)?\.?\s*(\d+(?:\.\d+){1,4}[a-z]?)/i,
	/\b(\d+(?:\.\d+){1,6})\s*hotfix\b/i,
	/\[(\d+(?:\.\d+){1,4}[a-z]?)\]/i,
	/\((\d+(?:\.\d+){1,4}[a-z]?)(?:\s*(?:\+\s*\d+\s*dlc|\/dlc))?\)/i,
	/\bbuild[\s._-]?(\d{3,8})\b/i,
	/(?:^|[.\-_\s])b(\d{4,})(?:$|[.\-_\s])/i,
	/\bv(\d{3,8})\b/i
];

const ROMAN_NUMERAL_PATTERN =
	/^(?=[ivxlcdm]+$)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const SHORT_ROMAN_NUMERAL_PATTERN = /^(?=[ivx]+$)x{0,3}(ix|iv|v?i{0,3})$/i;

function romanToNumber(value: string): number | null {
	const normalized = value.trim().toUpperCase();
	if (!normalized || !ROMAN_NUMERAL_PATTERN.test(normalized)) return null;

	const romanValues: Record<string, number> = {
		I: 1,
		V: 5,
		X: 10,
		L: 50,
		C: 100,
		D: 500,
		M: 1000
	};

	let total = 0;
	for (let i = 0; i < normalized.length; i++) {
		const current = romanValues[normalized[i]] ?? 0;
		const next = romanValues[normalized[i + 1]] ?? 0;
		total += next > current ? -current : current;
	}

	return total > 0 ? total : null;
}

function normalizePartToken(value: string): string | null {
	if (/^\d+$/.test(value)) {
		const parsed = parseInt(value, 10);
		return parsed > 0 ? String(parsed) : null;
	}

	const roman = romanToNumber(value);
	return roman ? String(roman) : null;
}

function hasContiguousTokenSequence(haystack: string[], needle: string[]): boolean {
	if (needle.length > haystack.length) return false;

	for (let start = 0; start <= haystack.length - needle.length; start++) {
		let isMatch = true;
		for (let i = 0; i < needle.length; i++) {
			if (haystack[start + i] !== needle[i]) {
				isMatch = false;
				break;
			}
		}
		if (isMatch) return true;
	}

	return false;
}

function normalizeExtractedVersion(version: string): string | null {
	if (!version) return null;
	const normalized = version.trim().replace(/\s+/g, '');
	if (!normalized) return null;

	// Avoid treating release year as version when context is weak (e.g. "(2026)")
	if (/^\d{4}$/.test(normalized)) {
		const year = parseInt(normalized, 10);
		if (year >= 1900 && year <= 2099) return null;
	}

	return normalized;
}

/**
 * Extracts version number from a release title
 * @param title - The release title to parse
 * @returns Extracted version string or null if not found
 * @example extractVersion("Game v1.2.3") // returns "1.2.3"
 */
export function extractVersion(title: string): string | null {
	if (!title?.trim()) return null;
	title = title.trim().replace(URL_PATTERN, ' ');

	const slashBlockCandidates: string[] = [];
	const slashBlocks = Array.from(title.matchAll(/\(([^)]*\/[^)]*)\)/gi));
	for (const block of slashBlocks) {
		const content = block[1];
		const parts = content.split('/');
		for (const part of parts) {
			const trimmed = part.trim();
			const hyphenCandidate = trimmed.match(/(\d+(?:\.\d+)+(?:-[A-Za-z0-9]+){1,4})/i)?.[1];
			if (hyphenCandidate) {
				slashBlockCandidates.push(hyphenCandidate);
				continue;
			}

			const dotCandidate = trimmed.match(/(\d+(?:\.\d+){1,6}[a-z]?)/i)?.[1];
			if (dotCandidate) {
				slashBlockCandidates.push(dotCandidate);
				continue;
			}

			const buildCandidate = trimmed.match(/(?:build|b)\s*(\d{3,8})/i)?.[1];
			if (buildCandidate) {
				slashBlockCandidates.push(buildCandidate);
			}
		}
	}

	for (let i = slashBlockCandidates.length - 1; i >= 0; i--) {
		const normalized = normalizeExtractedVersion(slashBlockCandidates[i]);
		if (normalized) return normalized;
	}

	const parenthesizedBuildCandidates = Array.from(title.matchAll(/\((\d{3,8})\)/gi)).map(
		(match) => match[1]
	);
	for (let i = parenthesizedBuildCandidates.length - 1; i >= 0; i--) {
		const normalized = normalizeExtractedVersion(parenthesizedBuildCandidates[i]);
		if (normalized) return normalized;
	}

	for (const pattern of VERSION_PATTERNS) {
		const match = pattern.exec(title);
		if (match?.[1]) {
			const normalized = normalizeExtractedVersion(match[1]);
			if (normalized) return normalized;
		}
	}
	return null;
}

/**
 * Extracts first source URL from provided text fields
 */
export function extractSourceUrl(...fields: Array<string | null | undefined>): string | null {
	for (const field of fields) {
		if (!field?.trim()) continue;
		const match = field.match(/https?:\/\/[^\s<>"'`]+/i);
		if (!match?.[0]) continue;
		return match[0].replace(/[)\].,;!?]+$/, '');
	}

	return null;
}

/**
 * Normalizes version string by removing common prefixes
 * @param version - Version string to normalize
 * @returns Normalized version string
 * @example normalizeVersion("v1.2.3") // returns "1.2.3"
 */
export function normalizeVersion(version: string): string {
	if (!version) return '';
	return version.replace(/^[vV]\.?\s*/, '').trim();
}

/**
 * Compares two version strings
 * @param localVer - Local version string
 * @param remoteVer - Remote version string
 * @returns 1 if remote is newer, -1 if local is newer, 0 if equal, null if comparison failed
 */
export function compareVersions(localVer: string, remoteVer: string): number | null {
	if (!localVer || !remoteVer) return null;

	const local = normalizeVersion(localVer);
	const remote = normalizeVersion(remoteVer);

	try {
		const localParts = local.split('.').map(Number);
		const remoteParts = remote.split('.').map(Number);
		const maxLen = Math.max(localParts.length, remoteParts.length);

		for (let i = 0; i < maxLen; i++) {
			const l = localParts[i] || 0;
			const r = remoteParts[i] || 0;
			if (r > l) return 1;
			if (r < l) return -1;
		}
		return 0;
	} catch {
		return null;
	}
}

/**
 * Estimates reliability of a parsed version from a release title (0-100)
 */
export function estimateVersionConfidence(title: string, version: string | null): number {
	if (!title || !version) return 0;

	let score = 60;
	const titleLower = title.toLowerCase();

	if (/\bv(?:ersion)?\.?\s*\d/i.test(title)) score += 12;
	if (/\bbuild[\s._-]?\d+/i.test(title)) score += 10;
	if (/^\d+\.\d+\.\d+/.test(version)) score += 8;
	if (/^\d+\.\d+$/.test(version)) score += 5;
	if (/[a-z]$/i.test(version)) score -= 4;
	if (/\bearly access\b/i.test(titleLower)) score -= 6;
	if (/\bportable\b/i.test(titleLower)) score -= 3;
	if (/\bseason\s*\d+/i.test(titleLower)) score -= 30;
	if (/\bepisode\b|\bep\.\s*\d+/i.test(titleLower)) score -= 20;

	return Math.max(0, Math.min(100, score));
}

/**
 * Formats byte size to human-readable format
 * @param sizeBytes - Size in bytes
 * @returns Formatted size string (e.g., "1.5 GB")
 */
export function formatSize(sizeBytes: number): string {
	if (sizeBytes <= 0) return '?';

	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let size = sizeBytes;

	for (const unit of units) {
		if (size < 1024) {
			return unit === 'B' ? `${Math.round(size)} ${unit}` : `${size.toFixed(1)} ${unit}`;
		}
		size /= 1024;
	}
	return `${size.toFixed(1)} PB`;
}

/**
 * Sanitizes search query by removing version info and special characters
 * @param query - Search query to sanitize
 * @returns Sanitized query string
 */
export function sanitizeSearchQuery(query: string): string {
	if (!query) return '';

	const suffixPatterns = [
		/\s*[-_]?\s*(?:repack|proper|internal|fix|update)/gi,
		/\s*[-_]?\s*(?:gog|steam|egs|epic)/gi,
		/\s*[-_]?\s*v?\d+(?:\.\d+)*$/gi
	];

	let result = query;
	for (const pattern of suffixPatterns) {
		result = result.replace(pattern, '');
	}

	result = result.replace(/[^\w\s]/g, ' ');
	return result.split(/\s+/).filter(Boolean).join(' ').trim();
}

export function toTitleCaseWords(value: string): string {
	return value
		.split(' ')
		.map((w) => {
			if (!w) return w;

			const romanToken = w.match(/^([^A-Za-z0-9]*)([A-Za-z]+)([^A-Za-z]*)$/);
			if (romanToken && SHORT_ROMAN_NUMERAL_PATTERN.test(romanToken[2])) {
				return `${romanToken[1]}${romanToken[2].toUpperCase()}${romanToken[3]}`;
			}

			return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
		})
		.join(' ');
}

/**
 * Normalizes a title for duplicate detection
 * More lenient than exact matching but preserves core game identity
 * Removes edition info but keeps main title intact
 */
export function normalizeTitle(title: string): string {
	if (!title) return '';

	let result = title.toLowerCase().trim();

	const editionPatterns = [
		/\s*[-_:]?\s*digital/gi,
		/\s*[-_:]?\s*deluxe/gi,
		/\s*[-_:]?\s*ultimate/gi,
		/\s*[-_:]?\s*complete/gi,
		/\s*[-_:]?\s*goty/gi,
		/\s*[-_:]?\s*game\s+of\s+the\s+year/gi,
		/\s*[-_:]?\s*definitive/gi,
		/\s*[-_:]?\s*enhanced/gi,
		/\s*[-_:]?\s*remastered/gi,
		/\s*[-_:]?\s*remake/gi,
		/\s*[-_:]?\s*special/gi,
		/\s*[-_:]?\s*collector['s]*/gi,
		/\s*[-_:]?\s*premium/gi,
		/\s*[-_:]?\s*gold/gi,
		/\s*[-_:]?\s*platinum/gi,
		/\s*[-_:]?\s*anniversary/gi,
		/\s*[-_:]?\s*royal/gi,
		/\s*[-_:]?\s*standard/gi,
		/\s*[-_:]?\s*edition/gi,
		/\s*[-_:]?\s*version/gi
	];

	for (const pattern of editionPatterns) {
		result = result.replace(pattern, '');
	}

	result = result.replace(/\bpart\s+([ivxlcdm]+|\d+)\b/gi, (_m, partToken: string) => {
		const normalizedPart = normalizePartToken(partToken);
		return normalizedPart ? `part ${normalizedPart}` : `part ${partToken.toLowerCase()}`;
	});

	result = result.replace(/[^\w\s]/g, ' ');
	return result.split(/\s+/).filter(Boolean).join(' ').trim();
}

/**
 * Fuzzy match two game titles
 * Returns true if titles are likely the same game
 * Uses normalized comparison with threshold for similarity
 */
export function fuzzyMatchTitles(title1: string, title2: string): boolean {
	const norm1 = normalizeTitle(title1);
	const norm2 = normalizeTitle(title2);
	if (!norm1 || !norm2) return false;

	// Exact match after normalization
	if (norm1 === norm2) return true;

	const part1 = norm1.match(/\bpart\s+(\d+)\b/)?.[1] ?? null;
	const part2 = norm2.match(/\bpart\s+(\d+)\b/)?.[1] ?? null;
	if (part1 && part2 && part1 !== part2) return false;

	const tokens1 = norm1.split(/\s+/).filter(Boolean);
	const tokens2 = norm2.split(/\s+/).filter(Boolean);
	if (!tokens1.length || !tokens2.length) return false;

	const [longer, shorter] =
		tokens1.length >= tokens2.length ? [tokens1, tokens2] : [tokens2, tokens1];

	if (shorter.length === 1) {
		return shorter[0].length >= 3 && longer.includes(shorter[0]);
	}

	if (hasContiguousTokenSequence(longer, shorter)) return true;

	if (shorter.length >= 3) {
		return hasContiguousTokenSequence(longer, shorter.slice(0, shorter.length - 1));
	}

	return false;
}

/**
 * Cleans a game title by removing common edition suffixes
 * Preserves the main title while removing edition-specific text
 * @param title - Game title to clean
 * @returns Cleaned title without edition suffixes
 */
export function cleanGameTitle(title: string): string {
	if (!title) return title;
	
	// Remove edition names but keep main title
	let cleaned = title
		.replace(/\s*[-:]?\s*Digital\s+Deluxe\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Deluxe\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Digital\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Ultimate\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Complete\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*GOTY\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Game\s+of\s+the\s+Year\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Definitive\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Enhanced\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Remastered\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Special\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Collector['']?s?\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Premium\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Gold\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Platinum\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Anniversary\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Royal\s+Edition/gi, '')
		.replace(/\s*[-:]?\s*Standard\s+Edition/gi, '')
		.replace(/\s+Edition$/gi, '');
	
	return cleaned.trim();
}

/**
 * Parses a torrent file name to extract the game title
 * Removes file extensions, release group names, and common metadata
 * @param rawName - Raw torrent file name
 * @returns Parsed game title or null if parsing failed
 */
export function parseTorrentTitle(rawName: string): string | null {
	if (!rawName) return null;

	let title = rawName
		.replace(URL_PATTERN, '')
		.replace(/\.(zip|rar|7z|iso|exe|torrent|nfo)$/i, '')
		.replace(/\[.*?\]/g, '')
		.replace(/\(.*?\)/g, '')
		.replace(/[-._](?:CODEX|SKIDROW|RELOADED|CPY|FLT|PLAZA|RAZOR1911|HOODLUM|DOGE|RUNE|TiNYiSO|DARKSiDERS|ANOMALY|PROPHET|GOLDBERG|STEAMPUNKS|EMPRESS|DODI|FITGIRL|NECROS|ElAmigos|KaOs|GOG|TENOKE|P2P|insaneramzes)(?:[-._].*)?$/i, '')
		.replace(/[-._]([A-Z]{2,15})$/, '');

	// Replace dots/underscores with spaces
	title = title.replace(/[._]/g, ' ');

	// Remove common trailing release metadata
	title = title
		.replace(/\s+[vb]\d{3,8}\b/gi, '')
		.replace(/\s*\+\s*\d+\s*DLC\b/gi, '')
		.replace(/\s+(?:repack|portable|scene|steamrip|license)\b.*$/i, '')
		.replace(/\s*v?\d+(?:\.\d+)+\s*$/i, '');

	return title.trim() || null;
}
