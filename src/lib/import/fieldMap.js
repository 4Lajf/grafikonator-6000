import Papa from 'papaparse';

/**
 * @param {Record<string, string>} row
 */
function isEmptyRow(row) {
	return Object.values(row).every((v) => !v || !String(v).trim());
}

/**
 * @param {string} csvText
 * @returns {{ headers: string[], rows: Record<string, string>[] }}
 */
export function parseCsv(csvText) {
	const result = Papa.parse(csvText, {
		header: true,
		skipEmptyLines: true,
		transformHeader: (h) => h.trim()
	});

	if (result.errors.length > 0) {
		const message = result.errors.map((e) => e.message).join('; ');
		throw new Error(`Błąd parsowania CSV: ${message}`);
	}

	const rows = /** @type {Record<string, string>[]} */ (result.data).filter(
		(row) => !isEmptyRow(row)
	);

	return {
		headers: result.meta.fields || [],
		rows
	};
}

/** Columns ignored during import (not shown as mappable fields). */
const SKIP_PATTERNS = [
	/rodo|gdpr|klauzula|privacy|zgod/i,
	/sygnatura czasowa|timestamp|data wysłania|data wyslania|czas wypełnienia/i,
	/^email$|e-mail|adres e-mail/i,
	/nocleg|zakwaterowanie|hotel|accommodation/i,
	/potrzebuj.*laptop|potrzebuj.*głośnik|potrzebuj.*glosnik/i,
	/laptop|głośnik|glosnik|projektor|rzutnik|mikrofon|nagłośnienie|naglosnienie/i,
	/doświadczenie|doswiadczenie|referencje|portfolio|experience/i,
	/inne uwagi|uwagi dodatkowe|miejsce na.*uwag|komentarz|comments|remarks/i,
	/opis atrakcji|opis.*uczestnik|opis.*organizator|streszczenie|abstract|summary/i,
	/rodzaj atrakcji|typ atrakcji|forma atrakcji|kind|category|format/i,
	/treści dla dorosłych|tresci dla doroslych|18\+|nsfw|dla dorosłych|dla doroslych/i,
	/telefon|phone|tel\.|mobile|komórka|komorka/i
];

/** @type {Array<{ field: string, patterns: RegExp[], priority: number }>} */
const FIELD_RULES = [
	{
		field: 'display_name',
		priority: 10,
		patterns: [
			/^pseudonim$/i,
			/nick(name)?|login|handle|alias/i,
			/prowadzący|prowadzacy|prelegent|host|autor/i,
			/^(imię|imie|nazwa)\s*(panelu|osoby|użytkownika|uzytkownika)?$/i,
			/^name$/i,
			/^kto$/i
		]
	},
	{
		field: 'title',
		priority: 10,
		patterns: [
			/tytuł|tytul|tytuł atrakcji|tytul atrakcji/i,
			/nazwa atrakcji|nazwa panelu|nazwa wydarzenia/i,
			/temat|topic|subject/i,
			/^title$/i
		]
	},
	{
		field: 'duration',
		priority: 9,
		patterns: [
			/czas trwania atrakcji|czas trwania|czas\s*\(w godzinach\)|ile godzin/i,
			/długość|dlugosc|duration|length/i,
			/godzin(y)? trwania/i
		]
	},
	{
		field: 'availability',
		priority: 10,
		patterns: [
			/dyspozycyjność|dyspozycyjnosc/i,
			/preferowane godziny|preferred (hours|times)/i,
			/kiedy możesz|kiedy mozesz|when (can you|available)/i,
			/godziny.*(pasuj|dyspozyc)/i,
			/availability|dostępność|dostepnosc/i,
			/termin(y)?/i
		]
	}
];

/**
 * @param {string} header
 */
function shouldSkipHeader(header) {
	return SKIP_PATTERNS.some((pattern) => pattern.test(header));
}

/**
 * Score a header against a field rule.
 * @param {string} header
 * @param {{ field: string, patterns: RegExp[], priority: number }} rule
 */
function scoreHeader(header, rule) {
	const normalized = header.trim().toLowerCase();
	let best = 0;
	for (const pattern of rule.patterns) {
		if (pattern.test(header) || pattern.test(normalized)) {
			best = Math.max(best, rule.priority + (pattern.source.startsWith('^') ? 2 : 0));
		}
	}
	return best;
}

/**
 * @param {string[]} headers
 * @returns {{ mappings: Record<string, string>, unmapped: string[] }}
 */
export function guessFieldMappings(headers) {
	/** @type {Record<string, string>} */
	const mappings = {};
	/** @type {Set<string>} */
	const usedFields = new Set();

	for (const header of headers) {
		if (shouldSkipHeader(header)) {
			mappings[header] = '_skip';
			continue;
		}

		let bestField = null;
		let bestScore = 0;

		for (const rule of FIELD_RULES) {
			if (usedFields.has(rule.field)) continue;
			const score = scoreHeader(header, rule);
			if (score > bestScore) {
				bestScore = score;
				bestField = rule.field;
			}
		}

		if (bestField && bestScore > 0) {
			mappings[header] = bestField;
			usedFields.add(bestField);
		}
	}

	const unmapped = headers.filter((h) => !mappings[h]);
	return { mappings, unmapped };
}

/** @deprecated use guessFieldMappings return value */
export function guessFieldMappingsLegacy(headers) {
	return guessFieldMappings(headers).mappings;
}

export const APP_FIELDS = [
	{ key: 'display_name', label: 'Pseudonim / nazwa' },
	{ key: 'title', label: 'Tytuł atrakcji' },
	{ key: 'duration', label: 'Czas trwania atrakcji' },
	{ key: 'availability', label: 'Dyspozycyjność' },
	{ key: '_skip', label: '(pomiń kolumnę)' }
];
