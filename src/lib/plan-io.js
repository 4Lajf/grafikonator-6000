export const PLAN_FORMAT = 'grafikonator-6000-plan';
export const PLAN_VERSION = 1;

const STATE_KEYS = [
	'conventions',
	'people',
	'rooms',
	'events',
	'event_hosts',
	'time_slots',
	'availability',
	'schedules',
	'import_value_mappings'
];

/**
 * @param {Record<string, unknown>} state
 * @param {{ conventionName?: string | null }} [meta]
 */
export function serializePlan(state, meta = {}) {
	/** @type {Record<string, unknown[]>} */
	const data = {};
	for (const key of STATE_KEYS) {
		data[key] = Array.isArray(state?.[key]) ? state[key] : [];
	}

	return {
		format: PLAN_FORMAT,
		version: PLAN_VERSION,
		exportedAt: new Date().toISOString(),
		conventionName: meta.conventionName ?? null,
		data
	};
}

/**
 * @param {unknown} envelope
 */
function extractPlanData(envelope) {
	if (!envelope || typeof envelope !== 'object') {
		throw new Error('Nieprawidłowy plik planu — oczekiwano obiektu JSON.');
	}

	const record = /** @type {Record<string, unknown>} */ (envelope);

	if (record.format === PLAN_FORMAT) {
		const version = Number(record.version);
		if (!Number.isFinite(version) || version > PLAN_VERSION) {
			throw new Error('Nieobsługiwana wersja pliku planu.');
		}
		return normalizePlanData(record.data);
	}

	if (Array.isArray(record.conventions)) {
		return normalizePlanData(record);
	}

	throw new Error('Nie rozpoznano formatu pliku planu.');
}

/**
 * @param {unknown} data
 */
function normalizePlanData(data) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error('Plik planu nie zawiera danych konwentu.');
	}

	const source = /** @type {Record<string, unknown>} */ (data);
	/** @type {Record<string, unknown[]>} */
	const normalized = {};

	for (const key of STATE_KEYS) {
		const value = source[key];
		if (value !== undefined && !Array.isArray(value)) {
			throw new Error(`Pole „${key}” w pliku planu musi być tablicą.`);
		}
		normalized[key] = Array.isArray(value) ? value : [];
	}

	if (normalized.conventions.length === 0) {
		throw new Error('Plik planu nie zawiera żadnego konwentu.');
	}

	return normalized;
}

/**
 * @param {string} jsonString
 */
export function parsePlanJson(jsonString) {
	if (!jsonString?.trim()) {
		throw new Error('Plik planu jest pusty.');
	}

	let parsed;
	try {
		parsed = JSON.parse(jsonString);
	} catch {
		throw new Error('Plik nie zawiera poprawnego JSON.');
	}

	return extractPlanData(parsed);
}

/**
 * @param {Record<string, unknown[]>} data
 */
export function describePlan(data) {
	const convention = data.conventions[0];
	const conventionName =
		convention && typeof convention === 'object' && 'name' in convention
			? String(convention.name || 'Konwent')
			: 'Konwent';

	const peopleCount = data.people.length;
	const eventCount = data.events.length;
	const scheduleCount = data.schedules.length;

	return {
		conventionName,
		peopleCount,
		eventCount,
		scheduleCount,
		conventionCount: data.conventions.length
	};
}

/**
 * @param {string} name
 */
export function buildPlanFilename(name) {
	const slug = String(name || 'plan')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gi, '-')
		.replace(/^-+|-+$/g, '');
	const date = new Date().toISOString().slice(0, 10);
	return `${slug || 'plan'}-${date}.json`;
}
