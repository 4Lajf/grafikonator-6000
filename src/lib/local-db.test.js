import { beforeEach, describe, expect, it } from 'vitest';
import {
	autoScheduleAll,
	autoScheduleEvent,
	clearAllSchedules,
	clearAllData,
	createConvention,
	createEvent,
	createManualConvention,
	createSchedule,
	createPeopleSchedule,
	deleteConvention,
	executeImportFromPreview,
	exportDataJson,
	exportScheduleCsv,
	createPerson,
	createRoom,
	generateTimeSlotsForConvention,
	getAvailability,
	getConventions,
	getUndoHistory,
	movePeopleSchedules,
	getPeopleSchedules,
	getRooms,
	getSchedules,
	getTimeSlots,
	reorderRooms,
	importDataJson,
	setActiveConvention,
	setAvailability,
	updateTimeSlot,
	undoLastActions,
	validatePersonPlacement,
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

	it('supports multiple convention profiles and active profile switching', () => {
		const first = createConvention({
			name: 'First profile',
			start_date: '2026-06-01',
			end_date: '2026-06-01'
		});
		const second = createConvention({
			name: 'Second profile',
			start_date: '2026-07-01',
			end_date: '2026-07-01'
		});

		expect(getConventions().conventions).toHaveLength(2);
		expect(getConventions().active.id).toBe(second.id);

		setActiveConvention(first.id);
		expect(getConventions().active.id).toBe(first.id);
	});

	it('deletes one profile without touching another profile', () => {
		const first = createConvention({
			name: 'Delete me',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 11
		});
		const room = createRoom(first.id, { name: 'Room A' });
		generateTimeSlotsForConvention(first.id);
		const [slot] = getTimeSlots(first.id);
		const person = createPerson(first.id, { display_name: 'Host' });
		const event = createEvent(first.id, person.id, { title: 'Panel', duration_minutes: 60 });
		createSchedule({ event_id: event.id, room_id: room.id, start_time_slot_id: slot.id, slot_count: 1 });

		const second = createConvention({
			name: 'Keep me',
			start_date: '2026-07-01',
			end_date: '2026-07-01'
		});
		setActiveConvention(first.id);

		const result = deleteConvention(first.id);

		expect(result.deleted).toBe(true);
		expect(getConventions().conventions.map((entry) => entry.id)).toEqual([second.id]);
		expect(getConventions().active.id).toBe(second.id);
		expect(getSchedules(first.id)).toHaveLength(0);
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

	it('prioritizes unavailable host validation before room fit errors', () => {
		const convention = createConvention({
			name: 'Availability priority',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 11
		});
		const room = createRoom(convention.id, { name: 'Tiny', capabilities: { capacity: 1 } });
		generateTimeSlotsForConvention(convention.id);
		const [slot] = getTimeSlots(convention.id);
		const person = createPerson(convention.id, { display_name: 'Host' });
		setAvailability(person.id, slot.id, 3);
		const event = createEvent(convention.id, person.id, {
			title: 'Big event',
			duration_minutes: 60,
			estimated_attendance: 100
		});

		const validation = validateEventPlacement(event.id, room.id, slot.id);

		expect(validation.valid).toBe(false);
		expect(validation.code).toBe('availability-unavailable');
		expect(validation.reason).toContain('niedostępny w tym czasie');
	});

	it('supports repeatable person blocks and undo in people mode', () => {
		const convention = createConvention({
			name: 'People mode',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 12,
			schedule_mode: 'people'
		});
		const room = createRoom(convention.id, { name: 'Desk' });
		generateTimeSlotsForConvention(convention.id);
		const slots = getTimeSlots(convention.id);
		const person = createPerson(convention.id, {
			display_name: 'Błażej',
			min_blocks: 1,
			max_blocks: 3,
			color: '#ff99cc'
		});

		createPeopleSchedule({ person_id: person.id, room_id: room.id, time_slot_id: slots[0].id });
		createPeopleSchedule({ person_id: person.id, room_id: room.id, time_slot_id: slots[1].id });
		expect(getPeopleSchedules(convention.id)).toHaveLength(2);

		const undone = undoLastActions(convention.id, 1);
		expect(undone.undone).toBe(1);
		expect(getPeopleSchedules(convention.id)).toHaveLength(1);
	});

	it('atomically swaps people schedule placements', () => {
		const convention = createConvention({
			name: 'People swap',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 11,
			schedule_mode: 'people'
		});
		const roomA = createRoom(convention.id, { name: 'Desk A' });
		const roomB = createRoom(convention.id, { name: 'Desk B' });
		generateTimeSlotsForConvention(convention.id);
		const [slot] = getTimeSlots(convention.id);
		const first = createPerson(convention.id, { display_name: 'Ala' });
		const second = createPerson(convention.id, { display_name: 'Ola' });
		const firstSchedule = createPeopleSchedule({
			person_id: first.id,
			room_id: roomA.id,
			time_slot_id: slot.id
		});
		const secondSchedule = createPeopleSchedule({
			person_id: second.id,
			room_id: roomB.id,
			time_slot_id: slot.id
		});

		movePeopleSchedules([
			{ scheduleId: firstSchedule.id, room_id: roomB.id, time_slot_id: slot.id },
			{ scheduleId: secondSchedule.id, room_id: roomA.id, time_slot_id: slot.id }
		]);

		const byPerson = new Map(
			getPeopleSchedules(convention.id).map((schedule) => [schedule.person_id, schedule])
		);
		expect(byPerson.get(first.id).room_id).toBe(roomB.id);
		expect(byPerson.get(second.id).room_id).toBe(roomA.id);

		const undone = undoLastActions(convention.id, 1);
		expect(undone.undone).toBe(1);
		const restored = new Map(
			getPeopleSchedules(convention.id).map((schedule) => [schedule.person_id, schedule])
		);
		expect(restored.get(first.id).room_id).toBe(roomA.id);
		expect(restored.get(second.id).room_id).toBe(roomB.id);
	});

	it('stores compact undo data when clearing schedules', () => {
		const convention = createConvention({
			name: 'Compact undo',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 12,
			schedule_mode: 'people'
		});
		const room = createRoom(convention.id, { name: 'Desk' });
		generateTimeSlotsForConvention(convention.id);
		const slots = getTimeSlots(convention.id);
		const person = createPerson(convention.id, { display_name: 'Host' });

		createPeopleSchedule({ person_id: person.id, room_id: room.id, time_slot_id: slots[0].id });
		createPeopleSchedule({ person_id: person.id, room_id: room.id, time_slot_id: slots[1].id });
		clearAllSchedules(convention.id);

		const saved = JSON.parse(exportDataJson());
		const snapshot = saved.state.undo_history[0].snapshot;
		expect(snapshot.type).toBe('schedules');
		expect(snapshot.people_schedules).toHaveLength(2);
		expect(snapshot.availability).toBeUndefined();
		expect(snapshot.time_slots).toBeUndefined();

		const undone = undoLastActions(convention.id, 1);
		expect(undone.undone).toBe(1);
		expect(getPeopleSchedules(convention.id)).toHaveLength(2);
	});

	it('prunes old undo entries when localStorage quota is exceeded', () => {
		const originalStorage = globalThis.localStorage;
		const stored = new Map();
		const failWrites = { count: 0 };
		globalThis.localStorage = {
			getItem: (key) => stored.get(key) ?? null,
			setItem: (key, value) => {
				if (failWrites.count > 0) {
					failWrites.count--;
					const error = new Error('Quota exceeded');
					error.name = 'QuotaExceededError';
					throw error;
				}
				stored.set(key, value);
			},
			removeItem: (key) => stored.delete(key),
			clear: () => stored.clear()
		};

		try {
			clearAllData();
			const convention = createConvention({
				name: 'Quota retry',
				start_date: '2026-06-01',
				end_date: '2026-06-01',
				slot_minutes: 30,
				day_start_hour: 8,
				day_end_hour: 11,
				schedule_mode: 'people'
			});
			const room = createRoom(convention.id, { name: 'Desk' });
			generateTimeSlotsForConvention(convention.id);
			const slots = getTimeSlots(convention.id);
			const person = createPerson(convention.id, { display_name: 'Host' });

			for (const slot of slots) {
				createPeopleSchedule({ person_id: person.id, room_id: room.id, time_slot_id: slot.id });
			}
			const undoCountBefore = getUndoHistory(convention.id).length;

			failWrites.count = 3;
			clearAllSchedules(convention.id);

			expect(failWrites.count).toBe(0);
			expect(getPeopleSchedules(convention.id)).toHaveLength(0);
			expect(getUndoHistory(convention.id).length).toBeLessThan(undoCountBefore + 1);
		} finally {
			globalThis.localStorage = originalStorage;
			clearAllData();
		}
	});

	it('keeps manual room order after reordering', () => {
		const convention = createConvention({
			name: 'Room order',
			start_date: '2026-06-01',
			end_date: '2026-06-01'
		});
		const first = createRoom(convention.id, { name: 'B room' });
		const second = createRoom(convention.id, { name: 'A room' });

		expect(getRooms(convention.id).map((room) => room.name)).toEqual(['B room', 'A room']);
		reorderRooms(convention.id, [second.id, first.id]);
		expect(getRooms(convention.id).map((room) => room.name)).toEqual(['A room', 'B room']);
	});

	it('blocks people-mode conflict tags in the same slot', () => {
		const convention = createConvention({
			name: 'People tags',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 11,
			schedule_mode: 'people'
		});
		const roomA = createRoom(convention.id, { name: 'A' });
		const roomB = createRoom(convention.id, { name: 'B' });
		generateTimeSlotsForConvention(convention.id);
		const [slot] = getTimeSlots(convention.id);
		const first = createPerson(convention.id, { display_name: 'Ala', conflict_tags: 'kasa' });
		const second = createPerson(convention.id, { display_name: 'Ola', conflict_tags: 'kasa' });

		createPeopleSchedule({ person_id: first.id, room_id: roomA.id, time_slot_id: slot.id });
		const validation = validatePersonPlacement(second.id, roomB.id, slot.id);

		expect(validation.valid).toBe(false);
		expect(validation.code).toBe('tag-conflict');
	});

	it('does not warn for people co-schedule tags when a same-slot partner exists', () => {
		const convention = createConvention({
			name: 'People co tags',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 12,
			schedule_mode: 'people'
		});
		const roomA = createRoom(convention.id, { name: 'A' });
		const roomB = createRoom(convention.id, { name: 'B' });
		generateTimeSlotsForConvention(convention.id);
		const [firstSlot, secondSlot] = getTimeSlots(convention.id);
		const scarlet = createPerson(convention.id, {
			display_name: 'Scarlet',
			co_schedule_tags: 'ScarletPotato'
		});
		const chie = createPerson(convention.id, {
			display_name: 'Chie',
			co_schedule_tags: 'ScarletPotato',
			tag_preferences: { B: 1 }
		});

		createPeopleSchedule({ person_id: scarlet.id, room_id: roomA.id, time_slot_id: firstSlot.id });
		let validation = validatePersonPlacement(chie.id, roomB.id, secondSlot.id);

		expect(validation.valid).toBe(true);
		expect(validation.warning).toContain('Scarlet');

		createPeopleSchedule({ person_id: scarlet.id, room_id: roomA.id, time_slot_id: secondSlot.id });
		validation = validatePersonPlacement(chie.id, roomB.id, secondSlot.id);

		expect(validation.valid).toBe(true);
		expect(validation.warning).toBeNull();
	});

	it('imports people-mode availability ranges and room tag preferences', () => {
		const result = createManualConvention({
			conventionConfig: {
				name: 'Wide availability',
				startDate: '2026-06-12',
				endDate: '2026-06-12',
				slotMinutes: 60,
				scheduleMode: 'people',
				daySettings: [{ date: '2026-06-12', startHour: 12, endHour: 14 }]
			},
			roomNames: ['Naganiacz'],
			entries: [
				{
					display_name: 'Błażej',
					tag_preferences: { Naganiacz: 3 },
					availability_ranges: [
						{ date: '2026-06-12', start: '12:00:00', end: '13:00:00', tier: 1 },
						{ date: '2026-06-12', start: '13:00:00', end: '14:00:00', tier: 2 }
					],
					events: []
				}
			]
		});
		const [personAvailability] = getAvailability(result.conventionId);
		const [room] = getRooms(result.conventionId);

		expect(room.capabilities.tags).toContain('Naganiacz');
		expect(personAvailability.tier).toBe(1);
		const personId = getConventions().active ? getAvailability(result.conventionId)[0].person_id : null;
		const validation = validatePersonPlacement(personId, room.id, getTimeSlots(result.conventionId)[0].id);
		expect(validation.valid).toBe(false);
		expect(validation.code).toBe('room-tag-unwanted');
	});

	it('exports schedule csv and imports json as people mode', () => {
		const convention = createConvention({
			name: 'Export test',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 11
		});
		const room = createRoom(convention.id, { name: 'Main' });
		generateTimeSlotsForConvention(convention.id);
		const [slot] = getTimeSlots(convention.id);
		const person = createPerson(convention.id, { display_name: 'Host' });
		const event = createEvent(convention.id, person.id, { title: 'Panel', duration_minutes: 60 });
		createSchedule({ event_id: event.id, room_id: room.id, start_time_slot_id: slot.id, slot_count: 1 });

		const csv = exportScheduleCsv(convention.id);
		expect(csv.split('\n')[0]).toBe('Data,Godzina,Main');
		expect(csv).toContain('2026-06-01,10:00-11:00');
		expect(csv).toContain('Panel');
		expect(csv).toContain('Host');
		expect(csv).not.toContain('Tier');
		expect(csv).not.toContain('Kolor');
		expect(csv).not.toContain('Tagi');
		const json = exportDataJson();
		clearAllData();
		importDataJson(json, { convertEventsToPeople: true });

		expect(getConventions().active.schedule_mode).toBe('people');
	});

	it('imports JSON as a new isolated profile without wiping or mutating existing ones', () => {
		const existing = createConvention({
			name: 'Existing profile',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 11
		});
		const room = createRoom(existing.id, { name: 'Main' });
		generateTimeSlotsForConvention(existing.id);
		const [slot] = getTimeSlots(existing.id);
		const person = createPerson(existing.id, { display_name: 'Host' });
		const event = createEvent(existing.id, person.id, { title: 'Panel', duration_minutes: 60 });
		createSchedule({ event_id: event.id, room_id: room.id, start_time_slot_id: slot.id, slot_count: 1 });

		// Snapshot the existing profile so we can prove the import never touches it.
		const json = exportDataJson();
		const before = getConventions().conventions.length;

		importDataJson(json);
		const afterFirst = getConventions();
		expect(afterFirst.conventions.length).toBe(before + 1); // added, not replaced
		expect(afterFirst.conventions.some((c) => c.id === existing.id)).toBe(true); // original kept
		expect(afterFirst.activeId).not.toBe(existing.id); // switched to the import

		// The imported profile gets its own fresh ids — no shared rows with the original.
		const importedId = afterFirst.activeId;
		const importedSchedules = getSchedules(importedId);
		const originalSchedules = getSchedules(existing.id);
		expect(importedSchedules).toHaveLength(1);
		expect(originalSchedules).toHaveLength(1);
		expect(importedSchedules[0].id).not.toBe(originalSchedules[0].id);
		expect(importedSchedules[0].room_id).not.toBe(originalSchedules[0].room_id);

		// Editing the imported profile must not change the original.
		clearAllSchedules(importedId);
		expect(getSchedules(importedId)).toHaveLength(0);
		expect(getSchedules(existing.id)).toHaveLength(1);

		// Re-importing the same file yields yet another distinct profile.
		importDataJson(json);
		expect(getConventions().conventions.length).toBe(before + 2);
	});

	it('carries scheduled events into the people grid when converting on import', () => {
		const convention = createConvention({
			name: 'Convert test',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 12
		});
		const room = createRoom(convention.id, { name: 'Main' });
		generateTimeSlotsForConvention(convention.id);
		const slots = getTimeSlots(convention.id);
		expect(slots.length).toBe(2);
		const person = createPerson(convention.id, { display_name: 'Host' });
		// A two-slot event hosted by the person, placed at the first slot.
		const event = createEvent(convention.id, person.id, { title: 'Panel', duration_minutes: 120 });
		createSchedule({ event_id: event.id, room_id: room.id, start_time_slot_id: slots[0].id, slot_count: 2 });

		const json = exportDataJson();
		clearAllData();
		importDataJson(json, { convertEventsToPeople: true });

		const active = getConventions().active;
		expect(active.schedule_mode).toBe('people');
		const peopleSchedules = getPeopleSchedules(active.id);
		// The host occupies the room for both slots the event spanned.
		expect(peopleSchedules).toHaveLength(2);
		expect(peopleSchedules.every((s) => s.person?.display_name === 'Host')).toBe(true);
		expect(peopleSchedules.every((s) => s.room?.name === 'Main')).toBe(true);
		expect(new Set(peopleSchedules.map((s) => s.time_slot_id)).size).toBe(2);
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

	it('honors event conflict tags in the hybrid solver', async () => {
		const convention = createConvention({
			name: 'Event tag conflicts',
			start_date: '2026-06-01',
			end_date: '2026-06-01',
			slot_minutes: 60,
			day_start_hour: 10,
			day_end_hour: 12
		});
		createRoom(convention.id, { name: 'Main room' });
		createRoom(convention.id, { name: 'Second room' });
		generateTimeSlotsForConvention(convention.id);

		const slots = getTimeSlots(convention.id);
		for (const index of [0, 1]) {
			const host = createPerson(convention.id, { display_name: `Host ${index}` });
			for (const slot of slots) setAvailability(host.id, slot.id, 1);
			createEvent(convention.id, host.id, {
				title: `Conflicting event ${index}`,
				duration_minutes: 60,
				conflict_tags: 'shared-track'
			});
		}

		const result = await autoScheduleAll(convention.id);
		const schedules = getSchedules(convention.id);

		expect(result.errors).toHaveLength(0);
		expect(schedules).toHaveLength(2);
		expect(new Set(schedules.map((schedule) => schedule.start_time_slot_id)).size).toBe(2);
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
