import { describe, expect, it } from 'vitest';
import {
	DEFAULT_ROOM_PREFERENCE_TIER,
	buildPeopleAutoSchedulePlan,
	getRoomPreferenceTier,
	roomPreferenceSeverity
} from './people-scheduler.js';

function makeRoom(name, tags = []) {
	return { id: name, name, capabilities: { tags } };
}

describe('getRoomPreferenceTier', () => {
	it('defaults an unset station preference to tier 2 ("tylko w razie potrzeby")', () => {
		const person = { tag_preferences: {} };
		expect(getRoomPreferenceTier(person, makeRoom('Planszówki'))).toBe(2);
		expect(DEFAULT_ROOM_PREFERENCE_TIER).toBe(2);
	});

	it('defaults to tier 2 when the person has other preferences but none for this station', () => {
		const person = { tag_preferences: { Opedy: 1, Naganiacz: 3 } };
		expect(getRoomPreferenceTier(person, makeRoom('Planszówki'))).toBe(2);
	});

	it('returns tier 1 (chcę) when explicitly wanted', () => {
		const person = { tag_preferences: { Opedy: 1 } };
		expect(getRoomPreferenceTier(person, makeRoom('Opedy'))).toBe(1);
	});

	it('returns tier 3 (nie chcę) when explicitly unwanted', () => {
		const person = { tag_preferences: { Naganiacz: 3 } };
		expect(getRoomPreferenceTier(person, makeRoom('Naganiacz'))).toBe(3);
	});

	it('parses textual "tylko jeśli będzie potrzeba" as tier 2', () => {
		const person = { tag_preferences: { Planszówki: 'tylko jeśli będzie potrzeba' } };
		expect(getRoomPreferenceTier(person, makeRoom('Planszówki'))).toBe(2);
	});

	it('matches a preference by room capability tag, not only by name', () => {
		const person = { tag_preferences: { kasa: 3 } };
		expect(getRoomPreferenceTier(person, makeRoom('Wejście', ['kasa']))).toBe(3);
	});

	it('matches room capability tags when capabilities are serialized JSON', () => {
		const person = { tag_preferences: { planszowki: 1 } };
		const room = {
			id: 'r1',
			name: 'Planszowki 1',
			capabilities: JSON.stringify({ tags: ['planszowki'] })
		};
		expect(getRoomPreferenceTier(person, room)).toBe(1);
	});

	it('matches a numbered room by its inferred family name', () => {
		const person = { tag_preferences: { Tierlista: 1 } };
		expect(getRoomPreferenceTier(person, makeRoom('Tierlista 2'))).toBe(1);
	});

	it('matches case-insensitively', () => {
		const person = { tag_preferences: { planszówki: 1 } };
		expect(getRoomPreferenceTier(person, makeRoom('Planszówki'))).toBe(1);
	});

	it('keeps the strongest objection when name and tag disagree', () => {
		const person = { tag_preferences: { Wejście: 1, kasa: 3 } };
		expect(getRoomPreferenceTier(person, makeRoom('Wejście', ['kasa']))).toBe(3);
	});
});

describe('roomPreferenceSeverity', () => {
	it('maps tier 1 (chcę) to ok/green', () => {
		expect(roomPreferenceSeverity(1)).toBe('ok');
	});

	it('maps tier 2 (tylko w razie potrzeby) to info/blue', () => {
		expect(roomPreferenceSeverity(2)).toBe('info');
	});

	it('maps tier 3 (nie chcę) to error/red', () => {
		expect(roomPreferenceSeverity(3)).toBe('error');
	});

	it('treats an unset station as info/blue end-to-end', () => {
		const person = { tag_preferences: {} };
		const tier = getRoomPreferenceTier(person, makeRoom('Planszówki'));
		expect(roomPreferenceSeverity(tier)).toBe('info');
	});
});

describe('buildPeopleAutoSchedulePlan', () => {
	it('never assigns a person to a station they do not want (tier 3)', () => {
		const people = [{ id: 'p1', display_name: 'Ala', tag_preferences: { Naganiacz: 3 } }];
		const rooms = [makeRoom('Naganiacz')];
		const slots = [{ id: 's1' }];
		const availability = [{ person_id: 'p1', time_slot_id: 's1', tier: 1 }];

		const plan = buildPeopleAutoSchedulePlan({
			people,
			rooms,
			slots,
			availability,
			existingSchedules: []
		});

		expect(plan).toHaveLength(0);
	});

	it('gives a station to the person who explicitly wants it over one with the default preference', () => {
		const people = [
			{ id: 'p1', display_name: 'Ala', tag_preferences: { Opedy: 1 } },
			{ id: 'p2', display_name: 'Ola', tag_preferences: {} }
		];
		const rooms = [makeRoom('Opedy')];
		const slots = [{ id: 's1' }];
		const availability = [
			{ person_id: 'p1', time_slot_id: 's1', tier: 1 },
			{ person_id: 'p2', time_slot_id: 's1', tier: 1 }
		];

		const plan = buildPeopleAutoSchedulePlan({
			people,
			rooms,
			slots,
			availability,
			existingSchedules: []
		});

		expect(plan).toHaveLength(1);
		expect(plan[0].person_id).toBe('p1');
	});

	it('uses balance_hours to decide whether load balancing participates in scoring', () => {
		const people = [
			{ id: 'p1', display_name: 'Ala', tag_preferences: {} },
			{ id: 'p2', display_name: 'Ola', tag_preferences: {} }
		];
		const rooms = [makeRoom('Opedy')];
		const slots = [
			{ id: 's1', date: '2026-06-16', start_time: '09:00' },
			{ id: 's2', date: '2026-06-16', start_time: '10:00' }
		];
		const availability = people.flatMap((person) =>
			slots.map((slot) => ({ person_id: person.id, time_slot_id: slot.id, tier: 1 }))
		);

		const balanced = buildPeopleAutoSchedulePlan({
			people,
			rooms,
			slots,
			availability,
			existingSchedules: [],
			settings: { balance_hours: true }
		});
		const unbalanced = buildPeopleAutoSchedulePlan({
			people,
			rooms,
			slots,
			availability,
			existingSchedules: [],
			settings: { balance_hours: false }
		});

		expect(balanced.map((p) => p.person_id)).toEqual(['p1', 'p2']);
		expect(unbalanced.map((p) => p.person_id)).toEqual(['p1', 'p1']);
	});

	it('uses slot tier to protect best availability in hot people-mode slots', () => {
		const people = [
			{ id: 'p1', display_name: 'Already loaded but available', tag_preferences: {} },
			{ id: 'p2', display_name: 'Fresh but if-needed', tag_preferences: {} }
		];
		const rooms = [makeRoom('Opedy')];
		const existingSchedules = [
			{ person_id: 'p1', room_id: 'Opedy', time_slot_id: 's0', locked: true }
		];
		const availability = [
			{ person_id: 'p1', time_slot_id: 's1', tier: 1 },
			{ person_id: 'p2', time_slot_id: 's1', tier: 2 }
		];

		const hotPlan = buildPeopleAutoSchedulePlan({
			people,
			rooms,
			slots: [
				{ id: 's0', date: '2026-06-16', start_time: '09:00', tier: 2 },
				{ id: 's1', date: '2026-06-16', start_time: '10:00', tier: 1 }
			],
			availability,
			existingSchedules,
			settings: { balance_hours: true }
		});
		const coldPlan = buildPeopleAutoSchedulePlan({
			people,
			rooms,
			slots: [
				{ id: 's0', date: '2026-06-16', start_time: '09:00', tier: 2 },
				{ id: 's1', date: '2026-06-16', start_time: '10:00', tier: 3 }
			],
			availability,
			existingSchedules,
			settings: { balance_hours: true }
		});

		expect(hotPlan).toHaveLength(1);
		expect(hotPlan[0].person_id).toBe('p1');
		expect(coldPlan).toHaveLength(1);
		expect(coldPlan[0].person_id).toBe('p2');
	});

	describe('clustering (cluster_same_person_limit)', () => {
		const room = makeRoom('Naganiacz');
		const slots = [
			{ id: 's1', date: '2026-06-16', start_time: '09:00' },
			{ id: 's2', date: '2026-06-16', start_time: '10:00' },
			{ id: 's3', date: '2026-06-16', start_time: '11:00' },
			{ id: 's4', date: '2026-06-16', start_time: '12:00' }
		];
		const availability = (ids) =>
			ids.flatMap((personId) =>
				slots.map((slot) => ({ person_id: personId, time_slot_id: slot.id, tier: 1 }))
			);

		it('keeps one person on a continuous shift up to the cap, then forces a break', () => {
			const people = [{ id: 'p1', display_name: 'Ala', tag_preferences: {} }];
			const plan = buildPeopleAutoSchedulePlan({
				people,
				rooms: [room],
				slots,
				availability: availability(['p1']),
				existingSchedules: [],
				settings: { cluster_same_person_limit: '2' }
			});
			// Run of 2 (s1, s2), then s3 is skipped because a third in a row would
			// exceed the cap; s4 starts a fresh shift.
			const slotsForP1 = plan.filter((p) => p.person_id === 'p1').map((p) => p.time_slot_id);
			expect(slotsForP1).toEqual(['s1', 's2', 's4']);
			expect(slotsForP1).not.toContain('s3');
		});

		it('with MAX gives a person every consecutive slot (one long shift)', () => {
			const people = [{ id: 'p1', display_name: 'Ala', tag_preferences: {} }];
			const plan = buildPeopleAutoSchedulePlan({
				people,
				rooms: [room],
				slots,
				availability: availability(['p1']),
				existingSchedules: [],
				settings: { cluster_same_person_limit: 'MAX' }
			});
			expect(plan.map((p) => p.time_slot_id)).toEqual(['s1', 's2', 's3', 's4']);
		});

		it('splits two people into back-to-back shifts rather than alternating', () => {
			const people = [
				{ id: 'p1', display_name: 'Ala', tag_preferences: {} },
				{ id: 'p2', display_name: 'Ola', tag_preferences: {} }
			];
			const plan = buildPeopleAutoSchedulePlan({
				people,
				rooms: [room],
				slots,
				availability: availability(['p1', 'p2']),
				existingSchedules: [],
				settings: { cluster_same_person_limit: '2' }
			});
			const bySlot = new Map(plan.map((p) => [p.time_slot_id, p.person_id]));
			// Each person works a contiguous pair, not every other slot.
			expect(bySlot.get('s1')).toBe(bySlot.get('s2'));
			expect(bySlot.get('s3')).toBe(bySlot.get('s4'));
			expect(bySlot.get('s1')).not.toBe(bySlot.get('s3'));
		});

		it('keeps a person inside the same station family when clustering is enabled', () => {
			const people = [
				{ id: 'p1', display_name: 'Ala', tag_preferences: {} },
				{ id: 'p2', display_name: 'Ola', tag_preferences: {} },
				{ id: 'p3', display_name: 'Ela', tag_preferences: {} }
			];
			const rooms = [makeRoom('Planszowki 1'), makeRoom('Planszowki 2'), makeRoom('Rysunki')];
			const familySlots = [
				{ id: 's1', date: '2026-06-16', start_time: '09:00' },
				{ id: 's2', date: '2026-06-16', start_time: '10:00' }
			];
			const familyAvailability = people.flatMap((person) =>
				familySlots.map((slot) => ({
					person_id: person.id,
					time_slot_id: slot.id,
					tier: 1
				}))
			);

			const plan = buildPeopleAutoSchedulePlan({
				people,
				rooms,
				slots: familySlots,
				availability: familyAvailability,
				existingSchedules: [],
				settings: { cluster_same_person_limit: '4' }
			});

			const roomsByPerson = new Map();
			for (const placement of plan) {
				if (!roomsByPerson.has(placement.person_id))
					roomsByPerson.set(placement.person_id, new Set());
				roomsByPerson.get(placement.person_id).add(placement.room_id);
			}

			expect(
				[...roomsByPerson.values()].some((roomsForPerson) => roomsForPerson.has('Rysunki'))
			).toBe(true);
			for (const roomsForPerson of roomsByPerson.values()) {
				const usesPlanszowki =
					roomsForPerson.has('Planszowki 1') || roomsForPerson.has('Planszowki 2');
				if (usesPlanszowki) expect(roomsForPerson.has('Rysunki')).toBe(false);
			}
		});

		it('keeps locked placements in the swap optimization constraints', () => {
			const people = [
				{ id: 'p1', display_name: 'Ala', tag_preferences: { B: 1 } },
				{ id: 'p2', display_name: 'Ola', tag_preferences: { A: 1 } },
				{ id: 'p3', display_name: 'Ela', tag_preferences: {} }
			];
			const rooms = [makeRoom('A'), makeRoom('B')];
			const twoSlots = [
				{ id: 's1', date: '2026-06-16', start_time: '09:00' },
				{ id: 's2', date: '2026-06-16', start_time: '10:00' }
			];
			const slotAvailability = people.flatMap((person) =>
				twoSlots.map((slot) => ({
					person_id: person.id,
					time_slot_id: slot.id,
					tier: 1
				}))
			);

			const plan = buildPeopleAutoSchedulePlan({
				people,
				rooms,
				slots: twoSlots,
				availability: slotAvailability,
				existingSchedules: [{ person_id: 'p1', room_id: 'A', time_slot_id: 's1', locked: true }],
				settings: { cluster_same_person_limit: '4' }
			});

			const p1AtLockedSlot = plan.filter(
				(placement) => placement.person_id === 'p1' && placement.time_slot_id === 's1'
			);
			const occupiedCells = new Set(
				plan.map((placement) => `${placement.room_id}|${placement.time_slot_id}`)
			);

			expect(p1AtLockedSlot).toHaveLength(0);
			expect(occupiedCells.has('A|s1')).toBe(false);
		});
	});
});
