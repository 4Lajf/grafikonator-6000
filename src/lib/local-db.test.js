import { beforeEach, describe, expect, it } from 'vitest';
import {
	autoScheduleEvent,
	clearAllData,
	createConvention,
	createEvent,
	createPerson,
	createRoom,
	generateTimeSlotsForConvention,
	getSchedules,
	getTimeSlots,
	setAvailability
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
		setAvailability(personB.id, slots[1].id, 1);
		setAvailability(personB.id, slots[2].id, 1);
		setAvailability(personC.id, slots[0].id, 1);

		await autoScheduleEvent(eventA.id);
		await autoScheduleEvent(eventB.id);
		await autoScheduleEvent(eventC.id);

		const byTitle = new Map(getSchedules(convention.id).map((schedule) => [schedule.event.title, schedule]));
		expect(byTitle.get('Constrained C').start_time_slot_id).toBe(slots[0].id);
		expect(byTitle.get('Flexible A').start_time_slot_id).toBe(slots[1].id);
		expect(byTitle.get('Flexible B').start_time_slot_id).toBe(slots[2].id);
	});
});
