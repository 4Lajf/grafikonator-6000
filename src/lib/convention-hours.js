export function normalizeStartHour(value, fallback = 8) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(23, Math.max(0, Math.floor(n)));
}

export function normalizeEndHour(value, fallback = 22) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(24, Math.max(1, Math.floor(n)));
}

export function normalizeHourWindow(startHour, endHour, fallbackStart = 8, fallbackEnd = 22) {
	let start = normalizeStartHour(startHour, fallbackStart);
	let end = normalizeEndHour(endHour, fallbackEnd);
	if (end <= start) {
		end = Math.min(24, start + 1);
	}
	if (end <= start) {
		start = Math.max(0, end - 1);
	}
	return { startHour: start, endHour: end };
}
