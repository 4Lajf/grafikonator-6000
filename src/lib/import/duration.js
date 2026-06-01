/**
 * Parse duration strings from Google Forms into minutes.
 * Ambiguous values return minutes: null — user must set duration manually.
 * @param {string} raw
 * @returns {{ minutes: number | null, needsReview: boolean, note?: string }}
 */
export function parseDuration(raw) {
	if (!raw || !String(raw).trim()) {
		return { minutes: null, needsReview: true, note: 'Brak czasu trwania' };
	}

	const text = String(raw).trim().toLowerCase();

	if (/czas trwania|duration|w godzinach/i.test(text)) {
		return { minutes: null, needsReview: true, note: 'Nie rozpoznano czasu trwania' };
	}

	// Ambiguous — user must decide
	if (/jedno.*dwugodzin|format.*jedno|format.*dwu|jedną.*dwie|1-2/i.test(text)) {
		return { minutes: null, needsReview: true, note: 'Format 1–2 h — ustaw ręcznie' };
	}
	if (/kilka|seria|seri[ie]/i.test(text)) {
		return { minutes: null, needsReview: true, note: 'Seria — ustaw łączny czas ręcznie' };
	}

	if (/p[oó]łtor|poltora|1[,.]5\s*godz/i.test(text)) {
		return { minutes: 90, needsReview: false };
	}

	if (/^jedn[aąey]\s*godzin/i.test(text)) {
		return { minutes: 60, needsReview: false };
	}

	if (/^dwie\s*godzin|^dw[aóo]ch?\s*godzin/i.test(text)) {
		return { minutes: 120, needsReview: false };
	}

	if (/^trzy\s*godzin|^trzech\s*godzin/i.test(text)) {
		return { minutes: 180, needsReview: false };
	}

	const commaWithNote = text.match(/(\d+)[,.](\d+)\s*h?\s*\(.*?(\d+)\s*min/);
	if (commaWithNote) {
		return { minutes: parseInt(commaWithNote[3], 10), needsReview: false };
	}

	const commaDecimal = text.match(/(\d+)[,.](\d+)\s*h/);
	if (commaDecimal) {
		const hours = parseFloat(`${commaDecimal[1]}.${commaDecimal[2]}`);
		return { minutes: Math.round(hours * 60), needsReview: false };
	}

	const hoursMatch = text.match(/(\d+(?:[.,]\d+)?)\s*h/);
	if (hoursMatch) {
		const hours = parseFloat(hoursMatch[1].replace(',', '.'));
		return { minutes: Math.round(hours * 60), needsReview: false };
	}

	const minutesMatch = text.match(/(\d+)\s*min/);
	if (minutesMatch) {
		return { minutes: parseInt(minutesMatch[1], 10), needsReview: false };
	}

	const intMatch = text.match(/^(\d+)$/);
	if (intMatch) {
		const val = parseInt(intMatch[1], 10);
		if (val >= 1 && val <= 8) {
			return { minutes: val * 60, needsReview: false };
		}
		return { minutes: null, needsReview: true, note: `Niejasna wartość: „${raw}"` };
	}

	return { minutes: null, needsReview: true, note: `Nie rozpoznano: „${raw}"` };
}

/**
 * @param {string} raw
 * @returns {boolean}
 */
export function parseYesNo(raw) {
	if (!raw) return false;
	const text = String(raw).trim().toLowerCase();
	return /^(tak|yes|true|1|potrzebuję od was|potrzebuje od was)$/i.test(text) || text.includes('tak');
}

/**
 * @param {string} raw
 * @returns {number}
 */
export function parseEventTier(raw) {
	const text = String(raw || '').trim().toLowerCase();
	if (!text) return 2;
	const labeled = text.match(/(?:t(?:ier)?\s*)?([123])/);
	if (labeled) return Number(labeled[1]);
	const n = Number(text);
	if (n === 1 || n === 2 || n === 3) return n;
	return 2;
}

/**
 * @param {string} raw
 * @returns {boolean}
 */
export function parseAutoSchedule(raw) {
	if (raw === undefined || raw === null || String(raw).trim() === '') return true;
	const text = String(raw).trim().toLowerCase();
	if (/^(nie|no|false|0|off|wyłącz|wylacz|ręcznie|recznie|manual|nie planuj)/i.test(text)) {
		return false;
	}
	return true;
}
