const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

const VERSION_PATTERNS: RegExp[] = [
	/\b(\d+(?:\.\d+){1,6}(?:-[A-Za-z0-9]+){1,4})\b/i,
	/\bv(?:ersion)?\.?\s*(\d+(?:\.\d+){1,4}[a-z]?\d*)/i,
	/\b(\d+(?:\.\d+){1,6})\s*hotfix\b/i,
	/\[(\d+(?:\.\d+){1,4}[a-z]?\d*)\]/i,
	/\((\d+(?:\.\d+){1,4}[a-z]?\d*)(?:\s*(?:\+\s*\d+\s*dlc|\/dlc))?\)/i,
	/\bbuild[\s._-]?(\d{3,10}[a-z]?\d*)\b/i,
	/(?:^|[.\-_\s])b(\d{4,})(?:$|[.\-_\s])/i,
	/\bv(\d{3,10})\b/i,
	/\b(\d{4}\.\d{2}\.\d{2})\b/,
	/\b(\d{2}\.\d{2}\.\d{4})\b/,
	/\b(\d{2}\.\d{2}\.\d{2})\b/
];

const ROMAN_NUMERAL_PATTERN =
	/^(?=[ivxlcdm]+$)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const SHORT_ROMAN_NUMERAL_PATTERN = /^(?=[ivx]+$)x{0,3}(ix|iv|v?i{0,3})$/i;

function romanToNumber(value: string): number | null {
	const normalized = value.trim().toUpperCase();
	if (!normalized || !ROMAN_NUMERAL_PATTERN.test(normalized)) return null;
	const romanValues: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
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
	if (/^\d{4}$/.test(normalized) && !version.includes('.')) {
		const year = parseInt(normalized, 10);
		if (year >= 1900 && year <= 2099) return null;
	}
	return normalized;
}

export function extractVersion(title: string): string | null {
	if (!title?.trim()) return null;
	const cleanTitle = title.trim().replace(URL_PATTERN, ' ');
	const parenthesizedBuild = cleanTitle.match(/\((\d{5,10})\)/);
	if (parenthesizedBuild) return parenthesizedBuild[1];
	const bracketedBuild = cleanTitle.match(/\[(\d{5,10})\]/);
	if (bracketedBuild) return bracketedBuild[1];
	const trailingBuild = cleanTitle.match(/build\s*(\d{5,10})/i);
	if (trailingBuild) return trailingBuild[1];
	for (const pattern of VERSION_PATTERNS) {
		const match = pattern.exec(cleanTitle);
		if (match?.[1]) {
			const normalized = normalizeExtractedVersion(match[1]);
			if (normalized) return normalized;
		}
	}
	return null;
}

export function extractSourceUrl(...fields: Array<string | null | undefined>): string | null {
	for (const field of fields) {
		if (!field?.trim()) continue;
		const match = field.match(/https?:\/\/[^\s<>"'`]+/i);
		if (!match?.[0]) continue;
		return match[0].replace(/[)\].,;!?]+$/, '');
	}
	return null;
}

export function normalizeVersion(version: string): string {
	if (!version) return '';
	return version.replace(/^[vV]\.?\s*/, '').trim();
}

export function compareVersions(v1: string, v2: string): number | null {
	if (!v1 || !v2) return null;
	const v1C = normalizeVersion(v1);
	const v2C = normalizeVersion(v2);
	if (v1C === v2C) return 0;
	try {
		const v1P = v1C.split(/[\.\-]/);
		const v2P = v2C.split(/[\.\-]/);
		const maxLen = Math.max(v1P.length, v2P.length);
		for (let i = 0; i < maxLen; i++) {
			const p1 = v1P[i] || '0';
			const p2 = v2P[i] || '0';
			if (p1 === p2) continue;
			const n1 = parseInt(p1, 10);
			const n2 = parseInt(p2, 10);
			if (!isNaN(n1) && !isNaN(n2)) {
				if (n1 > n2) return 1;
				if (n1 < n2) return -1;
				if (p1.length !== String(n1).length || p2.length !== String(n2).length) {
					return p1.localeCompare(p2, undefined, { numeric: true }) > 0 ? 1 : -1;
				}
			} else {
				return p1.localeCompare(p2, undefined, { numeric: true }) > 0 ? 1 : -1;
			}
		}
		return 0;
	} catch {
		return null;
	}
}

export function estimateVersionConfidence(title: string, version: string | null): number {
	if (!title || !version) return 0;
	let score = 60;
	if (/\bv(?:ersion)?\.?\s*\d/i.test(title)) score += 12;
	if (/\bbuild[\s._-]?\d+/i.test(title)) score += 10;
	if (/^\d+\.\d+\.\d+/.test(version)) score += 8;
	if (/^\d+\.\d+$/.test(version)) score += 5;
	return Math.max(0, Math.min(100, score));
}

export function formatSize(sizeBytes: number): string {
	if (sizeBytes <= 0) return '?';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let size = sizeBytes;
	for (const unit of units) {
		if (size < 1024) return unit === 'B' ? `${Math.round(size)} ${unit}` : `${size.toFixed(1)} ${unit}`;
		size /= 1024;
	}
	return `${size.toFixed(1)} PB`;
}

export function sanitizeSearchQuery(query: string): string {
	if (!query) return '';
	const suffixPatterns = [
		/\s*[-_]?\s*(?:repack|proper|internal|fix|update)/gi,
		/\s*[-_]?\s*(?:gog|steam|egs|epic)/gi,
		/\s*[-_]?\s*build\s*\d+/gi,
		/\s*[-_]?\s*v?\d+(?:\.\d+)*$/gi
	];
	let result = query;
	for (const pattern of suffixPatterns) result = result.replace(pattern, '');
	result = result.replace(/[^\w\s]/g, ' ');
	return result.split(/\s+/).filter(Boolean).join(' ').trim();
}

export function toTitleCaseWords(value: string): string {
	return value.split(' ').map((w) => {
		if (!w) return w;
		// Preserve acronyms like S.T.A.L.K.E.R. fully uppercase
		if (/^[A-Za-z](\.[A-Za-z])+\.?$/.test(w)) return w.toUpperCase();
		const romanToken = w.match(/^([^A-Za-z0-9]*)([A-Za-z]+)([^A-Za-z]*)$/);
		if (romanToken && SHORT_ROMAN_NUMERAL_PATTERN.test(romanToken[2])) {
			return `${romanToken[1]}${romanToken[2].toUpperCase()}${romanToken[3]}`;
		}
		return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
	}).join(' ');
}

export function normalizeTitle(title: string): string {
	if (!title) return '';
	let result = title.toLowerCase().trim();
	const editionPatterns = [
		/\s*[-_:]?\s*digital/gi, /\s*[-_:]?\s*deluxe/gi, /\s*[-_:]?\s*ultimate/gi,
		/\s*[-_:]?\s*complete/gi, /\s*[-_:]?\s*goty/gi, /\s*[-_:]?\s*definitive/gi,
		/\s*[-_:]?\s*enhanced/gi, /\s*[-_:]?\s*remastered/gi, /\s*[-_:]?\s*remake/gi,
		/\s*[-_:]?\s*special/gi, /\s*[-_:]?\s*collector/gi, /\s*[-_:]?\s*premium/gi,
		/\s*[-_:]?\s*gold/gi, /\s*[-_:]?\s*platinum/gi, /\s*[-_:]?\s*anniversary/gi,
		/\s*[-_:]?\s*edition/gi, /\s*[-_:]?\s*version/gi
	];
	for (const pattern of editionPatterns) result = result.replace(pattern, '');
	result = result.replace(/\bpart\s+([ivxlcdm]+|\d+)\b/gi, (_m, partToken: string) => {
		const normalizedPart = normalizePartToken(partToken);
		return normalizedPart ? `part ${normalizedPart}` : `part ${partToken.toLowerCase()}`;
	});
	result = result.replace(/[^\w\s]/g, ' ');
	const tokens = result.split(/\s+/).filter(Boolean);
	const normalizedTokens = tokens.map((token) => {
		if (SHORT_ROMAN_NUMERAL_PATTERN.test(token)) {
			const roman = romanToNumber(token);
			if (roman) return String(roman);
		}
		return token;
	});
	// Deduplicate adjacent identical tokens (e.g. "Diablo II (2)" → "2 2" → "2")
	const deduped: string[] = [];
	for (const t of normalizedTokens) {
		if (t !== deduped[deduped.length - 1]) deduped.push(t);
	}
	return deduped.join(' ').trim();
}

export function fuzzyMatchTitles(title1: string, title2: string): boolean {
	const n1 = normalizeTitle(title1);
	const n2 = normalizeTitle(title2);
	if (!n1 || !n2) return false;
	if (n1 === n2) return true;
	const tokens1 = n1.split(/\s+/).filter(Boolean);
	const tokens2 = n2.split(/\s+/).filter(Boolean);
	const [longer, shorter] = tokens1.length >= tokens2.length ? [tokens1, tokens2] : [tokens2, tokens1];
	if (shorter.length === 1) return shorter[0].length >= 3 && longer.includes(shorter[0]);
	return hasContiguousTokenSequence(longer, shorter);
}

export function cleanGameTitle(title: string): string {
	if (!title) return title;
	const EDITION_SUFFIXES = [
		/\s*[-:]?\s*Digital\s+Deluxe\s+Edition/gi, /\s*[-:]?\s*Deluxe\s+Edition/gi,
		/\s*[-:]?\s*Ultimate\s+Edition/gi, /\s*[-:]?\s*Complete\s+Edition/gi,
		/\s*[-:]?\s*GOTY\s+Edition/gi, /\s*[-:]?\s*Game\s+of\s+the\s+Year\s+Edition/gi,
		/\s*[-:]?\s*Definitive\s+Edition/gi, /\s*[-:]?\s*Enhanced\s+Edition/gi,
		/\s*[-:]?\s*Remastered\s+Edition/gi, /\s*[-:]?\s*Special\s+Edition/gi,
		/\s*[-:]?\s*Collector's\s+Edition/gi, /\s*[-:]?\s*Gold\s+Edition/gi,
		/\s*[-:]?\s*Anniversary\s+Edition/gi, /\s*[-:]?\s*Premium\s+Edition/gi,
		/\s+Edition$/gi
	];
	let cleaned = title;
	for (const pattern of EDITION_SUFFIXES) cleaned = cleaned.replace(pattern, '');
	return cleaned.trim();
}

export const EXCLUDED_TYPES = [
	/\[patch\]/i, /\bpatch\b/i, /русификатор/i, /\[звук\]/i, /\[artbook\]/i, /\bartbook\b/i, /\[other\]/i, /\[utility\]/i,
	/\b(?:soundtrack|ost|lossless|mp3|flac|score|music|remix|arrange|cover|by\s+.*?)\b/i,
	/\b(?:webinar|course|tutorial|guide|guidebook|manual|book|pdf|epub|materials|iso collection|артбук|антология)\b/i,
	/\b(?:bdrip|brrip|webrip|web-?dl|dvdrip|hdrip|blu-?ray|1080p|720p|4k|2160p|h\.?26[45]|x26[45]|mkv|mp4|avi)\b/i,
	/\b(?:official guide|strategy guide|manual|art of)\b/i,
	/\b(?:trailer|teaser|gameplay|геймплей|трейлер|walkthrough|longplay)\b/i,
	/\b(?:anthology|collection|bundle|complete saga)\b/i,
	/\bseries\b.*\bseason\b/i, /\bs\d+e\d+/i, /эпизод.*из/i, /\bonlyfans\b/i
];

export function parseTorrentTitle(rawName: string): string | null {
	if (!rawName) return null;
	let title = rawName.replace(URL_PATTERN, '');
	if (EXCLUDED_TYPES.some((p) => p.test(title))) return null;
	title = title.replace(/\.(zip|rar|7z|iso|exe|torrent|nfo|nsz|nsp)$/i, '');
	if (title.includes('/')) {
		const parts = title.split('/');
		const latinPart = parts.find(p => /[a-zA-Z]{3,}/.test(p));
		if (latinPart) title = latinPart;
	}
	if (/[^\x00-\x7F]/.test(title)) {
		const latinMatch = title.match(/[\[(]([a-zA-Z0-9\s:!&'-]{3,})[\])]/);
		if (latinMatch) title = latinMatch[1];
	}
	const tagPattern = /\[(DL|P|L|RUS|RU|ENG|EN|MULTI\d*|PORTABLE|REPACK|SCENE|GOG|STEAMRIP|LICENSE|P2P|MOD|UPDATE|FIX|HOTFIX|INTERNAL|PROPER|BY\s+.*?)(\s*[+/&]\s*(RUS|RU|ENG|EN|MULTI\d*))*\]/gi;
	title = title.replace(tagPattern, ' ').replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');
	const groupPattern = /[-._\s](?:CODEX|SKIDROW|RELOADED|CPY|FLT|PLAZA|RAZOR1911|HOODLUM|DOGE|RUNE|TiNYiSO|DARKSiDERS|ANOMALY|PROPHET|GOLDBERG|STEAMPUNKS|EMPRESS|DODI|FITGIRL|NECROS|ElAmigos|KaOs|GOG|TENOKE|P2P|insaneramzes|xatab|dixen18|nemos|seleZen|Wanterlude|Let'sРlay|Feniixx|Other\s+s)(?:[-._\s].*)?$/i;
	title = title.replace(groupPattern, '');
	title = title.replace(/[^\x00-\x7F]+/g, ' ').replace(/[._]/g, ' ');
	title = title.replace(/\bpart\s*\d+\b/gi, '')
		.replace(/\s+build\s*\d+\b/gi, '')
		.replace(/\s+[vb]\d{3,10}\b/gi, '')
		.replace(/\s*\+\s*\d+\s*DLC\b/gi, '')
		.replace(/\s+(?:repack|portable|scene|steamrip|license|anniversary|special|digital|deluxe|complete|ultimate|edition|goty|remastered|remake|premium)\b.*$/i, '')
		.replace(/\s*v?\d+(?:\.\d+)+\s*$/i, '');
	title = title.replace(/\b(19|20)\d{2}\b/g, ' ');
	const final = title.trim().replace(/\s+/g, ' ');
	return (final.length < 2 || /^\d+$/.test(final)) ? null : final;
}
