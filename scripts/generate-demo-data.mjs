import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../src/lib/import/fieldMap.js';
import { parseDuration } from '../src/lib/import/duration.js';
import { buildConventionDays, expandAvailabilityAnswer } from '../src/lib/import/valueMap.js';

const ROOT = process.cwd();
const SUBMISSIONS_PREFIX = 'Zg';
const SCHEDULE_PREFIX = 'Tsukimi';
const OUT_DIR = path.join(ROOT, 'demo-data');
const DEMO_YEAR = 2026;
const DEMO_DAYS = buildConventionDays('2026-09-30', '2026-10-01', 9, 22);

const files = fs.readdirSync(ROOT);
const submissionsPath = files.find((file) => file.startsWith(SUBMISSIONS_PREFIX) && file.endsWith('.csv'));
const schedulePath = files.find((file) => file.startsWith(SCHEDULE_PREFIX) && file.endsWith('.csv'));

if (!submissionsPath || !schedulePath) {
	throw new Error('Could not find source Tsukimi CSV files in the workspace root.');
}

const submissionText = fs.readFileSync(path.join(ROOT, submissionsPath), 'utf8');
const scheduleText = fs.readFileSync(path.join(ROOT, schedulePath), 'utf8');

const { headers: submissionHeaders, rows: submissionRows } = parseCsv(submissionText);
const { headers: scheduleHeaders, rows: scheduleRows } = parseCsv(scheduleText);

fs.mkdirSync(OUT_DIR, { recursive: true });

const presenterMap = new Map();
const titleMap = new Map();
const roomMap = new Map();

const roomNames = [
	'Main Stage',
	'Auditorium',
	'Workshop Room A',
	'Workshop Room B',
	'Panel Room A',
	'Panel Room B',
	'Panel Room C',
	'Game Room',
	'Console Room',
	'Rhythm Room',
	'Community Room',
	'Activity Hall',
	'Open Area'
];

function nextPresenterName(original) {
	const key = normalize(original);
	if (!presenterMap.has(key)) {
		presenterMap.set(key, `Presenter ${String(presenterMap.size + 1).padStart(2, '0')}`);
	}
	return presenterMap.get(key);
}

function nextTitle(original, kind = '') {
	const key = normalize(original);
	if (!titleMap.has(key)) {
		const label = kind && kind !== 'Rodzaj atrakcji' ? kind : 'Program';
		titleMap.set(key, `${label} Demo ${String(titleMap.size + 1).padStart(3, '0')}`);
	}
	return titleMap.get(key);
}

function nextRoomName(original) {
	const key = normalize(original);
	if (!roomMap.has(key)) {
		roomMap.set(key, roomNames[roomMap.size] ?? `Demo Room ${roomMap.size + 1}`);
	}
	return roomMap.get(key);
}

function normalize(value) {
	return String(value ?? '').trim().toLowerCase();
}

function csvEscape(value) {
	const str = String(value ?? '');
	if (/[",\r\n]/.test(str)) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

function writeCsv(filePath, headers, rows) {
	const lines = [
		headers.map(csvEscape).join(','),
		...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))
	];
	fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function findHeader(pattern) {
	return submissionHeaders.find((header) => pattern.test(header));
}

const displayNameHeader = findHeader(/^pseudonim$/i);
const titleHeader = findHeader(/tytuł atrakcji|tytul atrakcji/i);
const kindHeader = findHeader(/rodzaj atrakcji/i);
const durationHeader = findHeader(/czas trwania atrakcji/i);
const participantDescriptionHeader = findHeader(/opis atrakcji dla uczestników/i);
const organizerDescriptionHeader = findHeader(/opis atrakcji dla organizatora/i);
const adultHeader = findHeader(/dorosłych|doroslych/i);
const availabilityHeader = findHeader(/dyspozycyjność|dyspozycyjnosc/i);
const laptopHeader = findHeader(/laptop/i);
const speakerHeader = findHeader(/głośnik|glosnik/i);
const accommodationHeader = findHeader(/nocleg/i);
const notesHeader = findHeader(/uwag/i);
const experienceHeader = findHeader(/doświadczenie|doswiadczenie|referencje/i);
const rodoHeader = findHeader(/rodo|zgod/i);

function stableDuration(raw) {
	const parsed = parseDuration(raw);
	if (!parsed.minutes) return '1';
	if (parsed.minutes % 60 === 0) return String(parsed.minutes / 60);
	return `${parsed.minutes} min`;
}

function anonymizeAvailability(raw) {
	const normalized = String(raw ?? '')
		.replaceAll('2023', String(DEMO_YEAR))
		.replace(/\b30[./]09\b/g, '30/09')
		.replace(/\b01[./]10\b/g, '01/10')
		.trim();

	const expanded = expandAvailabilityAnswer(normalized, DEMO_DAYS);
	if (expanded.unknown || expanded.ranges.length === 0) {
		return 'Pasuje mi przez cały konwent';
	}

	return normalized;
}

function demoTimestamp(index) {
	const day = index < 60 ? '2026-07-01' : '2026-07-02';
	const hour = 10 + Math.floor((index % 30) / 2);
	const minute = (index % 2) * 30;
	return `${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

const seenSubmissions = new Set();
const demoSubmissionRows = [];

for (const row of submissionRows) {
	const originalPresenter = row[displayNameHeader]?.trim();
	const originalTitle = row[titleHeader]?.trim();
	if (!originalPresenter || !originalTitle) continue;
	if (originalPresenter === displayNameHeader || originalTitle === titleHeader) continue;

	const key = `${normalize(originalPresenter)}|${normalize(originalTitle)}`;
	if (seenSubmissions.has(key)) continue;
	seenSubmissions.add(key);

	const demoRow = { ...row };
	const kind =
		row[kindHeader]?.trim() && row[kindHeader]?.trim() !== kindHeader ? row[kindHeader].trim() : 'Program';
	const demoPresenter = nextPresenterName(originalPresenter);
	const demoTitle = nextTitle(originalTitle, kind);

	demoRow['Sygnatura czasowa'] = demoTimestamp(demoSubmissionRows.length);
	demoRow[displayNameHeader] = demoPresenter;
	demoRow[titleHeader] = demoTitle;
	demoRow[kindHeader] = kind;
	demoRow[durationHeader] = stableDuration(row[durationHeader]);
	demoRow[participantDescriptionHeader] =
		`Public demo description for ${demoTitle}. This placeholder preserves event length and category without exposing original content.`;
	demoRow[organizerDescriptionHeader] =
		`Internal demo notes for ${demoTitle}. No private or identifying details are included.`;
	demoRow[adultHeader] = /tak/i.test(row[adultHeader] || '') ? 'tak' : 'nie';
	demoRow[availabilityHeader] = anonymizeAvailability(row[availabilityHeader]);
	demoRow[laptopHeader] = row[laptopHeader] || 'Atrakcja nie wymaga komputera';
	demoRow[speakerHeader] = row[speakerHeader] || 'Atrakcja nie wymaga dźwięku';
	demoRow[accommodationHeader] = row[accommodationHeader] ? 'Nie dotyczy w danych demo' : '';
	demoRow[notesHeader] = 'Demo note: anonymized public sample.';
	demoRow[experienceHeader] = 'Demo experience summary.';
	demoRow[rodoHeader] = 'Wyrażam zgodę';

	demoSubmissionRows.push(demoRow);
}

const demoScheduleRows = [];

for (const row of scheduleRows) {
	if (row.id === 'Id') {
		demoScheduleRows.push(row);
		continue;
	}
	if (!row.id) continue;

	const kind = row.type || row.block || 'Program';
	const demoRow = { ...row };
	demoRow.day = String(row.day || '').replace('2023', String(DEMO_YEAR));
	demoRow.title = nextTitle(row.title, kind);
	demoRow.description = row.description
		? `Public demo schedule description for ${demoRow.title}.`
		: '';
	demoRow.speaker = String(row.speaker || '')
		.split(',')
		.map((name) => nextPresenterName(name.trim()))
		.join(', ');
	demoRow.room = nextRoomName(row.room);
	demoRow.photo_url = '';

	demoScheduleRows.push(demoRow);
}

const submissionsOut = path.join(OUT_DIR, 'demo-submissions-anonymized.csv');
const scheduleOut = path.join(OUT_DIR, 'demo-human-schedule-anonymized.csv');
writeCsv(submissionsOut, submissionHeaders, demoSubmissionRows);
writeCsv(scheduleOut, scheduleHeaders, demoScheduleRows);

const demoRooms = [...new Set(demoScheduleRows.filter((row) => row.id !== 'Id').map((row) => row.room))]
	.filter(Boolean)
	.join('\n');

fs.writeFileSync(
	path.join(OUT_DIR, 'README.md'),
	`# Grafikonator Demo Data

Generated from source-shaped convention data with public-safe anonymized names, titles, descriptions, notes, references, and rooms.

## Files

- \`demo-submissions-anonymized.csv\` - import this as the questionnaire CSV.
- \`demo-human-schedule-anonymized.csv\` - anonymized completed schedule reference.

## Recommended Import Settings

- Name: \`Demo Convention 2026\`
- Start date: \`2026-09-30\`
- End date: \`2026-10-01\`
- Slot size: \`30\`
- Day start: \`00\`
- Day end: \`24\`

## Rooms

Paste these room names into setup:

\`\`\`
${demoRooms}
\`\`\`

Availability dates were normalized to \`30/09\` and \`01/10\`, matching the recommended dates above. The full-day window is intentional: the source-shaped data includes late/overnight availability patterns.
`,
	'utf8'
);

console.log(`Wrote ${path.relative(ROOT, submissionsOut)}`);
console.log(`Wrote ${path.relative(ROOT, scheduleOut)}`);
console.log(`Wrote ${path.relative(ROOT, path.join(OUT_DIR, 'README.md'))}`);
console.log(`Demo submissions: ${demoSubmissionRows.length}`);
console.log(`Demo rooms: ${demoRooms.split('\n').length}`);
