import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(__dirname, 'demo.csv');
const raw = fs.readFileSync(csvPath, 'utf8');

const TIER_COLUMN = 'Priorytet atrakcji (Tier 1–3)';

function demoNumber(title) {
	const match = String(title || '').match(/Demo\s+0*(\d+)/i);
	return match ? Number(match[1]) : null;
}

function assignEventTier(title) {
	const n = demoNumber(title);
	if (/Koncert/i.test(title)) return 1;
	if (/Panel/i.test(title)) return 1;
	if (/LARP/i.test(title)) return 1;
	if (n == null) return 2;
	if (n === 17) return 2;
	if ([1, 5, 6, 12, 21, 26, 31, 52, 53, 57, 75].includes(n)) return 1;
	if ([3, 8, 10, 14, 16, 23, 29, 30, 33, 39, 59, 68, 72, 73, 78, 80].includes(n)) return 3;
	return 2;
}

function tweakAvailability(title, availability) {
	let value = String(availability || '');
	value = value.replace(/niedziela \(10\/09\)/gi, 'niedziela (01/10)');

	const n = demoNumber(title);
	if (n === 25) return 'Wolę nie';
	if (n === 4) return 'sobota (30/09) 18:00 - 22:00, niedziela (01/10) 12:00 - 15:00';
	if (n === 13) return 'niedziela (01/10) 9:00 - 12:00, niedziela (01/10) 12:00 - 15:00';
	if (n === 17) return 'Pasuje mi przez cały konwent';

	return value;
}

const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
const rows = parsed.data.filter((row) =>
	Object.values(row).some((v) => String(v || '').trim())
);

const titleKey =
	Object.keys(rows[0] || {}).find((k) => /tytuł|tytul/i.test(k)) || 'Tytuł atrakcji';
const availabilityKey =
	Object.keys(rows[0] || {}).find((k) => /dyspozycyjność|dyspozycyjnosc/i.test(k)) ||
	'Dyspozycyjność (preferowane godziny trwania atrakcji)\n\nZaznaczasz wszystkie, które Ci pasują.';

for (const row of rows) {
	const title = row[titleKey];
	row[TIER_COLUMN] = String(assignEventTier(title));
	if (row[availabilityKey] != null) {
		row[availabilityKey] = tweakAvailability(title, row[availabilityKey]);
	}
}

const orderedHeaders = [...(parsed.meta.fields || Object.keys(rows[0]))];
if (!orderedHeaders.includes(TIER_COLUMN)) {
	const rodoIdx = orderedHeaders.findIndex((h) => /rodo|klauzula/i.test(h));
	if (rodoIdx >= 0) orderedHeaders.splice(rodoIdx, 0, TIER_COLUMN);
	else orderedHeaders.push(TIER_COLUMN);
}

const output = Papa.unparse(rows, { columns: orderedHeaders });
fs.writeFileSync(csvPath, output, 'utf8');

const counts = { 1: 0, 2: 0, 3: 0 };
for (const row of rows) counts[row[TIER_COLUMN]]++;
console.log(`Updated ${rows.length} rows in demo.csv`);
console.log(`Tier distribution: T1=${counts[1]}, T2=${counts[2]}, T3=${counts[3]}`);
