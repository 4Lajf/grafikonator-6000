export {
	expandAvailabilityAnswer,
	extractAvailabilityRanges,
	toIsoDate,
	normalizeTime
} from './availabilityParser.js';

/**
 * @param {Record<string, string>[]} rows
 * @param {string} availabilityColumn
 */
export function collectUniqueAvailabilityValues(rows, availabilityColumn) {
	const values = new Set();
	for (const row of rows) {
		const val = row[availabilityColumn];
		if (val && val.trim()) {
			values.add(val.trim());
		}
	}
	return [...values].sort();
}

function parseLocalDate(dateStr) {
	const [year, month, day] = dateStr.split('-').map(Number);
	return new Date(year, month - 1, day);
}

function formatLocalDate(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
		date.getDate()
	).padStart(2, '0')}`;
}

/**
 * @param {string} startDate
 * @param {string} endDate
 * @param {number} startHour
 * @param {number} endHour
 */
export function buildConventionDays(startDate, endDate, startHour, endHour) {
	const days = [];
	const current = parseLocalDate(startDate);
	const end = parseLocalDate(endDate);

	while (current <= end) {
		const date = formatLocalDate(current);
		days.push({
			date,
			start: `${String(startHour).padStart(2, '0')}:00:00`,
			end: `${String(endHour).padStart(2, '0')}:00:00`
		});
		current.setDate(current.getDate() + 1);
	}

	return days;
}

/**
 * @param {{
 *   startDate: string,
 *   endDate: string,
 *   daySettings?: { date: string, startHour?: number, endHour?: number, start_hour?: number, end_hour?: number }[]
 * }} conventionConfig
 */
export function buildConventionDaysFromConfig(conventionConfig) {
	const baseDays = buildConventionDays(conventionConfig.startDate, conventionConfig.endDate, 8, 22);
	const byDate = new Map(
		(conventionConfig.daySettings || []).map((entry) => [
			entry.date,
			{
				start: `${String(entry.startHour ?? entry.start_hour ?? 8).padStart(2, '0')}:00:00`,
				end: `${String(entry.endHour ?? entry.end_hour ?? 22).padStart(2, '0')}:00:00`
			}
		])
	);
	return baseDays.map((day) => ({
		...day,
		start: byDate.get(day.date)?.start ?? day.start,
		end: byDate.get(day.date)?.end ?? day.end
	}));
}

export { POLISH_MONTHS } from './availabilityParser.js';
