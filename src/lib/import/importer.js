import { parseCsv, guessFieldMappings } from './fieldMap.js';
import { parseDuration, parseYesNo, parseEventTier, parseAutoSchedule } from './duration.js';
import {
	expandAvailabilityAnswer,
	buildConventionDays,
	buildConventionDaysFromConfig,
	collectUniqueAvailabilityValues
} from './valueMap.js';
import { executeImportFromPreview } from '../local-db.js';

export { parseCsv, guessFieldMappings, collectUniqueAvailabilityValues, buildConventionDays };
export { APP_FIELDS } from './fieldMap.js';

const DEFAULT_ROOM_NAMES = [
	'Main Stage',
	'Auditorium',
	'Contest Room',
	'Panel Room A',
	'Panel Room B',
	'Panel Room C',
	'Workshop Room',
	'Small Club Room',
	'Open Corridor Zone',
	'Rhythm Games Zone'
];

/**
 * @param {Record<string, string>} row
 * @param {Record<string, string>} fieldMappings header -> app field
 */
function mapRow(row, fieldMappings) {
	/** @type {Record<string, string>} */
	const mapped = {};
	for (const [header, field] of Object.entries(fieldMappings)) {
		if (field && field !== '_skip' && row[header] !== undefined) {
			mapped[field] = row[header];
		}
	}
	return mapped;
}

function parseInteger(value) {
	const normalized = String(value ?? '').trim().replace(',', '.');
	if (!normalized) return null;
	const match = normalized.match(/\d+/);
	if (!match) return null;
	const parsed = Number(match[0]);
	return Number.isFinite(parsed) ? parsed : null;
}

function parseList(value) {
	return String(value ?? '')
		.split(/[,;\n]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function rowHash(row) {
	const str = JSON.stringify(row);
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash).toString(16).padStart(8, '0');
}

/** Same person + title = duplicate submission (ignores timestamp etc.) */
function submissionKey(displayName, title) {
	return `${displayName.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
}

function dedupeInfoIssues(issues) {
	/** @type {typeof issues} */
	const result = [];
	const seen = new Set();
	for (const issue of issues) {
		if (issue.type !== 'info') {
			result.push(issue);
			continue;
		}
		if (seen.has(issue.message)) continue;
		seen.add(issue.message);
		result.push(issue);
	}
	return result;
}

/**
 * Preview import without writing to storage.
 * @param {object} options
 */
export function previewImport(options) {
	const {
		csvText,
		fieldMappings,
		conventionConfig,
		valueMappings = {},
		roomNames = DEFAULT_ROOM_NAMES
	} = options;

	const { headers, rows } = parseCsv(csvText);
	const guessed = guessFieldMappings(headers);
	const mappings =
		fieldMappings && Object.keys(fieldMappings).length > 0 ? fieldMappings : guessed.mappings;
	const conventionDays = buildConventionDaysFromConfig(conventionConfig);

	/** @type {Map<string, { display_name: string, events: object[] }>} */
	const peopleMap = new Map();
	/** @type {{ type: 'error' | 'warning' | 'info', message: string, row?: number }[]} */
	const issues = [];
	const unknownAvailability = new Set();

	let duplicateHeaderCount = 0;
	let duplicateRowCount = 0;
	const seenSubmissions = new Set();
	let rowNumber = 1; // header is row 0

	// Check which headers we're using
	const displayNameHeader = Object.entries(mappings).find(([, f]) => f === 'display_name')?.[0];
	const titleHeader = Object.entries(mappings).find(([, f]) => f === 'title')?.[0];

	for (const row of rows) {
		rowNumber++;

		const mapped = mapRow(row, mappings);
		const displayName = mapped.display_name?.trim();
		const title = mapped.title?.trim();

		// Detect duplicate header rows (repeated CSV blocks from copy-paste exports)
		if (displayName === displayNameHeader || title === titleHeader) {
			duplicateHeaderCount++;
			continue;
		}

		// Missing required fields
		if (!displayName && !title) {
			issues.push({
				type: 'warning',
				message: `Wiersz ${rowNumber}: brak pseudonimu i tytułu — pominięty`,
				row: rowNumber
			});
			continue;
		}
		if (!displayName) {
			issues.push({
				type: 'warning',
				message: `Wiersz ${rowNumber}: brak pseudonimu (tytuł: „${title}") — pominięty`,
				row: rowNumber
			});
			continue;
		}
		if (!title) {
			issues.push({
				type: 'warning',
				message: `Wiersz ${rowNumber}: brak tytułu atrakcji (osoba: ${displayName}) — pominięty`,
				row: rowNumber
			});
			continue;
		}

		const submission = submissionKey(displayName, title);
		if (seenSubmissions.has(submission)) {
			duplicateRowCount++;
			continue;
		}
		seenSubmissions.add(submission);

		// Parse duration — ambiguous values stay in preview for manual edit
		const duration = parseDuration(mapped.duration || '');
		const needsDurationEdit = duration.minutes === null || duration.needsReview;

		if (!peopleMap.has(displayName)) {
			peopleMap.set(displayName, { display_name: displayName, events: [] });
		}

		const availabilityRaw = mapped.availability || '';
		const expanded = expandAvailabilityAnswer(availabilityRaw, conventionDays, valueMappings);
		if (expanded.unknown && availabilityRaw.trim()) {
			unknownAvailability.add(availabilityRaw.trim());
		}

		peopleMap.get(displayName).events.push({
			title,
			kind: mapped.kind?.trim() || null,
			duration_minutes: duration.minutes,
			duration_raw: mapped.duration?.trim() || '',
			needs_duration_edit: needsDurationEdit,
			description: mapped.description || null,
			organizer_notes: mapped.organizer_notes || null,
			tier: parseEventTier(mapped.event_tier),
			auto_schedule: parseAutoSchedule(mapped.auto_schedule),
			adult_content: parseYesNo(mapped.adult_content),
			needs_laptop: /potrzebuj/i.test(mapped.needs_laptop || ''),
			needs_speakers: /potrzebuj/i.test(mapped.needs_speakers || ''),
			estimated_attendance: parseInteger(mapped.estimated_attendance),
			required_room_tags: [],
			event_tags: [...parseList(mapped.event_tags), ...parseList(mapped.required_room_tags)],
			equipment_needs: parseList(mapped.equipment_needs),
			availability: expanded,
			source_row_hash: rowHash(row)
		});
	}

	const availabilityColumn = Object.entries(mappings).find(([, f]) => f === 'availability')?.[0];

	// Convert to legacy warnings format for compatibility, but keep full issues
	const warnings = dedupeInfoIssues(issues)
		.filter((i) => i.type === 'warning' || i.type === 'error')
		.map((i) => i.message);

	return {
		headers,
		fieldMappings: mappings,
		unmappedHeaders: guessed.unmapped,
		people: [...peopleMap.values()],
		peopleCount: peopleMap.size,
		eventCount: [...peopleMap.values()].reduce((n, p) => n + p.events.length, 0),
		warnings,
		issues: dedupeInfoIssues(issues),
		unknownAvailabilityValues: [...unknownAvailability].filter(Boolean),
		uniqueAvailabilityValues: availabilityColumn
			? collectUniqueAvailabilityValues(rows, availabilityColumn)
			: [],
		suggestedRooms: roomNames,
		conventionDays,
		stats: {
			totalRows: rows.length,
			duplicateHeaders: duplicateHeaderCount,
			duplicateRows: duplicateRowCount,
			processedRows: rows.length - duplicateHeaderCount - duplicateRowCount
		}
	};
}

/** @typedef {ReturnType<typeof previewImport>} PreviewResult */

/**
 * Execute full import into browser storage.
 * Pass `editedPreview` to import user-edited preview data from step 4.
 */
export function executeImport(options) {
	const preview = options.editedPreview ?? previewImport(options);
	validatePreviewForImport(preview);
	return executeImportFromPreview(preview, options);
}

/** @param {PreviewResult} preview */
function validatePreviewForImport(preview) {
	for (const person of preview.people) {
		for (const event of person.events) {
			if (!event.title?.trim()) {
				throw new Error(`Brak tytułu atrakcji dla ${person.display_name}`);
			}
			const mins = Number(event.duration_minutes);
			if (!mins || mins <= 0) {
				throw new Error(
					`Ustaw czas trwania dla „${event.title}" (${person.display_name})`
				);
			}
		}
	}
	if (preview.eventCount === 0) {
		throw new Error('Brak atrakcji do importu');
	}
}
