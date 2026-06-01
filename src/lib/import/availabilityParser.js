import { parse, isValid } from 'date-fns';

/** @typedef {{ date: string, start: string, end: string }} TimeRange */

const POLISH_DAY_PATTERN =
	'(?:poniedziałek|poniedzialek|pon\\.?|wtorek|wt\\.?|środa|sroda|śr\\.?|sr\\.?|czwartek|czw\\.?|piątek|piatek|pt\\.?|sobota|sob\\.?|niedziela|nd\\.?|nocka)';

const POLISH_MONTHS = {
	stycznia: 1,
	styczen: 1,
	lutego: 2,
	luty: 2,
	marca: 3,
	marzec: 3,
	kwietnia: 4,
	kwiecien: 4,
	maja: 5,
	maj: 5,
	czerwca: 6,
	czerwiec: 6,
	lipca: 7,
	lipiec: 7,
	sierpnia: 8,
	sierpien: 8,
	września: 9,
	wrzesnia: 9,
	wrzesien: 9,
	października: 10,
	pazdziernika: 10,
	pazdziernik: 10,
	listopada: 11,
	listopad: 11,
	grudnia: 12,
	grudzien: 12
};

const DATE_FNS_FORMATS = [
	'dd/MM/yyyy HH:mm',
	'dd.MM.yyyy HH:mm',
	'yyyy-MM-dd HH:mm',
	'dd-MM-yyyy HH:mm',
	'dd/MM/yyyy',
	'dd.MM.yyyy',
	'yyyy-MM-dd',
	"dd MMM yyyy HH:mm",
	'HH:mm dd/MM/yyyy'
];

/**
 * @param {number} day
 * @param {number} month
 * @param {number} year
 */
export function toIsoDate(day, month, year) {
	const d = new Date(year, month - 1, day);
	if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
		return null;
	}
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * @param {string} time
 */
export function normalizeTime(time) {
	const cleaned = time.trim().replace(/\./g, ':');
	const match = cleaned.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
	if (!match) return null;
	const h = match[1].padStart(2, '0');
	const m = (match[2] || '00').padStart(2, '0');
	if (parseInt(h, 10) > 23 || parseInt(m, 10) > 59) return null;
	return `${h}:${m}:00`;
}

/**
 * @param {{ date: string, start: string, end: string }} range
 */
function rangeKey(range) {
	return `${range.date}|${range.start}|${range.end}`;
}

/**
 * @param {TimeRange[]} ranges
 */
function dedupeRanges(ranges) {
	const seen = new Set();
	return ranges.filter((r) => {
		const key = rangeKey(r);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * @param {string} start
 * @param {string} end
 * @param {string} date
 * @param {number} defaultYear
 * @param {{ date: string }[]} conventionDays
 */
function finalizeRange(dateParts, startRaw, endRaw, defaultYear, conventionDays) {
	let day;
	let month;
	let year = defaultYear;

	if (typeof dateParts === 'string') {
		return null;
	}

	if (dateParts.isoDate) {
		day = parseInt(dateParts.isoDate.slice(8, 10), 10);
		month = parseInt(dateParts.isoDate.slice(5, 7), 10);
		year = parseInt(dateParts.isoDate.slice(0, 4), 10);
	} else {
		day = dateParts.day;
		month = dateParts.month;
		if (dateParts.year) year = dateParts.year;
	}

	const start = normalizeTime(startRaw);
	let end = normalizeTime(endRaw);
	if (!start || !end) return [];

	const isoDate = toIsoDate(day, month, year);
	if (!isoDate) return [];

	/** @type {TimeRange[]} */
	const result = [];

	if (end <= start && end !== '00:00:00') {
		result.push({ date: isoDate, start, end: '23:59:59' });
		const nextDay = addDays(isoDate, 1);
		if (nextDay) {
			result.push({ date: nextDay, start: '00:00:00', end });
		}
		return result;
	}

	result.push({ date: isoDate, start, end });
	return result;
}

/**
 * @param {string} isoDate
 * @param {number} days
 */
function addDays(isoDate, days) {
	const d = new Date(isoDate + 'T12:00:00');
	d.setDate(d.getDate() + days);
	return d.toISOString().split('T')[0];
}

/**
 * @param {{ date: string }[]} conventionDays
 */
function inferYear(conventionDays) {
	if (conventionDays.length > 0) {
		return parseInt(conventionDays[0].date.slice(0, 4), 10);
	}
	return new Date().getFullYear();
}

/**
 * @param {string} text
 * @param {number} defaultYear
 */
function resolveNockaDate(text, defaultYear, conventionDays) {
	if (/nocka/i.test(text) && conventionDays.length > 0) {
		return conventionDays[conventionDays.length - 1].date;
	}
	return null;
}

/**
 * @param {string} fragment
 * @param {number} defaultYear
 */
function tryDateFnsParse(fragment, defaultYear) {
	for (const fmt of DATE_FNS_FORMATS) {
		try {
			const parsed = parse(fragment.trim(), fmt, new Date(defaultYear, 0, 1));
			if (isValid(parsed)) {
				return {
					isoDate: parsed.toISOString().split('T')[0],
					hour: parsed.getHours(),
					minute: parsed.getMinutes()
				};
			}
		} catch {
			// try next format
		}
	}
	return null;
}

/**
 * @param {string} text
 * @param {number} defaultYear
 * @param {{ date: string }[]} conventionDays
 * @returns {TimeRange[]}
 */
export function extractAvailabilityRanges(text, defaultYear, conventionDays = []) {
	if (!text?.trim()) return [];

	/** @type {TimeRange[]} */
	let ranges = [];

	const nockaDate = resolveNockaDate(text, defaultYear, conventionDays);

	/** @type {Array<{ regex: RegExp, handler: (m: RegExpMatchArray) => TimeRange[] | null }>} */
	const patterns = [
		// sobota (30/09) 18:00 - 22:00
		{
			regex: new RegExp(
				`${POLISH_DAY_PATTERN}?\\s*\\((\\d{1,2})\\/(\\d{1,2})\\)\\s*(\\d{1,2}[:.]\\d{2})\\s*[-–—]\\s*(\\d{1,2}[:.]\\d{2})`,
				'gi'
			),
			handler: (m) =>
				finalizeRange({ day: +m[1], month: +m[2] }, m[3], m[4], defaultYear, conventionDays)
		},
		// sobota (30/09/2023) 18:00 - 22:00
		{
			regex: new RegExp(
				`${POLISH_DAY_PATTERN}?\\s*\\((\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{4}))?\\)\\s*(\\d{1,2}[:.]\\d{2})\\s*[-–—]\\s*(\\d{1,2}[:.]\\d{2})`,
				'gi'
			),
			handler: (m) =>
				finalizeRange(
					{ day: +m[1], month: +m[2], year: m[3] ? +m[3] : defaultYear },
					m[4],
					m[5],
					defaultYear,
					conventionDays
				)
		},
		// sobota 30.09 18:00-22:00 or sobota 30/09 18:00 - 22:00
		{
			regex: new RegExp(
				`${POLISH_DAY_PATTERN}\\s+(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{4}))?\\s*(\\d{1,2}[:.]\\d{2})\\s*[-–—]\\s*(\\d{1,2}[:.]\\d{2})`,
				'gi'
			),
			handler: (m) =>
				finalizeRange(
					{ day: +m[1], month: +m[2], year: m[3] ? +m[3] : defaultYear },
					m[4],
					m[5],
					defaultYear,
					conventionDays
				)
		},
		// (30/09) 18:00 - 22:00
		{
			regex: /\((\d{1,2})\/(\d{1,2})\)\s*(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/gi,
			handler: (m) =>
				finalizeRange({ day: +m[1], month: +m[2] }, m[3], m[4], defaultYear, conventionDays)
		},
		// 30/09/2023 18:00 - 22:00
		{
			regex: /(\d{1,2})[./](\d{1,2})[./](\d{4})\s+(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/gi,
			handler: (m) =>
				finalizeRange({ day: +m[1], month: +m[2], year: +m[3] }, m[4], m[5], defaultYear, conventionDays)
		},
		// 30.09.2023 18:00-22:00
		{
			regex: /(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/gi,
			handler: (m) =>
				finalizeRange({ day: +m[1], month: +m[2], year: +m[3] }, m[4], m[5], defaultYear, conventionDays)
		},
		// 2023-09-30 18:00 - 22:00
		{
			regex: /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/gi,
			handler: (m) =>
				finalizeRange(
					{ day: +m[3], month: +m[2], year: +m[1] },
					m[4],
					m[5],
					defaultYear,
					conventionDays
				)
		},
		// 30/09 18:00 - 22:00 (no parens)
		{
			regex: /(?:^|[,\s])(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\s+(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/gi,
			handler: (m) =>
				finalizeRange(
					{ day: +m[1], month: +m[2], year: m[3] ? +m[3] : defaultYear },
					m[4],
					m[5],
					defaultYear,
					conventionDays
				)
		},
		// piątek (29/09) od 14:00 do 18:00
		{
			regex: new RegExp(
				`${POLISH_DAY_PATTERN}?\\s*\\((\\d{1,2})\\/(\\d{1,2})\\)\\s*od\\s*(\\d{1,2}[:.]\\d{2})\\s*do\\s*(\\d{1,2}[:.]\\d{2})`,
				'gi'
			),
			handler: (m) =>
				finalizeRange({ day: +m[1], month: +m[2] }, m[3], m[4], defaultYear, conventionDays)
		},
		// sobota (30/09) między 11:00 a 14:00
		{
			regex: new RegExp(
				`${POLISH_DAY_PATTERN}?\\s*\\((\\d{1,2})\\/(\\d{1,2})\\)\\s*(?:między|miedzy)\\s*(\\d{1,2}[:.]\\d{2})\\s*(?:a|and)\\s*(\\d{1,2}[:.]\\d{2})`,
				'gi'
			),
			handler: (m) =>
				finalizeRange({ day: +m[1], month: +m[2] }, m[3], m[4], defaultYear, conventionDays)
		},
		// from 18:00 to 22:00 on (30/09)
		{
			regex: /(?:from|od)\s*(\d{1,2}[:.]\d{2})\s*(?:to|do)\s*(\d{1,2}[:.]\d{2})\s*(?:on|w|dnia)?\s*\((\d{1,2})\/(\d{1,2})\)/gi,
			handler: (m) =>
				finalizeRange({ day: +m[3], month: +m[4] }, m[1], m[2], defaultYear, conventionDays)
		},
		// 18:00 - 22:00 on 30/09/2023
		{
			regex: /(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})\s*(?:on|w|dnia)\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?/gi,
			handler: (m) =>
				finalizeRange(
					{ day: +m[3], month: +m[4], year: m[5] ? +m[5] : defaultYear },
					m[1],
					m[2],
					defaultYear,
					conventionDays
				)
		},
		// nocka 2:00 - 9:00
		{
			regex: /nocka\s*(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/gi,
			handler: (m) => {
				if (!nockaDate) return [];
				return finalizeRange({ isoDate: nockaDate }, m[1], m[2], defaultYear, conventionDays);
			}
		},
		// 30 września 18:00-22:00
		{
			regex: new RegExp(
				`(\\d{1,2})\\s+(${Object.keys(POLISH_MONTHS).join('|')})\\s*(\\d{4})?\\s*(\\d{1,2}[:.]\\d{2})\\s*[-–—]\\s*(\\d{1,2}[:.]\\d{2})`,
				'gi'
			),
			handler: (m) => {
				const month = POLISH_MONTHS[m[2].toLowerCase()];
				if (!month) return [];
				return finalizeRange(
					{ day: +m[1], month, year: m[3] ? +m[3] : defaultYear },
					m[4],
					m[5],
					defaultYear,
					conventionDays
				);
			}
		},
		// sobota, 30 września, 18:00-22:00
		{
			regex: new RegExp(
				`${POLISH_DAY_PATTERN}\\s*,?\\s*(\\d{1,2})\\s+(${Object.keys(POLISH_MONTHS).join('|')})\\s*,?\\s*(\\d{1,2}[:.]\\d{2})\\s*[-–—]\\s*(\\d{1,2}[:.]\\d{2})`,
				'gi'
			),
			handler: (m) => {
				const month = POLISH_MONTHS[m[2].toLowerCase()];
				if (!month) return [];
				return finalizeRange({ day: +m[1], month }, m[3], m[4], defaultYear, conventionDays);
			}
		},
		// 30/09: 18-22 (hours without minutes)
		{
			regex: /(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\s*:\s*(\d{1,2})\s*[-–—]\s*(\d{1,2})(?!\d)/gi,
			handler: (m) =>
				finalizeRange(
					{ day: +m[1], month: +m[2], year: m[3] ? +m[3] : defaultYear },
					`${m[4]}:00`,
					`${m[5]}:00`,
					defaultYear,
					conventionDays
				)
		},
		// cały dzień 30/09 or 30/09 cały dzień
		{
			regex: /(?:cały dzień|caly dzien|all day)\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?|(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\s*(?:cały dzień|caly dzien|all day)/gi,
			handler: (m) => {
				const day = m[1] ? +m[1] : +m[4];
				const month = m[2] ? +m[2] : +m[5];
				const year = m[3] ? +m[3] : m[6] ? +m[6] : defaultYear;
				return finalizeRange({ day, month, year }, '00:00', '23:59', defaultYear, conventionDays);
			}
		},
		// Sat 30/09 6pm-10pm (English day abbrev)
		{
			regex: /(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+(\d{1,2})[./](\d{1,2})\s+(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(pm|am)?/gi,
			handler: (m) => {
				let startH = parseInt(m[3], 10);
				let endH = parseInt(m[5], 10);
				if (m[7]?.toLowerCase() === 'pm' && endH < 12) endH += 12;
				return finalizeRange(
					{ day: +m[1], month: +m[2] },
					`${startH}:${m[4] || '00'}`,
					`${endH}:${m[6] || '00'}`,
					defaultYear,
					conventionDays
				);
			}
		},
		// ISO-ish: 2023-09-30T18:00-22:00
		{
			regex: /(\d{4})-(\d{2})-(\d{2})T(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/gi,
			handler: (m) =>
				finalizeRange(
					{ day: +m[3], month: +m[2], year: +m[1] },
					m[4],
					m[5],
					defaultYear,
					conventionDays
				)
		},
		// (30.09.) 18:00–22:00 with trailing dot
		{
			regex: /\((\d{1,2})\.(\d{1,2})\.?\)\s*(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/gi,
			handler: (m) =>
				finalizeRange({ day: +m[1], month: +m[2] }, m[3], m[4], defaultYear, conventionDays)
		},
		// sobota (30/09) 22:00 - 2:00 overnight
		{
			regex: new RegExp(
				`${POLISH_DAY_PATTERN}?\\s*\\((\\d{1,2})\\/(\\d{1,2})\\)\\s*(\\d{1,2}[:.]\\d{2})\\s*[-–—]\\s*(\\d{1,2}[:.]\\d{2})\\s*(?:\\+1|następnego dnia|next day)?`,
				'gi'
			),
			handler: (m) =>
				finalizeRange({ day: +m[1], month: +m[2] }, m[3], m[4], defaultYear, conventionDays)
		},
		// godz. 18:00-22:00 dnia 30.09.2023
		{
			regex: /godz\.?\s*(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})\s*(?:dnia|d\.?)\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?/gi,
			handler: (m) =>
				finalizeRange(
					{ day: +m[3], month: +m[4], year: m[5] ? +m[5] : defaultYear },
					m[1],
					m[2],
					defaultYear,
					conventionDays
				)
		},
		// 18-22 @ 30/09 (compact)
		{
			regex: /(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*@\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?/gi,
			handler: (m) =>
				finalizeRange(
					{ day: +m[3], month: +m[4], year: m[5] ? +m[5] : defaultYear },
					`${m[1]}:00`,
					`${m[2]}:00`,
					defaultYear,
					conventionDays
				)
		},
		// between 11:00 and 14:00 (30/09)
		{
			regex: /(?:between|pomiędzy|pomiedzy)\s*(\d{1,2}[:.]\d{2})\s*(?:and|a|oraz|-)\s*(\d{1,2}[:.]\d{2})\s*\((\d{1,2})\/(\d{1,2})\)/gi,
			handler: (m) =>
				finalizeRange({ day: +m[3], month: +m[4] }, m[1], m[2], defaultYear, conventionDays)
		},
		// 30-09-2023 | 18:00-22:00
		{
			regex: /(\d{1,2})-(\d{1,2})-(\d{4})\s*[|/\\]\s*(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/gi,
			handler: (m) =>
				finalizeRange({ day: +m[1], month: +m[2], year: +m[3] }, m[4], m[5], defaultYear, conventionDays)
		}
	];

	for (const { regex, handler } of patterns) {
		regex.lastIndex = 0;
		let match;
		while ((match = regex.exec(text)) !== null) {
			const extracted = handler(match);
			if (extracted?.length) {
				ranges.push(...extracted);
			}
		}
	}

	// date-fns fallback on comma-separated fragments
	if (ranges.length === 0) {
		const fragments = text.split(/[,;|]/).map((f) => f.trim()).filter(Boolean);
		for (const fragment of fragments) {
			const parsed = tryDateFnsParse(fragment, defaultYear);
			if (parsed) {
				const timeMatch = fragment.match(/(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/);
				if (timeMatch) {
					ranges.push(
						...finalizeRange(
							{ isoDate: parsed.isoDate },
							timeMatch[1],
							timeMatch[2],
							defaultYear,
							conventionDays
						)
					);
				}
			}
		}
	}

	return dedupeRanges(ranges);
}

/**
 * @param {string} answer
 * @param {{ date: string, start: string, end: string }[]} conventionDays
 * @param {Record<string, { date: string, start: string, end: string }[]>} customMappings
 */
export function expandAvailabilityAnswer(answer, conventionDays, customMappings = {}) {
	if (!answer || !String(answer).trim()) {
		return { ranges: [], tier: 3, unknown: true };
	}

	const trimmed = String(answer).trim();

	if (customMappings[trimmed]) {
		return { ranges: customMappings[trimmed], tier: 1 };
	}

	if (/pasuje mi przez cały konwent|cały konwent|whole convention|any time|zawsze/i.test(trimmed)) {
		return { ranges: conventionDays, tier: 1 };
	}

	if (/wolę|wole|rather not|w miarę możliwości|preferably not/i.test(trimmed)) {
		return { ranges: conventionDays, tier: 2 };
	}

	if (/nie mogę|nie moge|cannot|unavailable|niedostępn|niedostepn|w ogóle nie/i.test(trimmed)) {
		return { ranges: [], tier: 3 };
	}

	const defaultYear = inferYear(conventionDays);
	const ranges = extractAvailabilityRanges(trimmed, defaultYear, conventionDays);

	if (ranges.length === 0) {
		return { ranges: [], tier: 1, unknown: true };
	}

	return { ranges, tier: 1 };
}

export { POLISH_MONTHS, DATE_FNS_FORMATS };
