const STORAGE_KEY = 'grafikonator-6000-data';

/** @typedef {import('./import/importer.js').PreviewResult} PreviewResult */

function createEmptyState() {
	return {
		conventions: [],
		people: [],
		rooms: [],
		events: [],
		event_hosts: [],
		time_slots: [],
		availability: [],
		schedules: [],
		import_value_mappings: []
	};
}

/** @type {ReturnType<typeof createEmptyState>} */
let state = createEmptyState();
let loaded = false;

function ensureLoaded() {
	if (loaded || typeof localStorage === 'undefined') return;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			state = { ...createEmptyState(), ...JSON.parse(raw) };
		}
	} catch {
		state = createEmptyState();
	}
	loaded = true;
}

function persist() {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function now() {
	return new Date().toISOString();
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

function slotKey(conventionId, date, startTime) {
	return `${conventionId}|${date}|${startTime}`;
}

// ─── Conventions ───────────────────────────────────────────────────────────

export function getConventionsList() {
	ensureLoaded();
	return [...state.conventions].sort((a, b) => b.start_date.localeCompare(a.start_date));
}

export function getConvention(id) {
	ensureLoaded();
	return state.conventions.find((c) => c.id === id) ?? null;
}

export function getActiveConvention() {
	ensureLoaded();
	if (state.conventions.length === 0) return null;
	return [...state.conventions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function getConventions() {
	return {
		conventions: getConventionsList(),
		active: getActiveConvention()
	};
}

export function createConvention(data) {
	ensureLoaded();
	const id = crypto.randomUUID();
	const timestamp = now();
	const convention = {
		id,
		name: data.name,
		start_date: data.start_date,
		end_date: data.end_date,
		slot_minutes: data.slot_minutes ?? 30,
		day_start_hour: data.day_start_hour ?? 8,
		day_end_hour: data.day_end_hour ?? 22,
		created_at: timestamp,
		updated_at: timestamp
	};
	state.conventions.push(convention);
	persist();
	return convention;
}

// ─── People ────────────────────────────────────────────────────────────────

export function getPeople(conventionId) {
	ensureLoaded();
	return state.people
		.filter((p) => p.convention_id === conventionId)
		.sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export function createPerson(conventionId, data) {
	ensureLoaded();
	const id = crypto.randomUUID();
	const timestamp = now();
	const person = {
		id,
		convention_id: conventionId,
		display_name: data.display_name,
		phone: data.phone || null,
		notes: data.notes || null,
		created_at: timestamp,
		updated_at: timestamp
	};
	state.people.push(person);
	persist();
	return person;
}

export function updatePerson(id, updates) {
	ensureLoaded();
	const person = state.people.find((p) => p.id === id);
	if (!person) return null;

	if (updates.display_name !== undefined) person.display_name = updates.display_name;
	if (updates.phone !== undefined) person.phone = updates.phone;
	if (updates.notes !== undefined) person.notes = updates.notes;
	person.updated_at = now();

	persist();
	return person;
}

export function deletePerson(id) {
	ensureLoaded();
	const hostedEvents = state.event_hosts.filter((eh) => eh.person_id === id);
	if (hostedEvents.length > 0) {
		throw new Error('Nie można usunąć osoby z atrakcjami. Najpierw usuń jej atrakcje.');
	}
	state.availability = state.availability.filter((a) => a.person_id !== id);
	state.people = state.people.filter((p) => p.id !== id);
	persist();
}

export function getPersonWithDetails(personId) {
	ensureLoaded();
	const person = state.people.find((p) => p.id === personId);
	if (!person) return null;

	const eventIds = state.event_hosts
		.filter((eh) => eh.person_id === personId)
		.map((eh) => eh.event_id);
	
	const events = state.events
		.filter((e) => eventIds.includes(e.id))
		.map((e) => ({
			...e,
			schedule: getEventSchedule(e.id)
		}));

	return { ...person, events };
}

// ─── Rooms ─────────────────────────────────────────────────────────────────

export function getRooms(conventionId) {
	ensureLoaded();
	return state.rooms
		.filter((r) => r.convention_id === conventionId)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function createRoom(conventionId, data) {
	ensureLoaded();
	const id = crypto.randomUUID();
	const timestamp = now();
	const room = {
		id,
		convention_id: conventionId,
		name: data.name,
		description: data.description || null,
		capabilities: data.capabilities ? JSON.stringify(data.capabilities) : null,
		created_at: timestamp,
		updated_at: timestamp
	};
	state.rooms.push(room);
	persist();
	return room;
}

export function deleteRoom(id) {
	ensureLoaded();
	const schedule = state.schedules.find((s) => s.room_id === id);
	if (schedule) throw new Error('Nie można usunąć sali z przypisaniami');
	state.rooms = state.rooms.filter((r) => r.id !== id);
	persist();
}

// ─── Events ────────────────────────────────────────────────────────────────

function getEventHosts(eventId) {
	return state.event_hosts
		.filter((eh) => eh.event_id === eventId)
		.map((eh) => state.people.find((p) => p.id === eh.person_id))
		.filter(Boolean);
}

function formatHostNames(hosts) {
	const names = hosts.map((host) => host.display_name).filter(Boolean);
	return names.length ? names.join(', ') : null;
}

function getEventSchedule(eventId) {
	const schedule = state.schedules.find((s) => s.event_id === eventId);
	if (!schedule) return null;
	const room = state.rooms.find((r) => r.id === schedule.room_id);
	const slot = state.time_slots.find((ts) => ts.id === schedule.start_time_slot_id);
	return {
		...schedule,
		room_name: room?.name,
		date: slot?.date,
		start_time: slot?.start_time,
		end_time: slot?.end_time
	};
}

function enrichEvent(event) {
	const hosts = getEventHosts(event.id);
	return {
		...event,
		hosts,
		host_name: formatHostNames(hosts),
		schedule: getEventSchedule(event.id)
	};
}

export function getEvents(conventionId) {
	ensureLoaded();
	return state.events
		.filter((e) => e.convention_id === conventionId)
		.sort((a, b) => a.title.localeCompare(b.title))
		.map(enrichEvent);
}

export function getUnscheduledEvents(conventionId) {
	ensureLoaded();
	const scheduledIds = new Set(state.schedules.map((s) => s.event_id));
	return state.events
		.filter((e) => e.convention_id === conventionId && !scheduledIds.has(e.id))
		.sort((a, b) => a.title.localeCompare(b.title))
		.map(enrichEvent);
}

export function createEvent(conventionId, personId, data) {
	ensureLoaded();
	const id = crypto.randomUUID();
	const timestamp = now();
	const event = {
		id,
		convention_id: conventionId,
		title: data.title,
		kind: data.kind || null,
		duration_minutes: data.duration_minutes,
		description: data.description || null,
		organizer_notes: data.organizer_notes || null,
		adult_content: data.adult_content ? 1 : 0,
		needs_laptop: data.needs_laptop ? 1 : 0,
		needs_speakers: data.needs_speakers ? 1 : 0,
		source_row_hash: null,
		created_at: timestamp,
		updated_at: timestamp
	};
	state.events.push(event);
	state.event_hosts.push({ event_id: id, person_id: personId });
	persist();
	return enrichEvent(event);
}

export function updateEvent(id, updates) {
	ensureLoaded();
	const event = state.events.find((e) => e.id === id);
	if (!event) return null;

	if (updates.title !== undefined) event.title = updates.title;
	if (updates.kind !== undefined) event.kind = updates.kind;
	if (updates.duration_minutes !== undefined) event.duration_minutes = updates.duration_minutes;
	if (updates.description !== undefined) event.description = updates.description;
	if (updates.organizer_notes !== undefined) event.organizer_notes = updates.organizer_notes;
	if (updates.adult_content !== undefined) event.adult_content = updates.adult_content ? 1 : 0;
	if (updates.needs_laptop !== undefined) event.needs_laptop = updates.needs_laptop ? 1 : 0;
	if (updates.needs_speakers !== undefined) event.needs_speakers = updates.needs_speakers ? 1 : 0;
	event.updated_at = now();

	persist();
	return enrichEvent(event);
}

export function deleteEvent(id) {
	ensureLoaded();
	const schedule = state.schedules.find((s) => s.event_id === id);
	if (schedule) {
		state.schedules = state.schedules.filter((s) => s.event_id !== id);
	}
	state.event_hosts = state.event_hosts.filter((eh) => eh.event_id !== id);
	state.events = state.events.filter((e) => e.id !== id);
	persist();
}

export function getPersonAvailabilityGrid(personId, conventionId) {
	ensureLoaded();
	const slots = getTimeSlots(conventionId);
	const availability = state.availability.filter((a) => a.person_id === personId);
	const availMap = new Map(availability.map((a) => [a.time_slot_id, a.tier]));

	const byDate = new Map();
	for (const slot of slots) {
		if (!byDate.has(slot.date)) byDate.set(slot.date, []);
		byDate.get(slot.date).push({
			...slot,
			tier: availMap.get(slot.id) ?? 3
		});
	}

	return [...byDate.entries()].map(([date, slotsList]) => ({
		date,
		slots: slotsList.sort((a, b) => a.start_time.localeCompare(b.start_time))
	}));
}

export function setPersonAvailabilityBulk(personId, slotTiers) {
	ensureLoaded();
	const timestamp = now();
	for (const { slotId, tier } of slotTiers) {
		const existing = state.availability.find(
			(a) => a.person_id === personId && a.time_slot_id === slotId
		);
		if (existing) {
			existing.tier = tier;
			existing.updated_at = timestamp;
		} else {
			state.availability.push({
				id: crypto.randomUUID(),
				person_id: personId,
				time_slot_id: slotId,
				tier,
				created_at: timestamp,
				updated_at: timestamp
			});
		}
	}
	persist();
}

// ─── Time slots ────────────────────────────────────────────────────────────

export function getTimeSlots(conventionId, date = null) {
	ensureLoaded();
	let slots = state.time_slots.filter(
		(ts) => ts.convention_id === conventionId && ts.is_active === 1
	);
	if (date) {
		slots = slots.filter((ts) => ts.date === date);
	}
	return slots.sort((a, b) =>
		a.date === b.date ? a.start_time.localeCompare(b.start_time) : a.date.localeCompare(b.date)
	);
}

export function generateTimeSlotsForConvention(conventionId) {
	ensureLoaded();
	const convention = getConvention(conventionId);
	if (!convention) throw new Error('Nie znaleziono konwentu');

	const timestamp = now();
	let count = 0;
	const existingKeys = new Map(
		state.time_slots.map((ts) => [slotKey(ts.convention_id, ts.date, ts.start_time), ts])
	);

	const current = parseLocalDate(convention.start_date);
	const end = parseLocalDate(convention.end_date);
	const slotMinutes = convention.slot_minutes;

	while (current <= end) {
		const dateStr = formatLocalDate(current);
		for (
			let totalMinutes = convention.day_start_hour * 60;
			totalMinutes < convention.day_end_hour * 60;
			totalMinutes += slotMinutes
		) {
			const startH = Math.floor(totalMinutes / 60);
			const startM = totalMinutes % 60;
			const endTotal = totalMinutes + slotMinutes;
			const endH = Math.floor(endTotal / 60);
			const endM = endTotal % 60;
			const startTime = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00`;
			const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;
			const key = slotKey(conventionId, dateStr, startTime);
			const existing = existingKeys.get(key);
			if (existing) {
				existing.end_time = endTime;
				existing.is_active = 1;
			} else {
				const slot = {
					id: crypto.randomUUID(),
					convention_id: conventionId,
					date: dateStr,
					start_time: startTime,
					end_time: endTime,
					is_active: 1,
					created_at: timestamp
				};
				state.time_slots.push(slot);
				existingKeys.set(key, slot);
			}
			count++;
		}
		current.setDate(current.getDate() + 1);
	}

	persist();
	return count;
}

function generateTimeSlotsInternal(
	conventionId,
	startDate,
	endDate,
	startHour,
	endHour,
	slotMinutes
) {
	const timestamp = now();
	let count = 0;
	const existingKeys = new Map(
		state.time_slots.map((ts) => [slotKey(ts.convention_id, ts.date, ts.start_time), ts])
	);

	const current = parseLocalDate(startDate);
	const end = parseLocalDate(endDate);

	while (current <= end) {
		const dateStr = formatLocalDate(current);
		for (let totalMinutes = startHour * 60; totalMinutes < endHour * 60; totalMinutes += slotMinutes) {
			const startH = Math.floor(totalMinutes / 60);
			const startM = totalMinutes % 60;
			const endTotal = totalMinutes + slotMinutes;
			const endH = Math.floor(endTotal / 60);
			const endM = endTotal % 60;
			const startTime = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00`;
			const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;
			const key = slotKey(conventionId, dateStr, startTime);
			const existing = existingKeys.get(key);
			if (existing) {
				existing.end_time = endTime;
				existing.is_active = 1;
			} else {
				const slot = {
					id: crypto.randomUUID(),
					convention_id: conventionId,
					date: dateStr,
					start_time: startTime,
					end_time: endTime,
					is_active: 1,
					created_at: timestamp
				};
				state.time_slots.push(slot);
				existingKeys.set(key, slot);
			}
			count++;
		}
		current.setDate(current.getDate() + 1);
	}

	return count;
}

function buildSlotIndex(conventionId) {
	/** @type {Map<string, { id: string, start_time: string, end_time: string }[]>} */
	const byDate = new Map();
	for (const slot of state.time_slots.filter((ts) => ts.convention_id === conventionId)) {
		if (!byDate.has(slot.date)) byDate.set(slot.date, []);
		byDate.get(slot.date).push(slot);
	}
	for (const [, list] of byDate) {
		list.sort((a, b) => a.start_time.localeCompare(b.start_time));
	}
	return byDate;
}

// ─── Availability ──────────────────────────────────────────────────────────

export function getAvailability(conventionId = null, date = null, personId = null) {
	ensureLoaded();
	return state.availability
		.filter((a) => {
			const person = state.people.find((p) => p.id === a.person_id);
			const slot = state.time_slots.find((ts) => ts.id === a.time_slot_id);
			if (!person || !slot) return false;
			if (personId && a.person_id !== personId) return false;
			if (conventionId && person.convention_id !== conventionId) return false;
			if (date && slot.date !== date) return false;
			return true;
		})
		.map((a) => {
			const person = state.people.find((p) => p.id === a.person_id);
			const slot = state.time_slots.find((ts) => ts.id === a.time_slot_id);
			return {
				...a,
				display_name: person.display_name,
				date: slot.date,
				start_time: slot.start_time,
				end_time: slot.end_time
			};
		})
		.sort((a, b) =>
			a.date === b.date ? a.start_time.localeCompare(b.start_time) : a.date.localeCompare(b.date)
		);
}

export function getEffectiveAvailability(personId, timeSlotId) {
	ensureLoaded();
	const row = state.availability.find(
		(a) => a.person_id === personId && a.time_slot_id === timeSlotId
	);
	return row?.tier ?? 3;
}

export function setAvailability(personId, timeSlotId, tier) {
	ensureLoaded();
	const timestamp = now();
	const existing = state.availability.find(
		(a) => a.person_id === personId && a.time_slot_id === timeSlotId
	);

	if (existing) {
		existing.tier = tier;
		existing.updated_at = timestamp;
		persist();
		return existing;
	}

	const record = {
		id: crypto.randomUUID(),
		person_id: personId,
		time_slot_id: timeSlotId,
		tier,
		created_at: timestamp,
		updated_at: timestamp
	};
	state.availability.push(record);
	persist();
	return record;
}

function upsertAvailability(personId, slotId, tier, timestamp) {
	const existing = state.availability.find(
		(a) => a.person_id === personId && a.time_slot_id === slotId
	);
	if (existing) {
		existing.tier = Math.min(existing.tier, tier);
		existing.updated_at = timestamp;
		return existing;
	}
	const record = {
		id: crypto.randomUUID(),
		person_id: personId,
		time_slot_id: slotId,
		tier,
		created_at: timestamp,
		updated_at: timestamp
	};
	state.availability.push(record);
	return record;
}

// ─── Schedules ─────────────────────────────────────────────────────────────

function mapScheduleRow(schedule) {
	const event = state.events.find((e) => e.id === schedule.event_id);
	const room = state.rooms.find((r) => r.id === schedule.room_id);
	const slot = state.time_slots.find((ts) => ts.id === schedule.start_time_slot_id);
	const hosts = getEventHosts(schedule.event_id).map((p) => ({
		id: p.id,
		display_name: p.display_name
	}));
	const host_name = formatHostNames(hosts);

	return {
		id: schedule.id,
		event_id: schedule.event_id,
		room_id: schedule.room_id,
		start_time_slot_id: schedule.start_time_slot_id,
		slot_count: schedule.slot_count,
		status: schedule.status,
		notes: schedule.notes,
		created_at: schedule.created_at,
		updated_at: schedule.updated_at,
		event: {
			id: event?.id,
			title: event?.title,
			kind: event?.kind,
			duration_minutes: event?.duration_minutes,
			organizer_notes: event?.organizer_notes,
			host_name
		},
		room: { id: room?.id, name: room?.name },
		start_slot: {
			id: slot?.id,
			date: slot?.date,
			start_time: slot?.start_time,
			end_time: slot?.end_time
		},
		hosts,
		host_name
	};
}

export function getSchedules(conventionId, date = null) {
	ensureLoaded();
	return state.schedules
		.filter((s) => {
			const event = state.events.find((e) => e.id === s.event_id);
			if (!event || event.convention_id !== conventionId) return false;
			if (!date) return true;
			const slot = state.time_slots.find((ts) => ts.id === s.start_time_slot_id);
			return slot?.date === date;
		})
		.sort((a, b) => {
			const slotA = state.time_slots.find((ts) => ts.id === a.start_time_slot_id);
			const slotB = state.time_slots.find((ts) => ts.id === b.start_time_slot_id);
			const roomA = state.rooms.find((r) => r.id === a.room_id);
			const roomB = state.rooms.find((r) => r.id === b.room_id);
			if (slotA.date !== slotB.date) return slotA.date.localeCompare(slotB.date);
			if (slotA.start_time !== slotB.start_time) {
				return slotA.start_time.localeCompare(slotB.start_time);
			}
			return roomA.name.localeCompare(roomB.name);
		})
		.map(mapScheduleRow);
}

function getScheduleById(id) {
	const schedule = state.schedules.find((s) => s.id === id);
	return schedule ? mapScheduleRow(schedule) : null;
}

export function createSchedule(data) {
	ensureLoaded();
	const id = crypto.randomUUID();
	const timestamp = now();
	const schedule = {
		id,
		event_id: data.event_id,
		room_id: data.room_id,
		start_time_slot_id: data.start_time_slot_id,
		slot_count: data.slot_count ?? 1,
		status: data.status || 'scheduled',
		notes: data.notes || null,
		created_at: timestamp,
		updated_at: timestamp
	};
	state.schedules.push(schedule);
	persist();
	return getScheduleById(id);
}

export function updateSchedule(id, updates) {
	ensureLoaded();
	const schedule = state.schedules.find((s) => s.id === id);
	if (!schedule) return null;

	if (updates.event_id !== undefined) schedule.event_id = updates.event_id;
	if (updates.room_id !== undefined) schedule.room_id = updates.room_id;
	if (updates.start_time_slot_id !== undefined) schedule.start_time_slot_id = updates.start_time_slot_id;
	if (updates.slot_count !== undefined) schedule.slot_count = updates.slot_count;
	if (updates.status !== undefined) schedule.status = updates.status;
	if (updates.notes !== undefined) schedule.notes = updates.notes;
	schedule.updated_at = now();

	persist();
	return getScheduleById(id);
}

export function deleteSchedule(id) {
	ensureLoaded();
	state.schedules = state.schedules.filter((s) => s.id !== id);
	persist();
}

export function clearAllSchedules(conventionId) {
	ensureLoaded();
	const eventIds = new Set(
		state.events.filter((e) => e.convention_id === conventionId).map((e) => e.id)
	);
	const removed = state.schedules.filter((s) => eventIds.has(s.event_id)).length;
	state.schedules = state.schedules.filter((s) => !eventIds.has(s.event_id));
	persist();
	return { removed };
}

export function swapSchedules(scheduleIdA, scheduleIdB) {
	ensureLoaded();
	const a = state.schedules.find((s) => s.id === scheduleIdA);
	const b = state.schedules.find((s) => s.id === scheduleIdB);
	if (!a || !b) throw new Error('Nie znaleziono wpisu w grafiku');

	const timestamp = now();
	const aRoom = a.room_id;
	const aSlot = a.start_time_slot_id;
	const aCount = a.slot_count;

	a.room_id = b.room_id;
	a.start_time_slot_id = b.start_time_slot_id;
	a.slot_count = b.slot_count;
	a.updated_at = timestamp;

	b.room_id = aRoom;
	b.start_time_slot_id = aSlot;
	b.slot_count = aCount;
	b.updated_at = timestamp;

	persist();
	return [getScheduleById(scheduleIdA), getScheduleById(scheduleIdB)];
}

function getSlotBlock(conventionId, startSlotId, slotCount) {
	const startSlot = state.time_slots.find((ts) => ts.id === startSlotId);
	if (!startSlot) return [];

	const daySlots = state.time_slots
		.filter(
			(ts) =>
				ts.convention_id === conventionId &&
				ts.date === startSlot.date &&
				ts.is_active === 1
		)
		.sort((a, b) => a.start_time.localeCompare(b.start_time));

	const startIdx = daySlots.findIndex((s) => s.id === startSlotId);
	if (startIdx === -1) return [];
	return daySlots.slice(startIdx, startIdx + slotCount);
}

function roomBlockFree(roomId, slotIds, excludeScheduleId = null) {
	for (const slotId of slotIds) {
		const existing = state.schedules.find(
			(s) =>
				s.room_id === roomId &&
				s.start_time_slot_id === slotId &&
				s.id !== excludeScheduleId
		);
		if (existing) return false;

		const overlapping = state.schedules.filter((s) => s.room_id === roomId);
		const room = state.rooms.find((r) => r.id === roomId);
		for (const sched of overlapping) {
			if (sched.id === excludeScheduleId) continue;
			const block = getSlotBlock(room.convention_id, sched.start_time_slot_id, sched.slot_count);
			if (block.some((s) => slotIds.includes(s.id))) return false;
		}
	}
	return true;
}

function hostsConflict(hostIds, slotIds, excludeEventId = null) {
	for (const hostId of hostIds) {
		const otherEvents = state.schedules.filter((s) => {
			const isHost = state.event_hosts.some(
				(eh) => eh.event_id === s.event_id && eh.person_id === hostId
			);
			return isHost && s.event_id !== excludeEventId;
		});

		for (const sched of otherEvents) {
			const event = state.events.find((e) => e.id === sched.event_id);
			const block = getSlotBlock(event.convention_id, sched.start_time_slot_id, sched.slot_count);
			if (block.some((s) => slotIds.includes(s.id))) return true;
		}
	}
	return false;
}

function getDaySlots(conventionId, date) {
	return state.time_slots
		.filter(
			(ts) => ts.convention_id === conventionId && ts.date === date && ts.is_active === 1
		)
		.sort((a, b) => a.start_time.localeCompare(b.start_time));
}

function countHostSchedulingWarnings(entries) {
	if (!entries.length) return 0;

	const sorted = [...entries].sort((a, b) => a.startIdx - b.startIdx);
	let warnings = 0;

	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const curr = sorted[i];
		const prevEnd = prev.startIdx + prev.slotCount;
		if (curr.startIdx === prevEnd && prev.roomId !== curr.roomId) {
			warnings++;
		}
	}

	let consecutive = sorted[0].slotCount;
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const curr = sorted[i];
		const prevEnd = prev.startIdx + prev.slotCount;
		if (curr.startIdx === prevEnd) {
			consecutive += curr.slotCount;
			continue;
		}

		if (consecutive >= 6) warnings++;
		consecutive = curr.slotCount;
	}
	if (consecutive >= 6) warnings++;

	return warnings;
}

const AUTO_RESHUFFLE_MAX_DEPTH = 4;
const AUTO_RESHUFFLE_TOP_LEVEL_BRANCH_LIMIT = 180;
const AUTO_RESHUFFLE_RELOCATION_BRANCH_LIMIT = 24;
const AUTO_RESHUFFLE_MAX_ATTEMPTS = 6000;
const AUTO_RESHUFFLE_PROGRESS_INTERVAL = 100;

function yieldToBrowser() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function getEventHostIds(eventId) {
	return state.event_hosts.filter((eh) => eh.event_id === eventId).map((eh) => eh.person_id);
}

function getEventSlotCount(event) {
	const convention = getConvention(event.convention_id);
	return Math.ceil(event.duration_minutes / convention.slot_minutes);
}

function getAutoItemForEvent(event) {
	return {
		key: `new:${event.id}`,
		eventId: event.id,
		event,
		hostIds: getEventHostIds(event.id),
		conventionId: event.convention_id,
		slotCount: getEventSlotCount(event),
		originalPlacement: null,
		isNew: true
	};
}

function getAutoItemForSchedule(schedule) {
	const event = state.events.find((e) => e.id === schedule.event_id);
	return {
		key: schedule.id,
		scheduleId: schedule.id,
		eventId: schedule.event_id,
		event,
		hostIds: getEventHostIds(schedule.event_id),
		conventionId: event.convention_id,
		slotCount: schedule.slot_count,
		originalPlacement: {
			room_id: schedule.room_id,
			start_time_slot_id: schedule.start_time_slot_id
		},
		isNew: false
	};
}

function buildAutoItemRegistry(conventionId, pendingItem) {
	const registry = new Map([[pendingItem.key, pendingItem]]);
	for (const schedule of state.schedules) {
		const event = state.events.find((e) => e.id === schedule.event_id);
		if (!event || event.convention_id !== conventionId) continue;
		registry.set(schedule.id, getAutoItemForSchedule(schedule));
	}
	return registry;
}

function getItemPlacement(item, placements) {
	return placements.get(item.key) ?? item.originalPlacement;
}

function getPlacementBlock(item, placement) {
	if (!placement) return [];
	return getSlotBlock(item.conventionId, placement.start_time_slot_id, item.slotCount);
}

function getPlacementWorstTier(item, slotIds) {
	let worstTier = 1;
	for (const hostId of item.hostIds) {
		for (const slotId of slotIds) {
			worstTier = Math.max(worstTier, getEffectiveAvailability(hostId, slotId));
		}
	}
	return worstTier;
}

function shareHost(a, b) {
	if (!a.hostIds.length || !b.hostIds.length) return false;
	const bHosts = new Set(b.hostIds);
	return a.hostIds.some((hostId) => bHosts.has(hostId));
}

function blocksOverlap(a, b) {
	if (!a.length || !b.length) return false;
	const bSlotIds = new Set(b.map((slot) => slot.id));
	return a.some((slot) => bSlotIds.has(slot.id));
}

function findPlacementConflicts(item, placement, placements, registry) {
	const block = getPlacementBlock(item, placement);
	if (block.length < item.slotCount) return null;

	const slotIds = block.map((slot) => slot.id);
	if (getPlacementWorstTier(item, slotIds) === 3) return null;

	const conflicts = new Map();
	for (const other of registry.values()) {
		if (other.key === item.key) continue;

		const otherPlacement = getItemPlacement(other, placements);
		if (!otherPlacement) continue;

		const otherBlock = getPlacementBlock(other, otherPlacement);
		if (!blocksOverlap(block, otherBlock)) continue;

		if (otherPlacement.room_id === placement.room_id || shareHost(item, other)) {
			conflicts.set(other.key, other);
		}
	}

	return [...conflicts.values()];
}

function countPlanPlacementWarnings(item, placement, placements, registry) {
	const block = getPlacementBlock(item, placement);
	const date = block[0]?.date;
	const conventionId = block[0]?.convention_id;
	if (!date || !conventionId) return Number.MAX_SAFE_INTEGER;

	const daySlots = getDaySlots(conventionId, date);
	const startIdx = daySlots.findIndex((slot) => slot.id === block[0].id);
	if (startIdx < 0) return Number.MAX_SAFE_INTEGER;

	let total = 0;
	for (const hostId of item.hostIds) {
		const entries = [];
		for (const other of registry.values()) {
			if (other.key === item.key || !other.hostIds.includes(hostId)) continue;

			const otherPlacement = getItemPlacement(other, placements);
			if (!otherPlacement) continue;

			const otherBlock = getPlacementBlock(other, otherPlacement);
			if (otherBlock[0]?.date !== date) continue;

			const otherStartIdx = daySlots.findIndex((slot) => slot.id === otherBlock[0].id);
			if (otherStartIdx < 0) continue;

			entries.push({
				startIdx: otherStartIdx,
				slotCount: other.slotCount,
				roomId: otherPlacement.room_id
			});
		}

		entries.push({
			startIdx,
			slotCount: item.slotCount,
			roomId: placement.room_id
		});
		total += countHostSchedulingWarnings(entries);
	}

	return total;
}

function compareAutoCandidates(a, b) {
	if (a.schedulingWarnings !== b.schedulingWarnings) {
		return a.schedulingWarnings - b.schedulingWarnings;
	}
	if (a.worstTier !== b.worstTier) return a.worstTier - b.worstTier;
	if (a.conflictCount !== b.conflictCount) return a.conflictCount - b.conflictCount;
	if (a.startSlot.date !== b.startSlot.date) return a.startSlot.date.localeCompare(b.startSlot.date);
	if (a.startSlot.start_time !== b.startSlot.start_time) {
		return a.startSlot.start_time.localeCompare(b.startSlot.start_time);
	}
	return a.room.name.localeCompare(b.room.name);
}

function buildAutoScheduleCandidates(item, placements, registry) {
	const rooms = getRooms(item.conventionId);
	const slotsByDate = new Map();
	for (const slot of getTimeSlots(item.conventionId)) {
		if (!slotsByDate.has(slot.date)) slotsByDate.set(slot.date, []);
		slotsByDate.get(slot.date).push(slot);
	}

	const candidates = [];
	for (const room of rooms) {
		for (const [, daySlots] of slotsByDate) {
			for (let i = 0; i <= daySlots.length - item.slotCount; i++) {
				const block = daySlots.slice(i, i + item.slotCount);
				const slotIds = block.map((slot) => slot.id);
				const worstTier = getPlacementWorstTier(item, slotIds);
				if (worstTier === 3) continue;

				const placement = {
					room_id: room.id,
					start_time_slot_id: block[0].id
				};
				const conflicts = findPlacementConflicts(item, placement, placements, registry);
				if (!conflicts) continue;

				candidates.push({
					...placement,
					room,
					startSlot: block[0],
					worstTier,
					conflictCount: conflicts.length,
					schedulingWarnings: countPlanPlacementWarnings(item, placement, placements, registry)
				});
			}
		}
	}

	return candidates.sort(compareAutoCandidates);
}

async function reportSearchProgress(search) {
	if (!search.onProgress) return;
	if (search.attempts - search.lastProgressAt < AUTO_RESHUFFLE_PROGRESS_INTERVAL) return;

	search.lastProgressAt = search.attempts;
	await search.onProgress({
		current: search.current,
		total: search.total,
		event: search.event,
		phase: `Przesuwanie (${search.current + 1}/${search.total}): ${search.event.title}\nPróba ${search.attempts}/${AUTO_RESHUFFLE_MAX_ATTEMPTS}`
	});
	await yieldToBrowser();
}

async function placeAutoItem(item, placements, registry, depth, lockedKeys, search, isRoot = false) {
	search.attempts++;
	if (search.attempts > AUTO_RESHUFFLE_MAX_ATTEMPTS) return null;
	await reportSearchProgress(search);

	const branchLimit = isRoot
		? AUTO_RESHUFFLE_TOP_LEVEL_BRANCH_LIMIT
		: AUTO_RESHUFFLE_RELOCATION_BRANCH_LIMIT;
	const candidates = buildAutoScheduleCandidates(item, placements, registry).slice(
		0,
		branchLimit
	);

	for (const candidate of candidates) {
		const nextPlacements = new Map(placements);
		nextPlacements.set(item.key, {
			room_id: candidate.room_id,
			start_time_slot_id: candidate.start_time_slot_id
		});

		let conflicts = findPlacementConflicts(item, candidate, nextPlacements, registry);
		if (!conflicts || conflicts.some((conflict) => lockedKeys.has(conflict.key))) continue;

		if (conflicts.length === 0) return nextPlacements;
		if (depth <= 0) continue;

		let resolvedPlacements = nextPlacements;
		let resolved = true;
		const nextLocked = new Set([...lockedKeys, item.key]);

		for (const conflict of conflicts) {
			const stillConflicts = findPlacementConflicts(item, candidate, resolvedPlacements, registry);
			if (!stillConflicts) {
				resolved = false;
				break;
			}
			if (!stillConflicts.some((current) => current.key === conflict.key)) continue;

			const relocated = await placeAutoItem(
				conflict,
				resolvedPlacements,
				registry,
				depth - 1,
				nextLocked,
				search
			);
			if (!relocated) {
				resolved = false;
				break;
			}
			resolvedPlacements = relocated;
		}

		if (!resolved) continue;

		conflicts = findPlacementConflicts(item, candidate, resolvedPlacements, registry);
		if (conflicts && conflicts.every((conflict) => !lockedKeys.has(conflict.key)) && conflicts.length === 0) {
			return resolvedPlacements;
		}
	}

	return null;
}

async function findAutoSchedulePlan(event, onProgress = null, progress = {}) {
	const item = getAutoItemForEvent(event);
	const registry = buildAutoItemRegistry(event.convention_id, item);
	const placements = await placeAutoItem(
		item,
		new Map(),
		registry,
		AUTO_RESHUFFLE_MAX_DEPTH,
		new Set(),
		{
			attempts: 0,
			lastProgressAt: 0,
			onProgress,
			current: progress.current ?? 0,
			total: progress.total ?? 1,
			event
		},
		true
	);
	if (!placements) return null;
	return { item, placements };
}

function applyAutoSchedulePlan(plan) {
	const timestamp = now();
	const pendingPlacement = plan.placements.get(plan.item.key);
	if (!pendingPlacement) return null;

	for (const [key, placement] of plan.placements) {
		if (key === plan.item.key) continue;

		const schedule = state.schedules.find((s) => s.id === key);
		if (!schedule) continue;
		if (
			schedule.room_id === placement.room_id &&
			schedule.start_time_slot_id === placement.start_time_slot_id
		) {
			continue;
		}

		schedule.room_id = placement.room_id;
		schedule.start_time_slot_id = placement.start_time_slot_id;
		schedule.updated_at = timestamp;
	}

	const id = crypto.randomUUID();
	state.schedules.push({
		id,
		event_id: plan.item.eventId,
		room_id: pendingPlacement.room_id,
		start_time_slot_id: pendingPlacement.start_time_slot_id,
		slot_count: plan.item.slotCount,
		status: 'scheduled',
		notes: null,
		created_at: timestamp,
		updated_at: timestamp
	});
	persist();
	return getScheduleById(id);
}

function countAvailablePlacementsForEvent(event) {
	const item = getAutoItemForEvent(event);
	let count = 0;

	for (const room of getRooms(event.convention_id)) {
		const slotsByDate = new Map();
		for (const slot of getTimeSlots(event.convention_id)) {
			if (!slotsByDate.has(slot.date)) slotsByDate.set(slot.date, []);
			slotsByDate.get(slot.date).push(slot);
		}

		for (const [, daySlots] of slotsByDate) {
			for (let i = 0; i <= daySlots.length - item.slotCount; i++) {
				const block = daySlots.slice(i, i + item.slotCount);
				if (getPlacementWorstTier(item, block.map((slot) => slot.id)) < 3) {
					count++;
				}
			}
		}
	}

	return count;
}

function compareAutoScheduleEvents(a, b, placementCounts) {
	const aOptions = placementCounts.get(a.id) ?? 0;
	const bOptions = placementCounts.get(b.id) ?? 0;
	if (aOptions !== bOptions) return aOptions - bOptions;
	if (b.duration_minutes !== a.duration_minutes) return b.duration_minutes - a.duration_minutes;
	return getEventHostIds(b.id).length - getEventHostIds(a.id).length || a.title.localeCompare(b.title);
}

export function getPersonHours(conventionId) {
	ensureLoaded();
	const convention = getConvention(conventionId);
	const slotMinutes = convention?.slot_minutes ?? 30;

	const people = getPeople(conventionId);
	return people.map((person) => {
		const hostedEventIds = state.event_hosts
			.filter((eh) => eh.person_id === person.id)
			.map((eh) => eh.event_id);
		const personSchedules = state.schedules.filter((s) => hostedEventIds.includes(s.event_id));
		const totalSlots = personSchedules.reduce((sum, s) => sum + s.slot_count, 0);
		return {
			id: person.id,
			display_name: person.display_name,
			schedule_count: personSchedules.length,
			total_slots: totalSlots,
			total_hours: (totalSlots * slotMinutes) / 60
		};
	});
}

export async function autoScheduleEvent(eventId, onProgress = null, progress = {}) {
	ensureLoaded();
	const event = enrichEvent(state.events.find((e) => e.id === eventId));
	if (!event) throw new Error('Nie znaleziono atrakcji');
	if (event.schedule) throw new Error('Atrakcja już zaplanowana');

	const plan = await findAutoSchedulePlan(event, onProgress, progress);
	if (!plan) throw new Error('Brak wolnego terminu dla tej atrakcji');

	return applyAutoSchedulePlan(plan);
}

export async function autoScheduleAll(conventionId, onProgress = null) {
	ensureLoaded();
	const eventIds = new Set(state.events.filter((event) => event.convention_id === conventionId).map((e) => e.id));
	const originalState = JSON.parse(JSON.stringify(state));
	const originalScheduledCount = state.schedules.filter((schedule) =>
		eventIds.has(schedule.event_id)
	).length;

	state.schedules = state.schedules.filter((schedule) => !eventIds.has(schedule.event_id));
	persist();

	const placementCounts = new Map();
	const events = state.events.filter((event) => event.convention_id === conventionId);
	for (const event of events) {
		placementCounts.set(event.id, countAvailablePlacementsForEvent(event));
	}
	events.sort((a, b) => compareAutoScheduleEvents(a, b, placementCounts));
	const successes = [];
	const errors = [];

	for (let i = 0; i < events.length; i++) {
		const event = events[i];
		if (onProgress) {
			await onProgress({
				current: i,
				total: events.length,
				event,
				phase: `Planowanie (${i + 1}/${events.length}): ${event.title}`
			});
		}

		try {
			const schedule = await autoScheduleEvent(event.id, onProgress, {
				current: i,
				total: events.length
			});
			successes.push({ event, schedule });
		} catch (error) {
			errors.push({ event, error: error.message });
		}

		if (onProgress) {
			await onProgress({
				current: i + 1,
				total: events.length,
				event,
				phase: `Zaplanowano (${i + 1}/${events.length}): ${event.title}`
			});
		}
	}

	const scheduledCount = state.schedules.filter((schedule) => eventIds.has(schedule.event_id)).length;
	if (scheduledCount < originalScheduledCount) {
		state = originalState;
		persist();
		return {
			successes: [],
			errors: events.map((event) => ({
				event,
				error: 'Przebudowa grafiku nie poprawiła liczby zaplanowanych atrakcji'
			})),
			totalProcessed: events.length,
			restored: true
		};
	}

	return { successes, errors, totalProcessed: events.length, restored: false };
}

export function validateScheduleMove(scheduleId, roomId, startTimeSlotId) {
	ensureLoaded();
	const schedule = state.schedules.find((s) => s.id === scheduleId);
	if (!schedule) throw new Error('Nie znaleziono wpisu w grafiku');

	return validateEventPlacement(schedule.event_id, roomId, startTimeSlotId, scheduleId);
}

export function validateEventPlacement(eventId, roomId, startTimeSlotId, excludeScheduleId = null) {
	ensureLoaded();
	const event = enrichEvent(state.events.find((e) => e.id === eventId));
	if (!event) throw new Error('Nie znaleziono atrakcji');

	const convention = getConvention(event.convention_id);
	const slotCount = Math.ceil(event.duration_minutes / convention.slot_minutes);
	const hostIds = event.hosts.map((h) => h.id);
	const block = getSlotBlock(event.convention_id, startTimeSlotId, slotCount);
	const slotIds = block.map((s) => s.id);

	if (block.length < slotCount) {
		return { valid: false, reason: 'Za mało kolejnych slotów' };
	}
	if (!roomBlockFree(roomId, slotIds, excludeScheduleId)) {
		return { valid: false, reason: 'Sala zajęta w tym czasie' };
	}
	if (hostsConflict(hostIds, slotIds, event.id)) {
		return { valid: false, reason: 'Prowadzący ma konflikt' };
	}

	let worstTier = 1;
	for (const hostId of hostIds) {
		for (const slotId of slotIds) {
			worstTier = Math.max(worstTier, getEffectiveAvailability(hostId, slotId));
		}
	}

	return {
		valid: true,
		worstTier,
		warning: worstTier === 2 ? 'Prowadzący woli nie w tym czasie' : null
	};
}

/**
 * @param {PreviewResult} preview
 * @param {object} options
 */
export function executeImportFromPreview(preview, options) {
	ensureLoaded();
	const { conventionConfig, valueMappings = {}, roomNames = ['Sala A', 'Sala B', 'Sala C'] } =
		options;
	const timestamp = now();
	const conventionId = crypto.randomUUID();
	const slotMinutes = Number(conventionConfig.slotMinutes) || 30;

	state.conventions.push({
		id: conventionId,
		name: conventionConfig.name,
		start_date: conventionConfig.startDate,
		end_date: conventionConfig.endDate,
		slot_minutes: slotMinutes,
		day_start_hour: conventionConfig.dayStartHour ?? 8,
		day_end_hour: conventionConfig.dayEndHour ?? 22,
		created_at: timestamp,
		updated_at: timestamp
	});

	const slotCount = generateTimeSlotsInternal(
		conventionId,
		conventionConfig.startDate,
		conventionConfig.endDate,
		conventionConfig.dayStartHour ?? 8,
		conventionConfig.dayEndHour ?? 22,
		slotMinutes
	);

	const slotsByDateTime = buildSlotIndex(conventionId);

	for (const roomName of roomNames) {
		state.rooms.push({
			id: crypto.randomUUID(),
			convention_id: conventionId,
			name: roomName,
			description: null,
			capabilities: null,
			created_at: timestamp,
			updated_at: timestamp
		});
	}

	for (const [sourceValue, ranges] of Object.entries(valueMappings)) {
		state.import_value_mappings.push({
			id: crypto.randomUUID(),
			convention_id: conventionId,
			mapping_key: 'availability',
			source_value: sourceValue,
			target_json: JSON.stringify(ranges),
			created_at: timestamp
		});
	}

	/** @type {Map<string, string>} */
	const personIds = new Map();
	let availabilityCount = 0;
	let eventCount = 0;

	for (const person of preview.people) {
		const personId = crypto.randomUUID();
		personIds.set(person.display_name, personId);

		state.people.push({
			id: personId,
			convention_id: conventionId,
			display_name: person.display_name,
			phone: null,
			notes: null,
			created_at: timestamp,
			updated_at: timestamp
		});

		for (const event of person.events) {
			const eventId = crypto.randomUUID();
			eventCount++;

			state.events.push({
				id: eventId,
				convention_id: conventionId,
				title: event.title,
				kind: event.kind,
				duration_minutes: event.duration_minutes,
				description: event.description,
				organizer_notes: event.organizer_notes,
				adult_content: event.adult_content ? 1 : 0,
				needs_laptop: event.needs_laptop ? 1 : 0,
				needs_speakers: event.needs_speakers ? 1 : 0,
				source_row_hash: event.source_row_hash,
				created_at: timestamp,
				updated_at: timestamp
			});

			state.event_hosts.push({ event_id: eventId, person_id: personId });

			const tierSlots = expandAvailabilityToSlots(
				event.availability,
				slotsByDateTime,
				slotMinutes
			);

			for (const { slotId, tier } of tierSlots) {
				upsertAvailability(personId, slotId, tier, timestamp);
				availabilityCount++;
			}
		}
	}

	persist();

	return {
		conventionId,
		peopleCount: preview.peopleCount,
		eventCount,
		slotCount,
		availabilityCount,
		warnings: preview.warnings
	};
}

/**
 * @param {{ ranges: { date: string, start: string, end: string }[], tier: number }} availability
 * @param {Map<string, { id: string, start_time: string, end_time: string }[]>} slotsByDate
 */
function expandAvailabilityToSlots(availability, slotsByDate, slotMinutes) {
	const result = [];
	const tier = availability.tier ?? 1;

	for (const range of availability.ranges) {
		const daySlots = slotsByDate.get(range.date) || [];
		for (const slot of daySlots) {
			if (slot.start_time >= range.start && slot.start_time < range.end) {
				result.push({ slotId: slot.id, tier });
			}
		}
	}

	return result;
}

/**
 * Create convention from manually entered people and events.
 * Default availability: tier 1 (available) for all time slots per person.
 * @param {object} options
 */
export function createManualConvention(options) {
	ensureLoaded();
	const {
		conventionConfig,
		roomNames = ['Sala A', 'Sala B', 'Sala C'],
		entries = []
	} = options;
	const timestamp = now();
	const conventionId = crypto.randomUUID();
	const slotMinutes = Number(conventionConfig.slotMinutes) || 30;

	state.conventions.push({
		id: conventionId,
		name: conventionConfig.name,
		start_date: conventionConfig.startDate,
		end_date: conventionConfig.endDate,
		slot_minutes: slotMinutes,
		day_start_hour: conventionConfig.dayStartHour ?? 8,
		day_end_hour: conventionConfig.dayEndHour ?? 22,
		created_at: timestamp,
		updated_at: timestamp
	});

	const slotCount = generateTimeSlotsInternal(
		conventionId,
		conventionConfig.startDate,
		conventionConfig.endDate,
		conventionConfig.dayStartHour ?? 8,
		conventionConfig.dayEndHour ?? 22,
		slotMinutes
	);

	const conventionSlots = state.time_slots.filter((ts) => ts.convention_id === conventionId);

	for (const roomName of roomNames) {
		state.rooms.push({
			id: crypto.randomUUID(),
			convention_id: conventionId,
			name: roomName,
			description: null,
			capabilities: null,
			created_at: timestamp,
			updated_at: timestamp
		});
	}

	let peopleCount = 0;
	let eventCount = 0;

	for (const entry of entries) {
		const displayName = entry.display_name?.trim();
		if (!displayName) continue;

		const personId = crypto.randomUUID();
		peopleCount++;

		state.people.push({
			id: personId,
			convention_id: conventionId,
			display_name: displayName,
			phone: entry.phone?.trim() || null,
			notes: entry.notes?.trim() || null,
			created_at: timestamp,
			updated_at: timestamp
		});

		for (const slot of conventionSlots) {
			upsertAvailability(personId, slot.id, 1, timestamp);
		}

		for (const event of entry.events || []) {
			const title = event.title?.trim();
			if (!title) continue;

			const duration = Number(event.duration_minutes);
			if (!duration || duration <= 0) continue;

			const eventId = crypto.randomUUID();
			eventCount++;

			state.events.push({
				id: eventId,
				convention_id: conventionId,
				title,
				kind: event.kind?.trim() || null,
				duration_minutes: duration,
				description: event.description?.trim() || null,
				organizer_notes: event.organizer_notes?.trim() || null,
				adult_content: event.adult_content ? 1 : 0,
				needs_laptop: event.needs_laptop ? 1 : 0,
				needs_speakers: event.needs_speakers ? 1 : 0,
				source_row_hash: null,
				created_at: timestamp,
				updated_at: timestamp
			});

			state.event_hosts.push({ event_id: eventId, person_id: personId });
		}
	}

	if (peopleCount === 0) {
		throw new Error('Dodaj co najmniej jedną osobę z pseudonimem');
	}
	if (eventCount === 0) {
		throw new Error('Dodaj co najmniej jedną atrakcję');
	}

	persist();

	return {
		conventionId,
		peopleCount,
		eventCount,
		slotCount,
		availabilityCount: peopleCount * conventionSlots.length
	};
}

export function clearAllData() {
	state = createEmptyState();
	persist();
}
