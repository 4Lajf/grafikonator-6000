import { beforeEach, describe, expect, it } from 'vitest';
import {
	autoScheduleAll,
	autoScheduleEvent,
	clearAllData,
	createConvention,
	createEvent,
	createSchedule,
	executeImportFromPreview,
	createPerson,
	createRoom,
	getAvailability,
	generateTimeSlotsForConvention,
	getSchedules,
	getTimeSlots,
	setAvailability,
	updateTimeSlot,
	validateEventPlacement
} from './local-db.js';

describe('autoScheduleEvent', () => {
	beforeEach(() => {
		clearAllData();
	});

	it('generates slots on the configured convention dates', () => {
		const convention = createConvention({
			name: 'Date test',
			start_date: '2023-09-30',
			end_date: '2023-10-01',
			slot_minutes: 60,
			day_start_hour: 9,
			day_end_hour: 10
		});

		generateTimeSlotsForConvention(convention.id);

		expect(getTimeSlots(convention.id).map((slot) => slot.date)).toEqual([
			'2023-09-30',
			'2023-10-01'
		]);
	});

	it('supports different day hours per convention day', () => {
		const convention = createConvention({
			name: 'Per-day hours',
			start_date: '2023-09-30',
			end_date: '2023-10-01',
			slot_minutes: 60,
			day_start_hour: 9,
			day_end_hour: 12,
			day_hours: [{ date: '2023-10-01', start_hour: 10, end_hour: 12 }]
		});

		generateTimeSlotsForConvention(convention.id);
		const slots = getTimeSlots(convention.id);
		expect(slots.filter((slot) => slot.date === '2023-09-30')).toHaveLength(3);
		expect(slots.filter((slot) => slot.date === '2023-10-01')).toHaveLength(2);
	});

	it('stores only non-default availability rows', () => {
		const convention = createConvention({
			name: 'Sparse availability',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 11
		});
		generateTimeSlotsForConvention(convention.id);
		const [slot] = getTimeSlots(convention.id);
		const person = createPerson(convention.id, { display_name: 'Sparse Host' });

		setAvailability(person.id, slot.id, 3);
		expect(getAvailability(convention.id, null, person.id)).toHaveLength(1);

		setAvailability(person.id, slot.id, 1);
		expect(getAvailability(convention.id, null, person.id)).toHaveLength(0);
	});

	it('recursively reshuffles scheduled events to fit a constrained event', async () => {
		const convention = createConvention({
			name: 'Reshuffle test',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 13
		});
		createRoom(convention.id, { name: 'Main room' });
		generateTimeSlotsForConvention(convention.id);

		const slots = getTimeSlots(convention.id);
		const personA = createPerson(convention.id, { display_name: 'A' });
		const personB = createPerson(convention.id, { display_name: 'B' });
		const personC = createPerson(convention.id, { display_name: 'C' });

		const eventA = createEvent(convention.id, personA.id, {
			title: 'Flexible A',
			duration_minutes: 60
		});
		const eventB = createEvent(convention.id, personB.id, {
			title: 'Flexible B',
			duration_minutes: 60
		});
		const eventC = createEvent(convention.id, personC.id, {
			title: 'Constrained C',
			duration_minutes: 60
		});

		setAvailability(personA.id, slots[0].id, 1);
		setAvailability(personA.id, slots[1].id, 1);
		setAvailability(personA.id, slots[2].id, 3);
		setAvailability(personB.id, slots[0].id, 3);
		setAvailability(personB.id, slots[1].id, 1);
		setAvailability(personB.id, slots[2].id, 1);
		setAvailability(personC.id, slots[0].id, 1);
		setAvailability(personC.id, slots[1].id, 3);
		setAvailability(personC.id, slots[2].id, 3);

		await autoScheduleEvent(eventA.id);
		await autoScheduleEvent(eventB.id);
		await autoScheduleEvent(eventC.id);

		const byTitle = new Map(
			getSchedules(convention.id).map((schedule) => [schedule.event.title, schedule])
		);
		expect(byTitle.get('Constrained C').start_time_slot_id).toBe(slots[0].id);
		expect(byTitle.get('Flexible A').start_time_slot_id).toBe(slots[1].id);
		expect(byTitle.get('Flexible B').start_time_slot_id).toBe(slots[2].id);
	});

	it('returns info when event tier mismatches slot tier', () => {
		const convention = createConvention({
			name: 'Tier validation',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 12
		});
		const room = createRoom(convention.id, { name: 'Main room' });
		generateTimeSlotsForConvention(convention.id);

		const [slot] = getTimeSlots(convention.id);
		updateTimeSlot(slot.id, { tier: 1 });

		const person = createPerson(convention.id, { display_name: 'Host' });
		setAvailability(person.id, slot.id, 1);
		const event = createEvent(convention.id, person.id, {
			title: 'Low priority panel',
			duration_minutes: 60,
			tier: 3
		});

		const validation = validateEventPlacement(event.id, room.id, slot.id);
		expect(validation.valid).toBe(true);
		expect(validation.info).toContain('Tier atrakcji T3');
	});

	it('requires a one-hour gap between same-tag events across rooms', () => {
		const convention = createConvention({
			name: 'Tag validation',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 13
		});
		const roomA = createRoom(convention.id, { name: 'Room A' });
		const roomB = createRoom(convention.id, { name: 'Room B' });
		generateTimeSlotsForConvention(convention.id);

		const slots = getTimeSlots(convention.id);
		const hostA = createPerson(convention.id, { display_name: 'Host A' });
		const hostB = createPerson(convention.id, { display_name: 'Host B' });
		const eventA = createEvent(convention.id, hostA.id, {
			title: 'First JoJo panel',
			duration_minutes: 60,
			event_tags: ['jojo']
		});
		const eventB = createEvent(convention.id, hostB.id, {
			title: 'Second JoJo panel',
			duration_minutes: 60,
			event_tags: ['JoJo']
		});

		createSchedule({
			event_id: eventA.id,
			room_id: roomA.id,
			start_time_slot_id: slots[0].id,
			slot_count: 1
		});

		const adjacentValidation = validateEventPlacement(eventB.id, roomB.id, slots[1].id);
		expect(adjacentValidation.valid).toBe(false);
		expect(adjacentValidation.reason).toContain('godziny przerwy');

		const spacedValidation = validateEventPlacement(eventB.id, roomB.id, slots[2].id);
		expect(spacedValidation.valid).toBe(true);
	});

	it('uses event tags as room requirements when the tag exists on rooms', () => {
		const convention = createConvention({
			name: 'Shared tag namespace',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 12
		});
		const plainRoom = createRoom(convention.id, { name: 'Plain room', capabilities: { tags: [] } });
		const projectorRoom = createRoom(convention.id, {
			name: 'Projector room',
			capabilities: { tags: ['projector'] }
		});
		generateTimeSlotsForConvention(convention.id);

		const [slot] = getTimeSlots(convention.id);
		const host = createPerson(convention.id, { display_name: 'Host' });
		const event = createEvent(convention.id, host.id, {
			title: 'Needs projector',
			duration_minutes: 60,
			event_tags: ['projector']
		});

		const plainValidation = validateEventPlacement(event.id, plainRoom.id, slot.id);
		expect(plainValidation.valid).toBe(false);
		expect(plainValidation.reason).toContain('projector');

		const projectorValidation = validateEventPlacement(event.id, projectorRoom.id, slot.id);
		expect(projectorValidation.valid).toBe(true);
	});

	it('applies slot popularity tiers from import settings', () => {
		const preview = {
			people: [
				{
					display_name: 'Host',
					events: [
						{
							title: 'Imported event',
							duration_minutes: 60,
							tier: 1,
							availability: {
								tier: 1,
								ranges: [{ date: '2026-06-01', start: '10:00:00', end: '12:00:00' }]
							}
						}
					]
				}
			],
			peopleCount: 1,
			warnings: []
		};

		const result = executeImportFromPreview(preview, {
			conventionConfig: {
				name: 'Import tiers',
				startDate: '2026-06-01',
				endDate: '2026-06-01',
				slotMinutes: 60,
				daySettings: [{ date: '2026-06-01', startHour: 10, endHour: 12 }],
				slotTierSettings: [
					{ date: '2026-06-01', startTime: '10:00:00', tier: 1 },
					{ date: '2026-06-01', startTime: '11:00:00', tier: 3 }
				]
			},
			roomNames: ['Main room']
		});

		expect(getTimeSlots(result.conventionId).map((slot) => slot.tier)).toEqual([1, 3]);
	});

	it('skips events disabled for automatic planning', async () => {
		const convention = createConvention({
			name: 'Manual only',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 12
		});
		createRoom(convention.id, { name: 'Main room' });
		generateTimeSlotsForConvention(convention.id);

		const [slot] = getTimeSlots(convention.id);
		const person = createPerson(convention.id, { display_name: 'Host' });
		setAvailability(person.id, slot.id, 1);
		const event = createEvent(convention.id, person.id, {
			title: 'Manual only event',
			duration_minutes: 60,
			auto_schedule: false
		});

		await expect(autoScheduleEvent(event.id)).rejects.toThrow('wyłączona');
	});

	it('auto-schedules all events with the hybrid solver', async () => {
		const convention = createConvention({
			name: 'Hybrid all',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 13
		});
		createRoom(convention.id, { name: 'Main room' });
		createRoom(convention.id, { name: 'Second room' });
		generateTimeSlotsForConvention(convention.id);

		const slots = getTimeSlots(convention.id);
		const hostA = createPerson(convention.id, { display_name: 'A' });
		const hostB = createPerson(convention.id, { display_name: 'B' });
		for (const slot of slots) {
			setAvailability(hostA.id, slot.id, 1);
			setAvailability(hostB.id, slot.id, 1);
		}
		createEvent(convention.id, hostA.id, { title: 'A1', duration_minutes: 60 });
		createEvent(convention.id, hostA.id, { title: 'A2', duration_minutes: 60 });
		createEvent(convention.id, hostB.id, { title: 'B1', duration_minutes: 60 });

		const result = await autoScheduleAll(convention.id);

		expect(result.errors).toHaveLength(0);
		expect(getSchedules(convention.id)).toHaveLength(3);
	});

	it('auto-schedules same-tag events with at least one hour between them', async () => {
		const convention = createConvention({
			name: 'Tag-aware solver',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 13
		});
		createRoom(convention.id, { name: 'Room A' });
		createRoom(convention.id, { name: 'Room B' });
		generateTimeSlotsForConvention(convention.id);

		const slots = getTimeSlots(convention.id);
		const hostA = createPerson(convention.id, { display_name: 'Host A' });
		const hostB = createPerson(convention.id, { display_name: 'Host B' });
		for (const slot of slots) {
			setAvailability(hostA.id, slot.id, 1);
			setAvailability(hostB.id, slot.id, 1);
		}
		createEvent(convention.id, hostA.id, {
			title: 'JoJo Ships',
			duration_minutes: 60,
			event_tags: ['jojo']
		});
		createEvent(convention.id, hostB.id, {
			title: 'JoJo Concert',
			duration_minutes: 60,
			event_tags: ['JOJO']
		});

		const result = await autoScheduleAll(convention.id);
		const schedules = getSchedules(convention.id);

		expect(result.errors).toHaveLength(0);
		expect(schedules).toHaveLength(2);
		const scheduledIndexes = schedules
			.map((schedule) => slots.findIndex((slot) => slot.id === schedule.start_time_slot_id))
			.sort((a, b) => a - b);
		expect(scheduledIndexes[1] - scheduledIndexes[0]).toBeGreaterThanOrEqual(2);
	});

	it('keeps contiguous room for longer events before optimizing hype tiers', async () => {
		const convention = createConvention({
			name: 'Gap filling',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 30,
			day_start_hour: 10,
			day_end_hour: 13
		});
		createRoom(convention.id, { name: 'Main room' });
		generateTimeSlotsForConvention(convention.id);

		const slots = getTimeSlots(convention.id);
		[2, 1, 1, 1, 2, 2].forEach((tier, index) => {
			updateTimeSlot(slots[index].id, { tier });
		});

		const shortHosts = [0, 1, 2].map((index) =>
			createPerson(convention.id, { display_name: `Short host ${index}` })
		);
		const longHost = createPerson(convention.id, { display_name: 'Long host' });

		for (const [index, host] of shortHosts.entries()) {
			for (const slot of slots.slice(0, 4)) setAvailability(host.id, slot.id, 1);
			createEvent(convention.id, host.id, {
				title: `Short T1 ${index}`,
				duration_minutes: 30,
				tier: 1
			});
		}

		for (const slot of slots) setAvailability(longHost.id, slot.id, 1);
		createEvent(convention.id, longHost.id, {
			title: 'Long T2',
			duration_minutes: 90,
			tier: 2
		});

		const result = await autoScheduleAll(convention.id);
		const schedules = getSchedules(convention.id);
		const longSchedule = schedules.find((schedule) => schedule.event.title === 'Long T2');

		expect(result.errors).toHaveLength(0);
		expect(schedules).toHaveLength(4);
		expect(longSchedule?.slot_count).toBe(3);
	});

	it('packs flexible events contiguously even when hype tiers prefer split slots', async () => {
		const convention = createConvention({
			name: 'Room compactness',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 30,
			day_start_hour: 10,
			day_end_hour: 12
		});
		createRoom(convention.id, { name: 'Main room' });
		generateTimeSlotsForConvention(convention.id);

		const slots = getTimeSlots(convention.id);
		// Hype tiers would pull the two T2 events to the outer slots (0 and 3),
		// but room compactness should keep them contiguous in the middle.
		[2, 1, 1, 2].forEach((tier, index) => {
			updateTimeSlot(slots[index].id, { tier });
		});

		for (const index of [0, 1]) {
			const host = createPerson(convention.id, { display_name: `Host ${index}` });
			for (const slot of slots) setAvailability(host.id, slot.id, 1);
			createEvent(convention.id, host.id, {
				title: `Tier 2 event ${index}`,
				duration_minutes: 30,
				tier: 2
			});
		}

		const result = await autoScheduleAll(convention.id);
		const slotIndex = new Map(slots.map((slot, index) => [slot.id, index]));
		const schedules = getSchedules(convention.id);
		const occupied = schedules
			.map((schedule) => ({
				start: slotIndex.get(schedule.start_time_slot_id),
				end: slotIndex.get(schedule.start_time_slot_id) + schedule.slot_count
			}))
			.sort((a, b) => a.start - b.start);

		expect(result.errors).toHaveLength(0);
		expect(schedules).toHaveLength(2);
		expect(occupied[1].start).toBe(occupied[0].end);
	});

	it('always places T1 events in T1 slots even if it leaves a gap', async () => {
		const convention = createConvention({
			name: 'T1 in T1 slots',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 30,
			day_start_hour: 10,
			day_end_hour: 12
		});
		createRoom(convention.id, { name: 'Main room' });
		generateTimeSlotsForConvention(convention.id);

		const slots = getTimeSlots(convention.id);
		// Only the outer slots are T1. Contiguity would pull the two T1 events
		// to slots 0+1, but the T1-in-T1 objective must win, sending them to the
		// two T1 slots (0 and 3) even though that leaves an idle gap between them.
		[1, 2, 2, 1].forEach((tier, index) => {
			updateTimeSlot(slots[index].id, { tier });
		});

		for (const index of [0, 1]) {
			const host = createPerson(convention.id, { display_name: `Host ${index}` });
			for (const slot of slots) setAvailability(host.id, slot.id, 1);
			createEvent(convention.id, host.id, {
				title: `Tier 1 event ${index}`,
				duration_minutes: 30,
				tier: 1
			});
		}

		const result = await autoScheduleAll(convention.id);
		const schedules = getSchedules(convention.id);
		const usedTiers = schedules
			.map((schedule) =>
				getTimeSlots(convention.id).find((s) => s.id === schedule.start_time_slot_id)
			)
			.map((slot) => slot.tier)
			.sort();

		expect(result.errors).toHaveLength(0);
		expect(schedules).toHaveLength(2);
		expect(usedTiers).toEqual([1, 1]);
	});

	it('relaxes the T1-slot objective when no T1 slot is reachable', async () => {
		const convention = createConvention({
			name: 'T1 fallback keeps fill',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 30,
			day_start_hour: 10,
			day_end_hour: 12
		});
		createRoom(convention.id, { name: 'Main room' });
		generateTimeSlotsForConvention(convention.id);

		const slots = getTimeSlots(convention.id);
		// No T1 slots at all: a T1 event must still be scheduled (full fill wins
		// over the soft T1-slot preference).
		[2, 2, 2, 2].forEach((tier, index) => {
			updateTimeSlot(slots[index].id, { tier });
		});

		const host = createPerson(convention.id, { display_name: 'Host' });
		for (const slot of slots) setAvailability(host.id, slot.id, 1);
		createEvent(convention.id, host.id, {
			title: 'Lonely T1',
			duration_minutes: 30,
			tier: 1
		});

		const result = await autoScheduleAll(convention.id);
		expect(result.errors).toHaveLength(0);
		expect(getSchedules(convention.id)).toHaveLength(1);
	});
});
