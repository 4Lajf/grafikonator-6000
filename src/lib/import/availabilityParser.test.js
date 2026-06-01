import { describe, it, expect } from 'vitest';
import {
	extractAvailabilityRanges,
	expandAvailabilityAnswer,
	normalizeTime,
	toIsoDate
} from './availabilityParser.js';
import { buildConventionDays } from './valueMap.js';
import { guessFieldMappings } from './fieldMap.js';

const CONVENTION_DAYS = [
	{ date: '2023-09-30', start: '09:00:00', end: '22:00:00' },
	{ date: '2023-10-01', start: '09:00:00', end: '22:00:00' }
];

const YEAR = 2023;

function expectRange(ranges, date, start, end) {
	expect(ranges).toEqual(
		expect.arrayContaining([expect.objectContaining({ date, start, end })])
	);
}

describe('normalizeTime', () => {
	it('parses HH:MM and HH.MM', () => {
		expect(normalizeTime('18:00')).toBe('18:00:00');
		expect(normalizeTime('9:5')).toBe('09:05:00');
		expect(normalizeTime('2.30')).toBe('02:30:00');
	});
});

describe('toIsoDate', () => {
	it('builds valid ISO dates', () => {
		expect(toIsoDate(30, 9, 2023)).toBe('2023-09-30');
		expect(toIsoDate(1, 10, 2023)).toBe('2023-10-01');
	});
});

describe('extractAvailabilityRanges — Polish convention formats', () => {
	const cases = [
		{
			name: 'sobota (30/09) 18:00 - 22:00',
			input: 'sobota (30/09) 18:00 - 22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'multiple comma-separated slots',
			input: 'sobota (30/09) 11:00 - 14:00, sobota (30/09) 14:00 - 18:00',
			expect: ['2023-09-30', '11:00:00', '14:00:00']
		},
		{
			name: 'niedziela (01/10) 9:00 - 12:00',
			input: 'niedziela (01/10) 9:00 - 12:00',
			expect: ['2023-10-01', '09:00:00', '12:00:00']
		},
		{
			name: 'nocka overnight',
			input: 'nocka 2:00 - 9:00',
			expect: ['2023-10-01', '02:00:00', '09:00:00']
		},
		{
			name: 'parens date only',
			input: '(30/09) 18:00 - 22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'DD/MM/YYYY',
			input: '30/09/2023 18:00 - 22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'DD.MM.YYYY',
			input: '30.09.2023 18:00-22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'ISO date',
			input: '2023-09-30 18:00 - 22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'od … do …',
			input: 'piątek (29/09) od 14:00 do 18:00',
			expect: ['2023-09-29', '14:00:00', '18:00:00']
		},
		{
			name: 'między … a …',
			input: 'sobota (30/09) między 11:00 a 14:00',
			expect: ['2023-09-30', '11:00:00', '14:00:00']
		},
		{
			name: 'from … to … on (DD/MM)',
			input: 'from 18:00 to 22:00 on (30/09)',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'time on date',
			input: '18:00 - 22:00 on 30/09/2023',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'Polish month name',
			input: '30 września 18:00-22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'day + Polish month',
			input: 'sobota, 30 września, 18:00-22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'compact hours',
			input: '30/09: 18-22',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'cały dzień prefix',
			input: 'cały dzień 30/09',
			expect: ['2023-09-30', '00:00:00', '23:59:00']
		},
		{
			name: 'cały dzień suffix',
			input: '30/09 cały dzień',
			expect: ['2023-09-30', '00:00:00', '23:59:00']
		},
		{
			name: 'dot in parens',
			input: '(30.09.) 18:00–22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'overnight slot',
			input: 'sobota (30/09) 22:00 - 2:00',
			expect: ['2023-09-30', '22:00:00', '23:59:59']
		},
		{
			name: 'godz. prefix',
			input: 'godz. 18:00-22:00 dnia 30.09.2023',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'at-sign compact',
			input: '18-22 @ 30/09',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'between … and …',
			input: 'between 11:00 and 14:00 (30/09)',
			expect: ['2023-09-30', '11:00:00', '14:00:00']
		},
		{
			name: 'dash date pipe',
			input: '30-09-2023 | 18:00-22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'ISO T separator',
			input: '2023-09-30T18:00-22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'day before dotted date',
			input: 'sobota 30.09 18:00-22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'year in parens',
			input: 'sobota (30/09/2023) 18:00 - 22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		},
		{
			name: 'no parens date',
			input: '30/09 18:00 - 22:00',
			expect: ['2023-09-30', '18:00:00', '22:00:00']
		}
	];

	for (const { name, input, expect: [date, start, end] } of cases) {
		it(name, () => {
			const ranges = extractAvailabilityRanges(input, YEAR, CONVENTION_DAYS);
			expect(ranges.length).toBeGreaterThan(0);
			expectRange(ranges, date, start, end);
		});
	}

	it('parses second range from comma-separated list', () => {
		const ranges = extractAvailabilityRanges(
			'sobota (30/09) 11:00 - 14:00, sobota (30/09) 14:00 - 18:00',
			YEAR,
			CONVENTION_DAYS
		);
		expectRange(ranges, '2023-09-30', '14:00:00', '18:00:00');
	});

	it('overnight adds next-day segment', () => {
		const ranges = extractAvailabilityRanges(
			'sobota (30/09) 22:00 - 2:00',
			YEAR,
			CONVENTION_DAYS
		);
		expectRange(ranges, '2023-10-01', '00:00:00', '02:00:00');
	});
});

describe('expandAvailabilityAnswer — tier keywords', () => {
	it('whole convention = tier 1 all days', () => {
		const result = expandAvailabilityAnswer('Pasuje mi przez cały konwent', CONVENTION_DAYS);
		expect(result.tier).toBe(1);
		expect(result.ranges).toHaveLength(2);
	});

	it('rather not = tier 2', () => {
		const result = expandAvailabilityAnswer('Wolę nie, ale w miarę możliwości', CONVENTION_DAYS);
		expect(result.tier).toBe(2);
	});

	it('cannot = tier 3', () => {
		const result = expandAvailabilityAnswer('Nie mogę w ogóle', CONVENTION_DAYS);
		expect(result.tier).toBe(3);
	});
});

describe('buildConventionDays', () => {
	it('keeps configured dates stable in local time zones', () => {
		expect(buildConventionDays('2023-09-30', '2023-10-01', 9, 22).map((day) => day.date)).toEqual([
			'2023-09-30',
			'2023-10-01'
		]);
	});
});

describe('guessFieldMappings — header synonyms', () => {
	it('maps only essential Polish Google Forms headers', () => {
		const headers = [
			'Pseudonim',
			'Tytuł atrakcji',
			'Rodzaj atrakcji',
			'Czas trwania atrakcji (w godzinach)',
			'Opis atrakcji dla uczestników',
			'Opis atrakcji dla organizatora (jeśli czujesz potrzebę dokładniejszego opisu przebiegu)',
			'Czy atrakcja zawiera treści dla dorosłych?',
			'Dyspozycyjność (preferowane godziny trwania atrakcji)',
			'Czy potrzebujesz laptopa?',
			'Czy potrzebujesz głośników?',
			'Czy potrzebujesz noclegu?',
			'Miejsce na wszelkie inne uwagi',
			'Doświadczenie/referencje',
			'Klauzula RODO:'
		];
		const { mappings, unmapped } = guessFieldMappings(headers);
		expect(mappings['Pseudonim']).toBe('display_name');
		expect(mappings['Tytuł atrakcji']).toBe('title');
		expect(mappings['Czas trwania atrakcji (w godzinach)']).toBe('duration');
		expect(mappings['Dyspozycyjność (preferowane godziny trwania atrakcji)']).toBe(
			'availability'
		);
		expect(mappings['Rodzaj atrakcji']).toBe('_skip');
		expect(mappings['Czy potrzebujesz laptopa?']).toBe('_skip');
		expect(mappings['Czy potrzebujesz głośników?']).toBe('_skip');
		expect(mappings['Czy potrzebujesz noclegu?']).toBe('_skip');
		expect(mappings['Doświadczenie/referencje']).toBe('_skip');
		expect(mappings['Klauzula RODO:']).toBe('_skip');
		expect(unmapped).not.toContain('Pseudonim');
	});

	it('auto-skips metadata columns', () => {
		const { mappings } = guessFieldMappings(['Email', 'Pseudonim', 'Sygnatura czasowa']);
		expect(mappings['Email']).toBe('_skip');
		expect(mappings['Pseudonim']).toBe('display_name');
		expect(mappings['Sygnatura czasowa']).toBe('_skip');
	});
});
