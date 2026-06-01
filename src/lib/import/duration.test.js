import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration.js';

describe('parseDuration', () => {
	it('parses plain hour counts', () => {
		expect(parseDuration('1')).toEqual({ minutes: 60, needsReview: false });
		expect(parseDuration('2')).toEqual({ minutes: 120, needsReview: false });
	});

	it('does not guess flexible 1-2 hour formats', () => {
		const result = parseDuration(
			'Tę prelekcję mogę poprowadzić w formacie jedno- jak i dwugodzinnym'
		);
		expect(result.minutes).toBeNull();
		expect(result.needsReview).toBe(true);
	});

	it('does not guess series / kilka formats', () => {
		const result = parseDuration('kilka serii po 10-15minut');
		expect(result.minutes).toBeNull();
		expect(result.needsReview).toBe(true);
	});

	it('parses explicit durations', () => {
		expect(parseDuration('1,5 h')).toEqual({ minutes: 90, needsReview: false });
		expect(parseDuration('45 min')).toEqual({ minutes: 45, needsReview: false });
		expect(parseDuration('jedna godzina')).toEqual({ minutes: 60, needsReview: false });
	});

	it('requires review for empty or unknown text', () => {
		expect(parseDuration('').minutes).toBeNull();
		expect(parseDuration('maybe someday').minutes).toBeNull();
	});
});
