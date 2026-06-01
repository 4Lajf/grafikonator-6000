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

/**
 * Solver-scoped lookup cache. Built once at the start of a synchronous solve to
 * turn O(n) array scans (availability / slot tier) into O(1) map lookups, then
 * cleared. Mirrors OptaPlanner keeping incremental state hot during planning.
 * @type {{ availability: Map<string, number>, slotTier: Map<string, number> } | null}
 */
let solverLookupCache = null;

const DEFAULT_ROOM_NAMES = [
	'Main Stage',
	'Auditorium',
	'Contest Room',
	'Panel Room A',
	'Panel Room B',
	'Panel Room C',
	'Workshop Room',
	'Small Club Room',
	'Open Corridor Zone',
	'Rhythm Games Zone'
];

const DEFAULT_ROOM_CAPABILITIES = {
	'Main Stage': {
		capacity: 200,
		tags: ['main_stage'],
		noisePolicy: 'loud_ok',
		notes: 'Best for opening, cosplay, concerts, dance shows and other headline events.'
	},
	Auditorium: {
		capacity: 200,
		tags: [],
		noisePolicy: 'normal',
		notes: 'Large seated room for high-interest talks and guest panels.'
	},
	'Contest Room': {
		capacity: 200,
		tags: [],
		noisePolicy: 'loud_ok',
		notes: 'Quiz and competition room with audio and scoring setup.'
	},
	'Panel Room A': {
		capacity: 100,
		tags: [],
		noisePolicy: 'quiet',
		notes: 'Standard lecture room.'
	},
	'Panel Room B': {
		capacity: 100,
		tags: [],
		noisePolicy: 'quiet',
		notes: 'Standard lecture room.'
	},
	'Panel Room C': {
		capacity: 100,
		tags: [],
		noisePolicy: 'quiet',
		notes: 'Standard lecture room.'
	},
	'Workshop Room': {
		capacity: 100,
		tags: [],
		noisePolicy: 'normal',
		notes: 'Tables and material handling for craft sessions.'
	},
	'Small Club Room': {
		capacity: 20,
		tags: [],
		noisePolicy: 'quiet',
		notes: 'Small discussion room for niche sessions.'
	},
	'Open Corridor Zone': {
		capacity: 100,
		tags: [],
		noisePolicy: 'normal',
		notes: 'Drop-in hallway activities and short social events.'
	},
	'Rhythm Games Zone': {
		capacity: 100,
		tags: [],
		noisePolicy: 'loud_ok',
		notes: 'Dedicated rhythm game corner.'
	}
};

function parseJsonValue(value, fallback = null) {
	if (value == null || value === '') return fallback;
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return fallback;
	}
}

function normalizeList(value) {
	if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
	return String(value ?? '')
		.split(/[,;\n]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function normalizeNullableInteger(value) {
	if (value == null || value === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

function roomCapabilitiesForName(name) {
	const capabilities = DEFAULT_ROOM_CAPABILITIES[name] ?? {};
	return {
		capacity: capabilities.capacity ?? null,
		tags: normalizeList(capabilities.tags),
		noisePolicy: capabilities.noisePolicy ?? null,
		notes: capabilities.notes ?? null
	};
}

function normalizeRoomCapabilities(value) {
	const capabilities = parseJsonValue(value, value ?? {});
	return {
		capacity: normalizeNullableInteger(capabilities?.capacity),
		tags: normalizeList(capabilities?.tags),
		noisePolicy: capabilities?.noisePolicy || null,
		notes: capabilities?.notes || null
	};
}

function serializeRoomCapabilities(value) {
	return JSON.stringify(normalizeRoomCapabilities(value));
}

function roomRecord(conventionId, name, timestamp, capabilities = roomCapabilitiesForName(name)) {
	return {
		id: crypto.randomUUID(),
		convention_id: conventionId,
		name,
		description: capabilities.notes || null,
		capabilities: serializeRoomCapabilities(capabilities),
		created_at: timestamp,
		updated_at: timestamp
	};
}

function normalizeTier(value, fallback = 2) {
	const n = Number(value);
	return n === 1 || n === 2 || n === 3 ? n : fallback;
}

function normalizeStartHour(value, fallback = 8) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(23, Math.max(0, Math.floor(n)));
}

function normalizeEndHour(value, fallback = 22) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(24, Math.max(1, Math.floor(n)));
}

function normalizeHourWindow(startHour, endHour, fallbackStart = 8, fallbackEnd = 22) {
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

function buildDateRange(startDate, endDate) {
	if (!startDate || !endDate || startDate > endDate) return [];
	const dates = [];
	const current = parseLocalDate(startDate);
	const end = parseLocalDate(endDate);
	while (current <= end) {
		dates.push(formatLocalDate(current));
		current.setDate(current.getDate() + 1);
	}
	return dates;
}

function normalizeConventionDayHours(
	dayHours,
	startDate,
	endDate,
	defaultStart = 8,
	defaultEnd = 22
) {
	const allowedDates = new Set(buildDateRange(startDate, endDate));
	if (!allowedDates.size) return [];

	/** @type {Map<string, { date: string, start_hour: number, end_hour: number }>} */
	const byDate = new Map();
	for (const entry of Array.isArray(dayHours) ? dayHours : []) {
		const date = entry?.date;
		if (!date || !allowedDates.has(date)) continue;
		const { startHour, endHour } = normalizeHourWindow(
			entry.start_hour ?? entry.startHour,
			entry.end_hour ?? entry.endHour,
			defaultStart,
			defaultEnd
		);
		byDate.set(date, {
			date,
			start_hour: startHour,
			end_hour: endHour
		});
	}

	return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function deriveGlobalHoursFromDayHours(dayHours) {
	if (!Array.isArray(dayHours) || dayHours.length === 0) {
		return normalizeHourWindow(8, 22);
	}
	return normalizeHourWindow(
		Math.min(...dayHours.map((d) => Number(d.start_hour ?? d.startHour))),
		Math.max(...dayHours.map((d) => Number(d.end_hour ?? d.endHour)))
	);
}

function getConventionDayHoursMap(convention) {
	const defaults = normalizeHourWindow(convention.day_start_hour, convention.day_end_hour);
	const dayHours = normalizeConventionDayHours(
		convention.day_hours,
		convention.start_date,
		convention.end_date,
		defaults.startHour,
		defaults.endHour
	);
	return new Map(
		dayHours.map((entry) => [
			entry.date,
			{
				startHour: entry.start_hour,
				endHour: entry.end_hour
			}
		])
	);
}

function getConventionHoursForDate(convention, date, dayHoursMap = null) {
	const defaults = normalizeHourWindow(convention.day_start_hour, convention.day_end_hour);
	const map = dayHoursMap ?? getConventionDayHoursMap(convention);
	const configured = map.get(date);
	if (!configured) return defaults;
	return normalizeHourWindow(
		configured.startHour,
		configured.endHour,
		defaults.startHour,
		defaults.endHour
	);
}

function migrateLoadedState() {
	let changed = false;

	for (const convention of state.conventions) {
		const normalizedSlotMinutes = Number(convention.slot_minutes) || 30;
		const defaults = normalizeHourWindow(
			convention.day_start_hour ?? 8,
			convention.day_end_hour ?? 22
		);
		const normalizedDayHours = normalizeConventionDayHours(
			convention.day_hours,
			convention.start_date,
			convention.end_date,
			defaults.startHour,
			defaults.endHour
		);

		if (convention.slot_minutes !== normalizedSlotMinutes) {
			convention.slot_minutes = normalizedSlotMinutes;
			changed = true;
		}
		if (convention.day_start_hour !== defaults.startHour) {
			convention.day_start_hour = defaults.startHour;
			changed = true;
		}
		if (convention.day_end_hour !== defaults.endHour) {
			convention.day_end_hour = defaults.endHour;
			changed = true;
		}
		if (JSON.stringify(convention.day_hours ?? []) !== JSON.stringify(normalizedDayHours)) {
			convention.day_hours = normalizedDayHours;
			changed = true;
		}
	}

	for (const slot of state.time_slots) {
		const normalized = normalizeTier(slot.tier, 2);
		if (slot.tier !== normalized) {
			slot.tier = normalized;
			changed = true;
		}
	}

	for (const event of state.events) {
		const normalized = normalizeTier(event.tier, 2);
		if (event.tier !== normalized) {
			event.tier = normalized;
			changed = true;
		}
		if (event.auto_schedule === undefined) {
			event.auto_schedule = 1;
			changed = true;
		}
		if (event.estimated_attendance === undefined) {
			event.estimated_attendance = null;
			changed = true;
		}
		if (event.required_room_tags === undefined) {
			event.required_room_tags = [];
			changed = true;
		}
		if (event.equipment_needs === undefined) {
			event.equipment_needs = [];
			changed = true;
		}
		if (!event.kind && event.interaction_level) {
			event.kind = event.interaction_level;
			changed = true;
		}
		if (event.interaction_level !== undefined) {
			delete event.interaction_level;
			changed = true;
		}
		if (event.preferred_room_tags !== undefined) {
			delete event.preferred_room_tags;
			changed = true;
		}
	}

	for (const convention of state.conventions) {
		const slots = state.time_slots.filter((ts) => ts.convention_id === convention.id);
		const people = state.people.filter((p) => p.convention_id === convention.id);
		const timestamp = now();
		for (const person of people) {
			for (const slot of slots) {
				const existing = state.availability.find(
					(a) => a.person_id === person.id && a.time_slot_id === slot.id
				);
				if (!existing) {
					state.availability.push({
						id: crypto.randomUUID(),
						person_id: person.id,
						time_slot_id: slot.id,
						tier: 1,
						created_at: timestamp,
						updated_at: timestamp
					});
					changed = true;
				}
			}
		}
	}

	for (const room of state.rooms) {
		const defaults = roomCapabilitiesForName(room.name);
		const current = normalizeRoomCapabilities(room.capabilities ?? defaults);
		const currentCapacity = current.capacity ?? 0;
		const defaultCapacity = defaults.capacity ?? 0;
		const normalized = {
			...current,
			capacity: Math.max(currentCapacity, defaultCapacity) || null,
			tags: [...defaults.tags],
			noisePolicy: current.noisePolicy ?? defaults.noisePolicy,
			notes: current.notes ?? defaults.notes
		};
		const serialized = serializeRoomCapabilities(normalized);
		if (room.capabilities !== serialized) {
			room.capabilities = serialized;
			changed = true;
		}
		if (!room.description && normalized.notes) {
			room.description = normalized.notes;
			changed = true;
		}
	}

	return changed;
}

function ensureLoaded() {
	if (loaded || typeof localStorage === 'undefined') return;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			state = { ...createEmptyState(), ...JSON.parse(raw) };
		}
		if (migrateLoadedState()) {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
	const slotMinutes = Number(data.slot_minutes) || 30;
	const defaultHours = normalizeHourWindow(data.day_start_hour ?? 8, data.day_end_hour ?? 22);
	const dayHours = normalizeConventionDayHours(
		data.day_hours,
		data.start_date,
		data.end_date,
		defaultHours.startHour,
		defaultHours.endHour
	);
	const convention = {
		id,
		name: data.name,
		start_date: data.start_date,
		end_date: data.end_date,
		slot_minutes: slotMinutes,
		day_start_hour: defaultHours.startHour,
		day_end_hour: defaultHours.endHour,
		day_hours: dayHours,
		created_at: timestamp,
		updated_at: timestamp
	};
	state.conventions.push(convention);
	persist();
	return convention;
}

export function updateConvention(id, updates) {
	ensureLoaded();
	const convention = state.conventions.find((c) => c.id === id);
	if (!convention) return null;

	if (updates.name !== undefined) {
		const name = String(updates.name || '').trim();
		if (!name) throw new Error('Nazwa konwentu nie może być pusta');
		convention.name = name;
	}
	if (updates.start_date !== undefined) convention.start_date = updates.start_date;
	if (updates.end_date !== undefined) convention.end_date = updates.end_date;
	if (convention.start_date > convention.end_date) {
		throw new Error('Data początku nie może być po dacie końca');
	}

	if (updates.slot_minutes !== undefined) {
		const slotMinutes = Number(updates.slot_minutes);
		if (!Number.isFinite(slotMinutes) || slotMinutes <= 0) {
			throw new Error('Nieprawidłowa długość slotu');
		}
		convention.slot_minutes = slotMinutes;
	}

	if (updates.day_hours !== undefined) {
		convention.day_hours = normalizeConventionDayHours(
			updates.day_hours,
			convention.start_date,
			convention.end_date,
			8,
			22
		);
	} else if (updates.day_start_hour !== undefined || updates.day_end_hour !== undefined) {
		const globalHours = normalizeHourWindow(
			updates.day_start_hour ?? convention.day_start_hour,
			updates.day_end_hour ?? convention.day_end_hour
		);
		convention.day_start_hour = globalHours.startHour;
		convention.day_end_hour = globalHours.endHour;
		convention.day_hours = normalizeConventionDayHours(
			convention.day_hours,
			convention.start_date,
			convention.end_date,
			globalHours.startHour,
			globalHours.endHour
		);
	}

	if (convention.day_hours?.length) {
		const derived = deriveGlobalHoursFromDayHours(convention.day_hours);
		convention.day_start_hour = derived.startHour;
		convention.day_end_hour = derived.endHour;
	}

	convention.updated_at = now();
	persist();
	return convention;
}

export function getConventionDayHours(conventionId) {
	ensureLoaded();
	const convention = getConvention(conventionId);
	if (!convention) return [];

	const defaults = normalizeHourWindow(convention.day_start_hour, convention.day_end_hour);
	const overrides = new Map(
		normalizeConventionDayHours(
			convention.day_hours,
			convention.start_date,
			convention.end_date,
			defaults.startHour,
			defaults.endHour
		).map((entry) => [entry.date, entry])
	);

	return buildDateRange(convention.start_date, convention.end_date).map((date) => ({
		date,
		start_hour: overrides.get(date)?.start_hour ?? defaults.startHour,
		end_hour: overrides.get(date)?.end_hour ?? defaults.endHour
	}));
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
	const displayName = String(data.display_name || '').trim();
	if (!displayName) throw new Error('Podaj pseudonim osoby');

	const id = crypto.randomUUID();
	const timestamp = now();
	const person = {
		id,
		convention_id: conventionId,
		display_name: displayName,
		phone: data.phone?.trim() || null,
		notes: data.notes?.trim() || null,
		created_at: timestamp,
		updated_at: timestamp
	};
	state.people.push(person);
	ensureDefaultAvailabilityForPerson(id, conventionId, timestamp);
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
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((room) => ({
			...room,
			capabilities: normalizeRoomCapabilities(room.capabilities)
		}));
}

export function createRoom(conventionId, data) {
	ensureLoaded();
	const id = crypto.randomUUID();
	const timestamp = now();
	const capabilities = normalizeRoomCapabilities(
		data.capabilities ?? roomCapabilitiesForName(data.name)
	);
	const room = {
		id,
		convention_id: conventionId,
		name: data.name,
		description: data.description || capabilities.notes || null,
		capabilities: serializeRoomCapabilities(capabilities),
		created_at: timestamp,
		updated_at: timestamp
	};
	state.rooms.push(room);
	persist();
	return { ...room, capabilities };
}

export function updateRoom(id, updates) {
	ensureLoaded();
	const room = state.rooms.find((r) => r.id === id);
	if (!room) return null;

	if (updates.name !== undefined) {
		const name = String(updates.name || '').trim();
		if (!name) throw new Error('Nazwa sali nie może być pusta');
		room.name = name;
	}
	if (updates.description !== undefined) room.description = updates.description || null;
	if (updates.capabilities !== undefined) {
		room.capabilities = serializeRoomCapabilities(updates.capabilities);
	}
	room.updated_at = now();
	persist();
	return { ...room, capabilities: normalizeRoomCapabilities(room.capabilities) };
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
		tier: normalizeTier(data.tier, 2),
		auto_schedule: data.auto_schedule === false || data.auto_schedule === 0 ? 0 : 1,
		adult_content: data.adult_content ? 1 : 0,
		needs_laptop: data.needs_laptop ? 1 : 0,
		needs_speakers: data.needs_speakers ? 1 : 0,
		estimated_attendance: normalizeNullableInteger(data.estimated_attendance),
		required_room_tags: normalizeList(data.required_room_tags),
		equipment_needs: normalizeList(data.equipment_needs),
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
	if (updates.kind !== undefined) event.kind = updates.kind?.trim() || null;
	if (updates.duration_minutes !== undefined) event.duration_minutes = updates.duration_minutes;
	if (updates.description !== undefined) event.description = updates.description;
	if (updates.organizer_notes !== undefined) event.organizer_notes = updates.organizer_notes;
	if (updates.tier !== undefined) event.tier = normalizeTier(updates.tier, event.tier ?? 2);
	if (updates.auto_schedule !== undefined) {
		event.auto_schedule = updates.auto_schedule === false || updates.auto_schedule === 0 ? 0 : 1;
	}
	if (updates.adult_content !== undefined) event.adult_content = updates.adult_content ? 1 : 0;
	if (updates.needs_laptop !== undefined) event.needs_laptop = updates.needs_laptop ? 1 : 0;
	if (updates.needs_speakers !== undefined) event.needs_speakers = updates.needs_speakers ? 1 : 0;
	if (updates.estimated_attendance !== undefined) {
		event.estimated_attendance = normalizeNullableInteger(updates.estimated_attendance);
	}
	if (updates.required_room_tags !== undefined) {
		event.required_room_tags = normalizeList(updates.required_room_tags);
	}
	if (updates.equipment_needs !== undefined) {
		event.equipment_needs = normalizeList(updates.equipment_needs);
	}
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
			tier: availMap.get(slot.id) ?? 1
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
		const normalizedTier = normalizeTier(tier, 3);
		const existing = state.availability.find(
			(a) => a.person_id === personId && a.time_slot_id === slotId
		);
		if (existing) {
			existing.tier = normalizedTier;
			existing.updated_at = timestamp;
		} else {
			state.availability.push({
				id: crypto.randomUUID(),
				person_id: personId,
				time_slot_id: slotId,
				tier: normalizedTier,
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
	return slots
		.map((slot) => ({
			...slot,
			tier: normalizeTier(slot.tier, 2)
		}))
		.sort((a, b) =>
			a.date === b.date ? a.start_time.localeCompare(b.start_time) : a.date.localeCompare(b.date)
		);
}

export function updateTimeSlot(id, updates) {
	ensureLoaded();
	const slot = state.time_slots.find((ts) => ts.id === id);
	if (!slot) return null;

	if (updates.start_time !== undefined) slot.start_time = updates.start_time;
	if (updates.end_time !== undefined) slot.end_time = updates.end_time;
	if (updates.is_active !== undefined) slot.is_active = updates.is_active ? 1 : 0;
	if (updates.tier !== undefined) slot.tier = normalizeTier(updates.tier, slot.tier ?? 2);

	persist();
	return {
		...slot,
		tier: normalizeTier(slot.tier, 2)
	};
}

function generateSlotWindowForDay(
	conventionId,
	dateStr,
	startHour,
	endHour,
	slotMinutes,
	existingKeys,
	timestamp,
	activeSlotIds
) {
	let count = 0;
	for (
		let totalMinutes = startHour * 60;
		totalMinutes < endHour * 60;
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
			existing.tier = normalizeTier(existing.tier, 2);
			activeSlotIds.add(existing.id);
		} else {
			const slot = {
				id: crypto.randomUUID(),
				convention_id: conventionId,
				date: dateStr,
				start_time: startTime,
				end_time: endTime,
				tier: 2,
				is_active: 1,
				created_at: timestamp
			};
			state.time_slots.push(slot);
			existingKeys.set(key, slot);
			activeSlotIds.add(slot.id);
		}
		count++;
	}
	return count;
}

function applyConventionSlotTiers(conventionId, slotTierSettings = []) {
	if (!Array.isArray(slotTierSettings) || slotTierSettings.length === 0) return;
	const tiersByKey = new Map(
		slotTierSettings
			.filter((slot) => slot?.date && (slot.startTime || slot.start_time))
			.map((slot) => [
				slotKey(conventionId, slot.date, slot.startTime ?? slot.start_time),
				normalizeTier(slot.tier, 2)
			])
	);
	if (tiersByKey.size === 0) return;
	for (const slot of state.time_slots) {
		if (slot.convention_id !== conventionId) continue;
		const tier = tiersByKey.get(slotKey(conventionId, slot.date, slot.start_time));
		if (tier !== undefined) slot.tier = tier;
	}
}

function pruneConventionDataForInactiveSlots(conventionId, activeSlotIds) {
	const peopleIds = new Set(
		state.people
			.filter((person) => person.convention_id === conventionId)
			.map((person) => person.id)
	);
	state.availability = state.availability.filter(
		(row) => !peopleIds.has(row.person_id) || activeSlotIds.has(row.time_slot_id)
	);

	const eventIds = new Set(
		state.events.filter((event) => event.convention_id === conventionId).map((event) => event.id)
	);
	state.schedules = state.schedules.filter((schedule) => {
		if (!eventIds.has(schedule.event_id)) return true;
		if (!activeSlotIds.has(schedule.start_time_slot_id)) return false;
		const block = getSlotBlock(conventionId, schedule.start_time_slot_id, schedule.slot_count);
		return block.length === schedule.slot_count;
	});
}

export function generateTimeSlotsForConvention(conventionId) {
	ensureLoaded();
	const convention = getConvention(conventionId);
	if (!convention) throw new Error('Nie znaleziono konwentu');

	const timestamp = now();
	let count = 0;
	const slotMinutes = Number(convention.slot_minutes) || 30;
	const dayHoursMap = getConventionDayHoursMap(convention);
	const existingKeys = new Map(
		state.time_slots
			.filter((slot) => slot.convention_id === conventionId)
			.map((slot) => [slotKey(slot.convention_id, slot.date, slot.start_time), slot])
	);
	const activeSlotIds = new Set();

	for (const slot of state.time_slots) {
		if (slot.convention_id === conventionId) slot.is_active = 0;
	}

	for (const dateStr of buildDateRange(convention.start_date, convention.end_date)) {
		const { startHour, endHour } = getConventionHoursForDate(convention, dateStr, dayHoursMap);
		count += generateSlotWindowForDay(
			conventionId,
			dateStr,
			startHour,
			endHour,
			slotMinutes,
			existingKeys,
			timestamp,
			activeSlotIds
		);
	}

	pruneConventionDataForInactiveSlots(conventionId, activeSlotIds);
	persist();
	return count;
}

function generateTimeSlotsInternal(
	conventionId,
	startDate,
	endDate,
	startHour,
	endHour,
	slotMinutes,
	dayHours = []
) {
	const timestamp = now();
	let count = 0;
	const existingKeys = new Map(
		state.time_slots
			.filter((slot) => slot.convention_id === conventionId)
			.map((slot) => [slotKey(slot.convention_id, slot.date, slot.start_time), slot])
	);
	const defaultHours = normalizeHourWindow(startHour, endHour);
	const dayHoursMap = new Map(
		normalizeConventionDayHours(
			dayHours,
			startDate,
			endDate,
			defaultHours.startHour,
			defaultHours.endHour
		).map((entry) => [entry.date, entry])
	);
	const activeSlotIds = new Set();

	for (const dateStr of buildDateRange(startDate, endDate)) {
		const dayConfig = dayHoursMap.get(dateStr);
		const hours = normalizeHourWindow(
			dayConfig?.start_hour ?? defaultHours.startHour,
			dayConfig?.end_hour ?? defaultHours.endHour,
			defaultHours.startHour,
			defaultHours.endHour
		);
		count += generateSlotWindowForDay(
			conventionId,
			dateStr,
			hours.startHour,
			hours.endHour,
			slotMinutes,
			existingKeys,
			timestamp,
			activeSlotIds
		);
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
	if (solverLookupCache) {
		return solverLookupCache.availability.get(`${personId}|${timeSlotId}`) ?? 1;
	}
	const row = state.availability.find(
		(a) => a.person_id === personId && a.time_slot_id === timeSlotId
	);
	return row?.tier ?? 1;
}

function ensureDefaultAvailabilityForPerson(personId, conventionId, timestamp, defaultTier = 1) {
	const slots = state.time_slots.filter((ts) => ts.convention_id === conventionId);
	for (const slot of slots) {
		const existing = state.availability.find(
			(a) => a.person_id === personId && a.time_slot_id === slot.id
		);
		if (!existing) {
			state.availability.push({
				id: crypto.randomUUID(),
				person_id: personId,
				time_slot_id: slot.id,
				tier: normalizeTier(defaultTier, 1),
				created_at: timestamp,
				updated_at: timestamp
			});
		}
	}
}

export function setAvailability(personId, timeSlotId, tier) {
	ensureLoaded();
	const timestamp = now();
	const normalizedTier = normalizeTier(tier, 3);
	const existing = state.availability.find(
		(a) => a.person_id === personId && a.time_slot_id === timeSlotId
	);

	if (existing) {
		existing.tier = normalizedTier;
		existing.updated_at = timestamp;
		persist();
		return existing;
	}

	const record = {
		id: crypto.randomUUID(),
		person_id: personId,
		time_slot_id: timeSlotId,
		tier: normalizedTier,
		created_at: timestamp,
		updated_at: timestamp
	};
	state.availability.push(record);
	persist();
	return record;
}

function upsertAvailability(personId, slotId, tier, timestamp) {
	const normalizedTier = normalizeTier(tier, 3);
	const existing = state.availability.find(
		(a) => a.person_id === personId && a.time_slot_id === slotId
	);
	if (existing) {
		existing.tier = Math.min(existing.tier, normalizedTier);
		existing.updated_at = timestamp;
		return existing;
	}
	const record = {
		id: crypto.randomUUID(),
		person_id: personId,
		time_slot_id: slotId,
		tier: normalizedTier,
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
		locked: schedule.locked === true,
		notes: schedule.notes,
		created_at: schedule.created_at,
		updated_at: schedule.updated_at,
		event: {
			id: event?.id,
			title: event?.title,
			kind: event?.kind,
			duration_minutes: event?.duration_minutes,
			organizer_notes: event?.organizer_notes,
			tier: normalizeTier(event?.tier, 2),
			auto_schedule: event?.auto_schedule === 0 ? 0 : 1,
			estimated_attendance: event?.estimated_attendance ?? null,
			required_room_tags: normalizeList(event?.required_room_tags),
			equipment_needs: normalizeList(event?.equipment_needs),
			host_name
		},
		room: {
			id: room?.id,
			name: room?.name,
			capabilities: normalizeRoomCapabilities(room?.capabilities)
		},
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
		locked: data.locked === true,
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

	const changesPlacement =
		(updates.room_id !== undefined && updates.room_id !== schedule.room_id) ||
		(updates.start_time_slot_id !== undefined &&
			updates.start_time_slot_id !== schedule.start_time_slot_id) ||
		(updates.slot_count !== undefined && updates.slot_count !== schedule.slot_count);
	if (schedule.locked === true && changesPlacement) {
		throw new Error('Ta pozycja jest zablokowana — odblokuj ją przed przeniesieniem');
	}

	if (updates.event_id !== undefined) schedule.event_id = updates.event_id;
	if (updates.room_id !== undefined) schedule.room_id = updates.room_id;
	if (updates.start_time_slot_id !== undefined)
		schedule.start_time_slot_id = updates.start_time_slot_id;
	if (updates.slot_count !== undefined) schedule.slot_count = updates.slot_count;
	if (updates.status !== undefined) schedule.status = updates.status;
	if (updates.locked !== undefined) schedule.locked = updates.locked === true;
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
	if (a.locked === true || b.locked === true) {
		throw new Error('Nie można zamienić zablokowanej pozycji');
	}

	const timestamp = now();
	const aRoom = a.room_id;
	const aSlot = a.start_time_slot_id;

	// Each event keeps its own duration (slot_count). Only the placement (room +
	// start slot) is exchanged, so a 2h event stays 2h after landing in a 1h
	// event's start slot — it simply spans its real length from the new start.
	a.room_id = b.room_id;
	a.start_time_slot_id = b.start_time_slot_id;
	a.updated_at = timestamp;

	b.room_id = aRoom;
	b.start_time_slot_id = aSlot;
	b.updated_at = timestamp;

	persist();
	return [getScheduleById(scheduleIdA), getScheduleById(scheduleIdB)];
}

function getSlotBlock(conventionId, startSlotId, slotCount) {
	const startSlot = state.time_slots.find((ts) => ts.id === startSlotId);
	if (!startSlot) return [];

	const daySlots = state.time_slots
		.filter(
			(ts) => ts.convention_id === conventionId && ts.date === startSlot.date && ts.is_active === 1
		)
		.sort((a, b) => a.start_time.localeCompare(b.start_time));

	const startIdx = daySlots.findIndex((s) => s.id === startSlotId);
	if (startIdx === -1) return [];
	return daySlots.slice(startIdx, startIdx + slotCount);
}

function roomBlockFree(roomId, slotIds, excludeScheduleId = null) {
	for (const slotId of slotIds) {
		const existing = state.schedules.find(
			(s) => s.room_id === roomId && s.start_time_slot_id === slotId && s.id !== excludeScheduleId
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
		.filter((ts) => ts.convention_id === conventionId && ts.date === date && ts.is_active === 1)
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

function countRoomCompactnessPenalty(entries) {
	if (!entries.length) return 0;
	if (entries.length === 1) return 1;

	const sorted = [...entries].sort((a, b) => a.startIdx - b.startIdx);
	let penalty = 0;
	let previousEnd = sorted[0].startIdx + sorted[0].slotCount;

	for (let i = 1; i < sorted.length; i++) {
		const current = sorted[i];
		if (current.startIdx > previousEnd) {
			penalty += current.startIdx - previousEnd;
		}
		previousEnd = Math.max(previousEnd, current.startIdx + current.slotCount);
	}

	return penalty;
}

const AUTO_RESHUFFLE_MAX_DEPTH = 4;
const AUTO_RESHUFFLE_TOP_LEVEL_BRANCH_LIMIT = 180;
const AUTO_RESHUFFLE_RELOCATION_BRANCH_LIMIT = 24;
const AUTO_RESHUFFLE_MAX_ATTEMPTS = 6000;
const AUTO_RESHUFFLE_PROGRESS_INTERVAL = 100;
const AUTO_SOLVER_MAX_SEARCH_NODES = 8000;
const AUTO_SOLVER_WARNING_WEIGHT = 1_000_000;
const AUTO_SOLVER_AVAILABILITY_WEIGHT = 100_000;
const AUTO_SOLVER_CAPACITY_WEIGHT = 10_000;
// T1 events should land in T1 (hype) slots. Weighted below host availability and
// hard warnings (so we never push a host into an unavailable/conflicting slot
// just to chase a hype slot) but above capacity, room-gap, tier-distance and
// ordering, so it dominates those softer goals. Finite on purpose: if no T1 slot
// is reachable, the event is still placed rather than dropped (keeps full fill).
const AUTO_SOLVER_TIER1_SLOT_WEIGHT = 50_000;
const AUTO_SOLVER_TIER_DISTANCE_WEIGHT = 1_000;
const AUTO_SOLVER_ROOM_GAP_WEIGHT = 5_000;
const AUTO_SOLVER_START_WEIGHT = 10;
const AUTO_SOLVER_FUTURE_EVAL_LIMIT = 20_000;
const AUTO_SOLVER_FULL_SEARCH_ITEM_LIMIT = 120;
const AUTO_SOLVER_FULL_SEARCH_PLACEMENT_LIMIT = 40_000;
const AUTO_SOLVER_LOCAL_SEARCH_STEP_LIMIT = 80;
const AUTO_SOLVER_LOCAL_SEARCH_MOVE_LIMIT = 6_000;
const AUTO_SOLVER_LOCAL_SEARCH_ACCEPTED_LIMIT = 24;

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

function getEventTierForScheduling(event) {
	return normalizeTier(event?.tier, 2);
}

function eventRoomFit(event, room) {
	const capabilities = normalizeRoomCapabilities(room?.capabilities);
	const requiredTags = normalizeList(event?.required_room_tags);
	const roomTags = new Set(capabilities.tags);
	const missingRequiredTags = requiredTags.filter((tag) => !roomTags.has(tag));
	const estimatedAttendance = normalizeNullableInteger(event?.estimated_attendance);
	const capacity = normalizeNullableInteger(capabilities.capacity);
	const overCapacity =
		estimatedAttendance != null && capacity != null && estimatedAttendance > capacity
			? estimatedAttendance - capacity
			: 0;
	const capacitySlack =
		estimatedAttendance != null && capacity != null && capacity >= estimatedAttendance
			? capacity - estimatedAttendance
			: 0;

	return {
		valid: missingRequiredTags.length === 0 && overCapacity === 0,
		missingRequiredTags,
		overCapacity,
		capacitySlack,
		capacity,
		estimatedAttendance
	};
}

function getTimeSlotTier(timeSlotId) {
	if (solverLookupCache) {
		const cached = solverLookupCache.slotTier.get(timeSlotId);
		if (cached !== undefined) return cached;
	}
	const slot = state.time_slots.find((timeSlot) => timeSlot.id === timeSlotId);
	return normalizeTier(slot?.tier, 2);
}

function getBlockPopularityTier(slotIds) {
	if (!slotIds.length) return 2;
	let total = 0;
	for (const slotId of slotIds) {
		total += getTimeSlotTier(slotId);
	}
	return Math.round(total / slotIds.length);
}

/**
 * Worst (highest = least popular) slot tier across a block. Used to enforce the
 * "T1 events belong in T1 slots" objective: a T1 event is only fully satisfied
 * when every slot it occupies is a T1 (hype) slot.
 */
function getBlockMaxPopularityTier(slotIds) {
	if (!slotIds.length) return 2;
	let max = 1;
	for (const slotId of slotIds) {
		max = Math.max(max, getTimeSlotTier(slotId));
	}
	return max;
}

/**
 * Magnitude of the "T1 event outside a T1 slot" violation for a placement.
 * Only T1 events are constrained; T2/T3 stay flexible (handled by the softer
 * tier-distance term). Returns 0 when the event is not T1 or sits fully in T1
 * slots, otherwise how many tiers away the worst occupied slot is from T1.
 */
function getTier1SlotViolation(eventTier, slotIds) {
	if (eventTier !== 1) return 0;
	return Math.max(0, getBlockMaxPopularityTier(slotIds) - 1);
}

function getAutoItemForEvent(event) {
	return {
		key: `new:${event.id}`,
		eventId: event.id,
		event,
		eventTier: getEventTierForScheduling(event),
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
		eventTier: getEventTierForScheduling(event),
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

function countPlanRoomGapDelta(item, placement, placements, registry) {
	const block = getPlacementBlock(item, placement);
	const date = block[0]?.date;
	const conventionId = block[0]?.convention_id;
	if (!date || !conventionId) return Number.MAX_SAFE_INTEGER;

	const daySlots = getDaySlots(conventionId, date);
	const startIdx = daySlots.findIndex((slot) => slot.id === block[0].id);
	if (startIdx < 0) return Number.MAX_SAFE_INTEGER;

	const entries = [];
	for (const other of registry.values()) {
		if (other.key === item.key) continue;

		const otherPlacement = getItemPlacement(other, placements);
		if (!otherPlacement || otherPlacement.room_id !== placement.room_id) continue;

		const otherBlock = getPlacementBlock(other, otherPlacement);
		if (otherBlock[0]?.date !== date) continue;

		const otherStartIdx = daySlots.findIndex((slot) => slot.id === otherBlock[0].id);
		if (otherStartIdx < 0) continue;

		entries.push({
			startIdx: otherStartIdx,
			slotCount: other.slotCount
		});
	}

	const currentPenalty = countRoomCompactnessPenalty(entries);
	entries.push({
		startIdx,
		slotCount: item.slotCount
	});
	return countRoomCompactnessPenalty(entries) - currentPenalty;
}

function compareAutoCandidates(a, b) {
	if (a.conflictCount !== b.conflictCount) return a.conflictCount - b.conflictCount;
	if (a.schedulingWarnings !== b.schedulingWarnings) {
		return a.schedulingWarnings - b.schedulingWarnings;
	}
	if (a.worstTier !== b.worstTier) return a.worstTier - b.worstTier;
	if (a.tier1Violation !== b.tier1Violation) return a.tier1Violation - b.tier1Violation;
	if (a.capacitySlack !== b.capacitySlack) return a.capacitySlack - b.capacitySlack;
	if (a.tierDistance !== b.tierDistance) return a.tierDistance - b.tierDistance;
	if (a.roomGapDelta !== b.roomGapDelta) return a.roomGapDelta - b.roomGapDelta;
	if (a.startSlot.date !== b.startSlot.date)
		return a.startSlot.date.localeCompare(b.startSlot.date);
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
		const roomFit = eventRoomFit(item.event, room);
		if (!roomFit.valid) continue;
		for (const [, daySlots] of slotsByDate) {
			for (let i = 0; i <= daySlots.length - item.slotCount; i++) {
				const block = daySlots.slice(i, i + item.slotCount);
				const slotIds = block.map((slot) => slot.id);
				const worstTier = getPlacementWorstTier(item, slotIds);
				if (worstTier === 3) continue;
				const slotTier = getBlockPopularityTier(slotIds);
				const tierDistance = Math.abs(slotTier - item.eventTier);

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
					tier1Violation: getTier1SlotViolation(item.eventTier, slotIds),
					slotTier,
					tierDistance,
					capacitySlack: roomFit.capacitySlack,
					conflictCount: conflicts.length,
					conflicts,
					schedulingWarnings: countPlanPlacementWarnings(item, placement, placements, registry),
					roomGapDelta: countPlanRoomGapDelta(item, placement, placements, registry)
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

function placementSearchSignature(item, placements, depth, lockedKeys) {
	const placementParts = [...placements.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, placement]) => `${key}:${placement.room_id}/${placement.start_time_slot_id}`);
	return [item.key, depth, [...lockedKeys].sort().join(','), placementParts.join('|')].join('::');
}

async function placeAutoItem(
	item,
	placements,
	registry,
	depth,
	lockedKeys,
	search,
	isRoot = false
) {
	search.attempts++;
	if (search.attempts > AUTO_RESHUFFLE_MAX_ATTEMPTS) return null;
	await reportSearchProgress(search);

	const signature = placementSearchSignature(item, placements, depth, lockedKeys);
	if (search.deadEnds.has(signature)) return null;

	const branchLimit = isRoot
		? AUTO_RESHUFFLE_TOP_LEVEL_BRANCH_LIMIT
		: AUTO_RESHUFFLE_RELOCATION_BRANCH_LIMIT;
	const candidates = buildAutoScheduleCandidates(item, placements, registry).slice(0, branchLimit);

	for (const candidate of candidates) {
		const nextPlacements = new Map(placements);
		nextPlacements.set(item.key, {
			room_id: candidate.room_id,
			start_time_slot_id: candidate.start_time_slot_id
		});

		let conflicts = candidate.conflicts;
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
		if (
			conflicts &&
			conflicts.every((conflict) => !lockedKeys.has(conflict.key)) &&
			conflicts.length === 0
		) {
			return resolvedPlacements;
		}
	}

	search.deadEnds.add(signature);
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
			deadEnds: new Set(),
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
		locked: false,
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
				if (
					getPlacementWorstTier(
						item,
						block.map((slot) => slot.id)
					) < 3
				) {
					count++;
				}
			}
		}
	}

	return count;
}

function getSolverFixedSchedules(conventionId, autoEventIds) {
	return state.schedules.filter((schedule) => {
		const event = state.events.find((e) => e.id === schedule.event_id);
		return event?.convention_id === conventionId && !autoEventIds.has(schedule.event_id);
	});
}

function addSolverOccupancyForPlacement(occupancy, placement) {
	for (const key of placement.roomKeys) occupancy.room.add(key);
	for (const key of placement.hostKeys) occupancy.host.add(key);
	for (const entry of placement.hostDateEntries) {
		const key = `${entry.hostId}|${entry.date}`;
		if (!occupancy.hostDates.has(key)) occupancy.hostDates.set(key, []);
		occupancy.hostDates.get(key).push(entry);
	}
	for (const entry of placement.roomDateEntries || []) {
		const key = `${entry.roomId}|${entry.date}`;
		if (!occupancy.roomDates.has(key)) occupancy.roomDates.set(key, []);
		occupancy.roomDates.get(key).push(entry);
	}
}

function removeSolverOccupancyForPlacement(occupancy, placement) {
	for (const key of placement.roomKeys) occupancy.room.delete(key);
	for (const key of placement.hostKeys) occupancy.host.delete(key);
	for (const entry of placement.hostDateEntries) {
		const key = `${entry.hostId}|${entry.date}`;
		const entries = occupancy.hostDates.get(key) || [];
		const idx = entries.lastIndexOf(entry);
		if (idx >= 0) entries.splice(idx, 1);
		if (entries.length === 0) occupancy.hostDates.delete(key);
	}
	for (const entry of placement.roomDateEntries || []) {
		const key = `${entry.roomId}|${entry.date}`;
		const entries = occupancy.roomDates.get(key) || [];
		const idx = entries.lastIndexOf(entry);
		if (idx >= 0) entries.splice(idx, 1);
		if (entries.length === 0) occupancy.roomDates.delete(key);
	}
}

function solverPlacementConflicts(occupancy, placement) {
	return (
		placement.roomKeys.some((key) => occupancy.room.has(key)) ||
		placement.hostKeys.some((key) => occupancy.host.has(key))
	);
}

function solverWarningDelta(occupancy, placement) {
	let delta = 0;
	for (const entry of placement.hostDateEntries) {
		const key = `${entry.hostId}|${entry.date}`;
		const current = occupancy.hostDates.get(key) || [];
		delta +=
			countHostSchedulingWarnings([...current, entry]) - countHostSchedulingWarnings(current);
	}
	return delta;
}

function solverRoomGapDelta(occupancy, placement) {
	let delta = 0;
	for (const entry of placement.roomDateEntries || []) {
		const key = `${entry.roomId}|${entry.date}`;
		const current = occupancy.roomDates.get(key) || [];
		delta +=
			countRoomCompactnessPenalty([...current, entry]) - countRoomCompactnessPenalty(current);
	}
	return delta;
}

function solverPlacementScore(occupancy, placement) {
	return (
		solverWarningDelta(occupancy, placement) * AUTO_SOLVER_WARNING_WEIGHT +
		placement.worstTier * AUTO_SOLVER_AVAILABILITY_WEIGHT +
		(placement.tier1Violation ?? 0) * AUTO_SOLVER_TIER1_SLOT_WEIGHT +
		placement.capacitySlack * AUTO_SOLVER_CAPACITY_WEIGHT +
		placement.tierDistance * AUTO_SOLVER_TIER_DISTANCE_WEIGHT +
		solverRoomGapDelta(occupancy, placement) * AUTO_SOLVER_ROOM_GAP_WEIGHT +
		placement.startOrder * AUTO_SOLVER_START_WEIGHT +
		placement.roomOrder
	);
}

function solverFutureStats(occupancy, placement, rest, domains) {
	addSolverOccupancyForPlacement(occupancy, placement);
	let blockedItems = 0;
	let totalFeasible = 0;
	let tightestFeasible = Number.MAX_SAFE_INTEGER;

	for (const item of rest) {
		let feasibleCount = 0;
		for (const candidate of domains.get(item.key) || []) {
			if (!solverPlacementConflicts(occupancy, candidate)) feasibleCount++;
		}
		if (feasibleCount === 0) blockedItems++;
		totalFeasible += feasibleCount;
		tightestFeasible = Math.min(tightestFeasible, feasibleCount);
	}

	removeSolverOccupancyForPlacement(occupancy, placement);
	return {
		blockedItems,
		totalFeasible,
		tightestFeasible: rest.length ? tightestFeasible : 0
	};
}

function rankSolverPlacements(placements, occupancy, rest, domains) {
	const scored = placements.map((placement) => ({
		placement,
		score: solverPlacementScore(occupancy, placement)
	}));

	if (placements.length * Math.max(1, rest.length) > AUTO_SOLVER_FUTURE_EVAL_LIMIT) {
		return scored.sort((a, b) => a.score - b.score);
	}

	return scored
		.map((candidate) => ({
			...candidate,
			future: solverFutureStats(occupancy, candidate.placement, rest, domains)
		}))
		.sort((a, b) => {
			if (a.future.blockedItems !== b.future.blockedItems) {
				return a.future.blockedItems - b.future.blockedItems;
			}
			if (a.future.tightestFeasible !== b.future.tightestFeasible) {
				return b.future.tightestFeasible - a.future.tightestFeasible;
			}
			if (a.future.totalFeasible !== b.future.totalFeasible) {
				return b.future.totalFeasible - a.future.totalFeasible;
			}
			return a.score - b.score;
		});
}

function buildSolverInitialOccupancy(conventionId, autoEventIds) {
	const occupancy = {
		room: new Set(),
		host: new Set(),
		hostDates: new Map(),
		roomDates: new Map()
	};

	for (const schedule of getSolverFixedSchedules(conventionId, autoEventIds)) {
		const event = state.events.find((e) => e.id === schedule.event_id);
		if (!event) continue;
		const block = getSlotBlock(conventionId, schedule.start_time_slot_id, schedule.slot_count);
		const hostIds = getEventHostIds(schedule.event_id);
		const date = block[0]?.date;
		const startIdx = getDaySlots(conventionId, date).findIndex((slot) => slot.id === block[0]?.id);
		addSolverOccupancyForPlacement(occupancy, {
			roomKeys: block.map((slot) => `${schedule.room_id}|${slot.id}`),
			hostKeys: hostIds.flatMap((hostId) => block.map((slot) => `${hostId}|${slot.id}`)),
			hostDateEntries: hostIds
				.map((hostId) => ({
					hostId,
					date,
					startIdx,
					slotCount: schedule.slot_count,
					roomId: schedule.room_id
				}))
				.filter((entry) => entry.date && entry.startIdx >= 0),
			roomDateEntries:
				date && startIdx >= 0
					? [
							{
								roomId: schedule.room_id,
								date,
								startIdx,
								slotCount: schedule.slot_count
							}
						]
					: []
		});
	}

	return occupancy;
}

function buildSolverPlacementsForItem(item, rooms, daySlotsByDate, occupancy) {
	const placements = [];
	let roomOrder = 0;
	for (const room of rooms) {
		const roomFit = eventRoomFit(item.event, room);
		if (!roomFit.valid) {
			roomOrder++;
			continue;
		}
		let dayOrder = 0;
		for (const [date, daySlots] of daySlotsByDate) {
			for (let i = 0; i <= daySlots.length - item.slotCount; i++) {
				const block = daySlots.slice(i, i + item.slotCount);
				const slotIds = block.map((slot) => slot.id);
				const worstTier = getPlacementWorstTier(item, slotIds);
				if (worstTier === 3) continue;
				const slotTier = getBlockPopularityTier(slotIds);
				const placement = {
					item,
					room_id: room.id,
					start_time_slot_id: block[0].id,
					slot_count: item.slotCount,
					worstTier,
					tier1Violation: getTier1SlotViolation(item.eventTier, slotIds),
					tierDistance: Math.abs(slotTier - item.eventTier),
					capacitySlack: roomFit.capacitySlack,
					roomOrder,
					roomKeys: block.map((slot) => `${room.id}|${slot.id}`),
					hostKeys: item.hostIds.flatMap((hostId) => block.map((slot) => `${hostId}|${slot.id}`)),
					hostDateEntries: item.hostIds.map((hostId) => ({
						hostId,
						date,
						startIdx: i,
						slotCount: item.slotCount,
						roomId: room.id
					})),
					roomDateEntries: [
						{
							roomId: room.id,
							date,
							startIdx: i,
							slotCount: item.slotCount
						}
					],
					startOrder: dayOrder * 1000 + i
				};
				if (!solverPlacementConflicts(occupancy, placement)) placements.push(placement);
			}
			dayOrder++;
		}
		roomOrder++;
	}
	return placements.sort((a, b) => {
		if (a.worstTier !== b.worstTier) return a.worstTier - b.worstTier;
		if (a.tier1Violation !== b.tier1Violation) return a.tier1Violation - b.tier1Violation;
		if (a.capacitySlack !== b.capacitySlack) return a.capacitySlack - b.capacitySlack;
		if (a.tierDistance !== b.tierDistance) return a.tierDistance - b.tierDistance;
		if (a.startOrder !== b.startOrder) return a.startOrder - b.startOrder;
		return a.roomOrder - b.roomOrder;
	});
}

function cloneSolverPlan(plan) {
	return new Map(plan);
}

function cloneSolverOccupancy(occupancy) {
	return {
		room: new Set(occupancy.room),
		host: new Set(occupancy.host),
		hostDates: new Map([...occupancy.hostDates].map(([key, entries]) => [key, [...entries]])),
		roomDates: new Map([...occupancy.roomDates].map(([key, entries]) => [key, [...entries]]))
	};
}

function compareSolverItems(a, b, domains) {
	const aOptions = domains.get(a.key)?.length ?? 0;
	const bOptions = domains.get(b.key)?.length ?? 0;
	if (aOptions !== bOptions) return aOptions - bOptions;

	const aRequiredTags = normalizeList(a.event?.required_room_tags).length;
	const bRequiredTags = normalizeList(b.event?.required_room_tags).length;
	if (aRequiredTags !== bRequiredTags) return bRequiredTags - aRequiredTags;
	if (a.slotCount !== b.slotCount) return b.slotCount - a.slotCount;
	if (a.hostIds.length !== b.hostIds.length) return b.hostIds.length - a.hostIds.length;
	if (a.eventTier !== b.eventTier) return a.eventTier - b.eventTier;
	return a.event.title.localeCompare(b.event.title);
}

function solveGreedyAutoSchedule(items, domains, baseOccupancy) {
	const occupancy = cloneSolverOccupancy(baseOccupancy);
	const plan = new Map();
	let score = 0;
	const ordered = [...items].sort((a, b) => compareSolverItems(a, b, domains));

	for (const item of ordered) {
		const feasible = domains
			.get(item.key)
			.filter((placement) => !solverPlacementConflicts(occupancy, placement));
		if (feasible.length === 0) continue;
		const rest = ordered.filter((other) => other.key !== item.key && !plan.has(other.key));
		const best = rankSolverPlacements(feasible, occupancy, rest, domains)[0];
		const placement = best.placement;
		score += best.score;
		plan.set(item.key, placement);
		addSolverOccupancyForPlacement(occupancy, placement);
	}

	return { plan, scheduledCount: plan.size, score };
}

function solveFastGreedyAutoSchedule(items, domains, baseOccupancy) {
	const occupancy = cloneSolverOccupancy(baseOccupancy);
	const plan = new Map();
	let score = 0;
	const ordered = [...items].sort((a, b) => compareSolverItems(a, b, domains));

	for (const item of ordered) {
		let best = null;
		let bestScore = Number.POSITIVE_INFINITY;
		for (const placement of domains.get(item.key)) {
			if (solverPlacementConflicts(occupancy, placement)) continue;
			const placementScore = solverPlacementScore(occupancy, placement);
			if (placementScore < bestScore) {
				best = placement;
				bestScore = placementScore;
			}
		}
		if (!best) continue;
		plan.set(item.key, best);
		score += bestScore;
		addSolverOccupancyForPlacement(occupancy, best);
	}

	return { plan, scheduledCount: plan.size, score };
}

function solverStateSignature(unassigned, occupancy) {
	return [
		unassigned
			.map((item) => item.key)
			.sort()
			.join(','),
		[...occupancy.room].sort().join(','),
		[...occupancy.host].sort().join(',')
	].join('::');
}

function solveBranchAndBoundAutoSchedule(items, domains, baseOccupancy, seed) {
	const best = {
		plan: cloneSolverPlan(seed.plan),
		scheduledCount: seed.scheduledCount,
		score: seed.score
	};
	if (best.scheduledCount === items.length) return best;

	const occupancy = cloneSolverOccupancy(baseOccupancy);
	const plan = new Map();
	const dead = new Set();
	let nodes = 0;

	function search(unassigned, score) {
		nodes++;
		if (nodes > AUTO_SOLVER_MAX_SEARCH_NODES) return;
		if (plan.size + unassigned.length < best.scheduledCount) return;
		if (plan.size + unassigned.length === best.scheduledCount && score >= best.score) return;

		if (unassigned.length === 0) {
			if (
				plan.size > best.scheduledCount ||
				(plan.size === best.scheduledCount && score < best.score)
			) {
				best.plan = cloneSolverPlan(plan);
				best.scheduledCount = plan.size;
				best.score = score;
			}
			return;
		}

		const signature = solverStateSignature(unassigned, occupancy);
		if (dead.has(signature)) return;

		let selected = null;
		let selectedFeasible = null;
		for (const item of unassigned) {
			const feasible = domains
				.get(item.key)
				.filter((placement) => !solverPlacementConflicts(occupancy, placement));
			if (
				!selected ||
				feasible.length < selectedFeasible.length ||
				(feasible.length === selectedFeasible.length &&
					compareSolverItems(item, selected, domains) < 0)
			) {
				selected = item;
				selectedFeasible = feasible;
			}
		}

		const rest = unassigned.filter((item) => item.key !== selected.key);
		const rankedPlacements = rankSolverPlacements(selectedFeasible, occupancy, rest, domains);

		for (const { placement, score: placementScore } of rankedPlacements) {
			plan.set(selected.key, placement);
			addSolverOccupancyForPlacement(occupancy, placement);

			const impossible = rest.some((item) =>
				domains.get(item.key).every((candidate) => solverPlacementConflicts(occupancy, candidate))
			);
			if (!impossible || plan.size + rest.length > best.scheduledCount) {
				search(rest, score + placementScore);
			}

			removeSolverOccupancyForPlacement(occupancy, placement);
			plan.delete(selected.key);
		}

		search(rest, score);
		dead.add(signature);
	}

	search(items, 0);
	return best;
}

function solverStaticPlacementScore(placement) {
	return (
		placement.worstTier * AUTO_SOLVER_AVAILABILITY_WEIGHT +
		(placement.tier1Violation ?? 0) * AUTO_SOLVER_TIER1_SLOT_WEIGHT +
		placement.capacitySlack * AUTO_SOLVER_CAPACITY_WEIGHT +
		placement.tierDistance * AUTO_SOLVER_TIER_DISTANCE_WEIGHT +
		placement.startOrder * AUTO_SOLVER_START_WEIGHT +
		placement.roomOrder
	);
}

function entriesWithoutIdentity(entries, entry) {
	const next = [...entries];
	const idx = next.lastIndexOf(entry);
	if (idx >= 0) next.splice(idx, 1);
	return next;
}

function solverPlacementRemovalScoreDelta(occupancy, placement) {
	let delta = -solverStaticPlacementScore(placement);

	for (const entry of placement.hostDateEntries || []) {
		const key = `${entry.hostId}|${entry.date}`;
		const current = occupancy.hostDates.get(key) || [];
		delta +=
			(countHostSchedulingWarnings(entriesWithoutIdentity(current, entry)) -
				countHostSchedulingWarnings(current)) *
			AUTO_SOLVER_WARNING_WEIGHT;
	}

	for (const entry of placement.roomDateEntries || []) {
		const key = `${entry.roomId}|${entry.date}`;
		const current = occupancy.roomDates.get(key) || [];
		delta +=
			(countRoomCompactnessPenalty(entriesWithoutIdentity(current, entry)) -
				countRoomCompactnessPenalty(current)) *
			AUTO_SOLVER_ROOM_GAP_WEIGHT;
	}

	return delta;
}

function scoreSolverPlan(plan, baseOccupancy) {
	const occupancy = cloneSolverOccupancy(baseOccupancy);
	let score = 0;

	for (const placement of plan.values()) {
		score += solverStaticPlacementScore(placement);
		addSolverOccupancyForPlacement(occupancy, placement);
	}

	for (const [key, entries] of occupancy.hostDates) {
		score +=
			(countHostSchedulingWarnings(entries) -
				countHostSchedulingWarnings(baseOccupancy.hostDates.get(key) || [])) *
			AUTO_SOLVER_WARNING_WEIGHT;
	}
	for (const [key, entries] of occupancy.roomDates) {
		score +=
			(countRoomCompactnessPenalty(entries) -
				countRoomCompactnessPenalty(baseOccupancy.roomDates.get(key) || [])) *
			AUTO_SOLVER_ROOM_GAP_WEIGHT;
	}

	return score;
}

function buildSolverOccupancyForPlan(baseOccupancy, plan, excludedKeys = new Set()) {
	const occupancy = cloneSolverOccupancy(baseOccupancy);
	for (const [key, placement] of plan) {
		if (!excludedKeys.has(key)) addSolverOccupancyForPlacement(occupancy, placement);
	}
	return occupancy;
}

function findMatchingPlacement(domains, itemKey, placement) {
	return (domains.get(itemKey) || []).find(
		(candidate) =>
			candidate.room_id === placement.room_id &&
			candidate.start_time_slot_id === placement.start_time_slot_id
	);
}

function evaluateLocalSearchChangeMove(occupancy, score, current, candidate) {
	const removeDelta = solverPlacementRemovalScoreDelta(occupancy, current);
	removeSolverOccupancyForPlacement(occupancy, current);

	let candidateScore = Number.POSITIVE_INFINITY;
	if (!solverPlacementConflicts(occupancy, candidate)) {
		candidateScore = score + removeDelta + solverPlacementScore(occupancy, candidate);
	}

	addSolverOccupancyForPlacement(occupancy, current);
	return candidateScore;
}

function evaluateLocalSearchSwapMove(
	occupancy,
	score,
	leftCurrent,
	rightCurrent,
	leftSwap,
	rightSwap
) {
	const leftRemoveDelta = solverPlacementRemovalScoreDelta(occupancy, leftCurrent);
	removeSolverOccupancyForPlacement(occupancy, leftCurrent);
	const rightRemoveDelta = solverPlacementRemovalScoreDelta(occupancy, rightCurrent);
	removeSolverOccupancyForPlacement(occupancy, rightCurrent);

	let candidateScore = Number.POSITIVE_INFINITY;
	let leftAdded = false;
	if (!solverPlacementConflicts(occupancy, leftSwap)) {
		const leftAddDelta = solverPlacementScore(occupancy, leftSwap);
		addSolverOccupancyForPlacement(occupancy, leftSwap);
		leftAdded = true;
		if (!solverPlacementConflicts(occupancy, rightSwap)) {
			candidateScore =
				score +
				leftRemoveDelta +
				rightRemoveDelta +
				leftAddDelta +
				solverPlacementScore(occupancy, rightSwap);
		}
	}

	if (leftAdded) removeSolverOccupancyForPlacement(occupancy, leftSwap);
	addSolverOccupancyForPlacement(occupancy, rightCurrent);
	addSolverOccupancyForPlacement(occupancy, leftCurrent);
	return candidateScore;
}

function applyLocalSearchMove(occupancy, plan, move) {
	if (move.type === 'change') {
		const current = plan.get(move.itemKey);
		removeSolverOccupancyForPlacement(occupancy, current);
		plan.set(move.itemKey, move.placement);
		addSolverOccupancyForPlacement(occupancy, move.placement);
		return;
	}

	removeSolverOccupancyForPlacement(occupancy, plan.get(move.leftKey));
	removeSolverOccupancyForPlacement(occupancy, plan.get(move.rightKey));
	plan.set(move.leftKey, move.leftPlacement);
	plan.set(move.rightKey, move.rightPlacement);
	addSolverOccupancyForPlacement(occupancy, move.leftPlacement);
	addSolverOccupancyForPlacement(occupancy, move.rightPlacement);
}

function improveAutoScheduleWithLocalSearch(items, domains, baseOccupancy, seed) {
	if (seed.plan.size <= 1) {
		return {
			...seed,
			score: scoreSolverPlan(seed.plan, baseOccupancy)
		};
	}

	const itemByKey = new Map(items.map((item) => [item.key, item]));
	const plan = cloneSolverPlan(seed.plan);
	const scheduledItems = [...plan.keys()]
		.map((key) => itemByKey.get(key))
		.filter(Boolean)
		.sort((a, b) => compareSolverItems(a, b, domains));
	let score = scoreSolverPlan(plan, baseOccupancy);
	const occupancy = buildSolverOccupancyForPlan(baseOccupancy, plan);
	let evaluatedMoves = 0;

	for (let step = 0; step < AUTO_SOLVER_LOCAL_SEARCH_STEP_LIMIT; step++) {
		let bestMove = null;
		let bestScore = score;
		let acceptedMoves = 0;

		searchMoves: {
			for (const item of scheduledItems) {
				const current = plan.get(item.key);
				for (const candidate of domains.get(item.key) || []) {
					if (
						candidate.room_id === current.room_id &&
						candidate.start_time_slot_id === current.start_time_slot_id
					) {
						continue;
					}
					if (evaluatedMoves++ >= AUTO_SOLVER_LOCAL_SEARCH_MOVE_LIMIT) break searchMoves;

					const candidateScore = evaluateLocalSearchChangeMove(
						occupancy,
						score,
						current,
						candidate
					);
					if (candidateScore < bestScore) {
						bestMove = { type: 'change', itemKey: item.key, placement: candidate };
						bestScore = candidateScore;
						acceptedMoves++;
						if (acceptedMoves >= AUTO_SOLVER_LOCAL_SEARCH_ACCEPTED_LIMIT) break searchMoves;
					}
				}
			}

			for (let i = 0; i < scheduledItems.length; i++) {
				const left = scheduledItems[i];
				const leftCurrent = plan.get(left.key);
				for (let j = i + 1; j < scheduledItems.length; j++) {
					if (evaluatedMoves++ >= AUTO_SOLVER_LOCAL_SEARCH_MOVE_LIMIT) break searchMoves;
					const right = scheduledItems[j];
					const rightCurrent = plan.get(right.key);
					const leftSwap = findMatchingPlacement(domains, left.key, rightCurrent);
					const rightSwap = findMatchingPlacement(domains, right.key, leftCurrent);
					if (!leftSwap || !rightSwap) continue;

					const candidateScore = evaluateLocalSearchSwapMove(
						occupancy,
						score,
						leftCurrent,
						rightCurrent,
						leftSwap,
						rightSwap
					);

					if (candidateScore < bestScore) {
						bestMove = {
							type: 'swap',
							leftKey: left.key,
							rightKey: right.key,
							leftPlacement: leftSwap,
							rightPlacement: rightSwap
						};
						bestScore = candidateScore;
						acceptedMoves++;
						if (acceptedMoves >= AUTO_SOLVER_LOCAL_SEARCH_ACCEPTED_LIMIT) break searchMoves;
					}
				}
			}
		}

		if (!bestMove) break;
		applyLocalSearchMove(occupancy, plan, bestMove);
		score = bestScore;
		if (evaluatedMoves >= AUTO_SOLVER_LOCAL_SEARCH_MOVE_LIMIT) break;
	}

	return {
		plan,
		scheduledCount: plan.size,
		score
	};
}

function solveAutoScheduleConvention(conventionId, events) {
	// Hot O(1) lookups for the duration of this fully synchronous solve. No
	// availability/slot mutations happen in between, so the cache stays valid.
	solverLookupCache = buildSolverLookupCache(conventionId);
	try {
		const autoEventIds = new Set(events.map((event) => event.id));
		const baseOccupancy = buildSolverInitialOccupancy(conventionId, autoEventIds);
		const rooms = getRooms(conventionId);
		const daySlotsByDate = buildSlotIndex(conventionId);
		const items = events.map(getAutoItemForEvent);
		const domains = new Map(
			items.map((item) => [
				item.key,
				buildSolverPlacementsForItem(item, rooms, daySlotsByDate, baseOccupancy)
			])
		);
		const totalPlacementCount = [...domains.values()].reduce(
			(total, placements) => total + placements.length,
			0
		);
		if (
			items.length > AUTO_SOLVER_FULL_SEARCH_ITEM_LIMIT ||
			totalPlacementCount > AUTO_SOLVER_FULL_SEARCH_PLACEMENT_LIMIT
		) {
			const seed = solveFastGreedyAutoSchedule(items, domains, baseOccupancy);
			return {
				items,
				domains,
				best: improveAutoScheduleWithLocalSearch(items, domains, baseOccupancy, seed)
			};
		}
		const seed = solveGreedyAutoSchedule(items, domains, baseOccupancy);
		const best = improveAutoScheduleWithLocalSearch(
			items,
			domains,
			baseOccupancy,
			solveBranchAndBoundAutoSchedule(items, domains, baseOccupancy, seed)
		);
		return { items, domains, best };
	} finally {
		solverLookupCache = null;
	}
}

function buildSolverLookupCache(conventionId) {
	const availability = new Map();
	for (const a of state.availability) {
		availability.set(`${a.person_id}|${a.time_slot_id}`, a.tier);
	}
	const slotTier = new Map();
	for (const ts of state.time_slots) {
		if (ts.convention_id !== conventionId) continue;
		slotTier.set(ts.id, normalizeTier(ts.tier, 2));
	}
	return { availability, slotTier };
}

function compareAutoScheduleEvents(a, b, placementCounts) {
	const aOptions = placementCounts.get(a.id) ?? 0;
	const bOptions = placementCounts.get(b.id) ?? 0;
	if (aOptions !== bOptions) return aOptions - bOptions;
	const aTier = getEventTierForScheduling(a);
	const bTier = getEventTierForScheduling(b);
	if (aTier !== bTier) return aTier - bTier;
	if (b.duration_minutes !== a.duration_minutes) return b.duration_minutes - a.duration_minutes;
	return (
		getEventHostIds(b.id).length - getEventHostIds(a.id).length || a.title.localeCompare(b.title)
	);
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
	if (event.auto_schedule === 0) throw new Error('Atrakcja wyłączona z auto-planowania');

	const plan = await findAutoSchedulePlan(event, onProgress, progress);
	if (!plan) throw new Error('Brak wolnego terminu dla tej atrakcji');

	return applyAutoSchedulePlan(plan);
}

export async function autoScheduleAll(conventionId, onProgress = null) {
	ensureLoaded();
	const autoEvents = state.events.filter(
		(event) => event.convention_id === conventionId && event.auto_schedule !== 0
	);
	const eventIds = new Set(autoEvents.map((e) => e.id));
	const originalState = JSON.parse(JSON.stringify(state));
	const originalScheduledCount = state.schedules.filter((schedule) =>
		eventIds.has(schedule.event_id)
	).length;

	state.schedules = state.schedules.filter((schedule) => !eventIds.has(schedule.event_id));
	if (onProgress) {
		await onProgress({
			current: 0,
			total: autoEvents.length,
			phase: 'Budowanie kandydatów auto-planu...'
		});
		await yieldToBrowser();
	}

	const { items, domains, best } = solveAutoScheduleConvention(conventionId, autoEvents);
	const successes = [];
	const errors = [];
	const timestamp = now();
	const itemByKey = new Map(items.map((item) => [item.key, item]));
	let applied = 0;

	for (const [key, placement] of best.plan) {
		const item = itemByKey.get(key);
		if (!item) continue;
		if (onProgress) {
			await onProgress({
				current: applied,
				total: autoEvents.length,
				event: item.event,
				phase: `Zapisywanie (${applied + 1}/${autoEvents.length}): ${item.event.title}`
			});
		}

		const id = crypto.randomUUID();
		state.schedules.push({
			id,
			event_id: item.eventId,
			room_id: placement.room_id,
			start_time_slot_id: placement.start_time_slot_id,
			slot_count: item.slotCount,
			status: 'scheduled',
			locked: false,
			notes: null,
			created_at: timestamp,
			updated_at: timestamp
		});
		successes.push({ event: item.event, schedule: getScheduleById(id) });
		applied++;

		if (onProgress) {
			await onProgress({
				current: applied,
				total: autoEvents.length,
				event: item.event,
				phase: `Zaplanowano (${applied}/${autoEvents.length}): ${item.event.title}`
			});
		}
	}

	for (const event of autoEvents) {
		if (best.plan.has(`new:${event.id}`)) continue;
		const candidates = domains.get(`new:${event.id}`) || [];
		errors.push({
			event,
			error:
				candidates.length === 0
					? 'Brak poprawnych kandydatów'
					: 'Nie znaleziono miejsca w najlepszym planie'
		});
	}

	persist();
	const scheduledCount = state.schedules.filter((schedule) =>
		eventIds.has(schedule.event_id)
	).length;
	if (scheduledCount < originalScheduledCount) {
		state = originalState;
		persist();
		return {
			successes: [],
			errors: autoEvents.map((event) => ({
				event,
				error: 'Przebudowa grafiku nie poprawiła liczby zaplanowanych atrakcji'
			})),
			totalProcessed: autoEvents.length,
			restored: true
		};
	}

	return { successes, errors, totalProcessed: autoEvents.length, restored: false };
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
	const room = state.rooms.find((r) => r.id === roomId);
	if (!room) return { valid: false, reason: 'Nie znaleziono sali' };

	const convention = getConvention(event.convention_id);
	const slotCount = Math.ceil(event.duration_minutes / convention.slot_minutes);
	const hostIds = event.hosts.map((h) => h.id);
	const block = getSlotBlock(event.convention_id, startTimeSlotId, slotCount);
	const slotIds = block.map((s) => s.id);
	const roomFit = eventRoomFit(event, room);

	if (block.length < slotCount) {
		return { valid: false, reason: 'Za mało kolejnych slotów' };
	}
	if (roomFit.overCapacity > 0) {
		return {
			valid: false,
			reason: `Sala za mała: ${roomFit.estimatedAttendance} osób na ${roomFit.capacity} miejsc`
		};
	}
	if (roomFit.missingRequiredTags.length > 0) {
		return {
			valid: false,
			reason: `Brak wymaganych tagów sali: ${roomFit.missingRequiredTags.join(', ')}`
		};
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

	const eventTier = getEventTierForScheduling(event);
	const slotTier = getBlockPopularityTier(slotIds);
	const tierMismatch = Math.abs(eventTier - slotTier);

	return {
		valid: true,
		worstTier,
		eventTier,
		slotTier,
		tierMismatch,
		roomFit,
		warning: null,
		info: tierMismatch > 0 ? `Tier atrakcji T${eventTier} nie pasuje do slotu T${slotTier}` : null
	};
}

/**
 * @param {PreviewResult} preview
 * @param {object} options
 */
export function executeImportFromPreview(preview, options) {
	ensureLoaded();
	const { conventionConfig, valueMappings = {}, roomNames = DEFAULT_ROOM_NAMES } = options;
	const timestamp = now();
	const conventionId = crypto.randomUUID();
	const slotMinutes = Number(conventionConfig.slotMinutes) || 30;
	const dayHours = normalizeConventionDayHours(
		conventionConfig.daySettings,
		conventionConfig.startDate,
		conventionConfig.endDate,
		8,
		22
	);
	const defaultHours = deriveGlobalHoursFromDayHours(dayHours);

	state.conventions.push({
		id: conventionId,
		name: conventionConfig.name,
		start_date: conventionConfig.startDate,
		end_date: conventionConfig.endDate,
		slot_minutes: slotMinutes,
		day_start_hour: defaultHours.startHour,
		day_end_hour: defaultHours.endHour,
		day_hours: dayHours,
		created_at: timestamp,
		updated_at: timestamp
	});

	const slotCount = generateTimeSlotsInternal(
		conventionId,
		conventionConfig.startDate,
		conventionConfig.endDate,
		defaultHours.startHour,
		defaultHours.endHour,
		slotMinutes,
		dayHours
	);
	applyConventionSlotTiers(conventionId, conventionConfig.slotTierSettings);

	const slotsByDateTime = buildSlotIndex(conventionId);
	const conventionSlotIds = state.time_slots
		.filter((ts) => ts.convention_id === conventionId)
		.map((ts) => ts.id);

	for (const roomName of roomNames) {
		state.rooms.push(roomRecord(conventionId, roomName, timestamp));
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
				tier: normalizeTier(event.tier, 2),
				auto_schedule: event.auto_schedule === false || event.auto_schedule === 0 ? 0 : 1,
				adult_content: event.adult_content ? 1 : 0,
				needs_laptop: event.needs_laptop ? 1 : 0,
				needs_speakers: event.needs_speakers ? 1 : 0,
				estimated_attendance: normalizeNullableInteger(event.estimated_attendance),
				required_room_tags: normalizeList(event.required_room_tags),
				equipment_needs: normalizeList(event.equipment_needs),
				source_row_hash: event.source_row_hash,
				created_at: timestamp,
				updated_at: timestamp
			});

			state.event_hosts.push({ event_id: eventId, person_id: personId });

			const tierSlots = expandAvailabilityToSlots(event.availability, slotsByDateTime, slotMinutes);

			for (const { slotId, tier } of tierSlots) {
				upsertAvailability(personId, slotId, tier, timestamp);
				availabilityCount++;
			}
		}

		// Realistic availability: when a person declared specific windows that
		// resolve to some — but not all — of the convention slots, treat the
		// remaining slots as unavailable (tier 3) instead of silently defaulting
		// them to "available". People who picked "whole convention" / "rather
		// not", or whose answer produced no usable slots, stay available
		// everywhere (tier 1) so the plan can still be fully filled.
		const declaredSlotIds = new Set(
			state.availability.filter((a) => a.person_id === personId).map((a) => a.time_slot_id)
		);
		if (declaredSlotIds.size > 0 && declaredSlotIds.size < conventionSlotIds.length) {
			for (const slotId of conventionSlotIds) {
				if (!declaredSlotIds.has(slotId)) {
					upsertAvailability(personId, slotId, 3, timestamp);
					availabilityCount++;
				}
			}
		} else {
			ensureDefaultAvailabilityForPerson(personId, conventionId, timestamp);
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
	const { conventionConfig, roomNames = DEFAULT_ROOM_NAMES, entries = [] } = options;
	const timestamp = now();
	const conventionId = crypto.randomUUID();
	const slotMinutes = Number(conventionConfig.slotMinutes) || 30;
	const dayHours = normalizeConventionDayHours(
		conventionConfig.daySettings,
		conventionConfig.startDate,
		conventionConfig.endDate,
		8,
		22
	);
	const defaultHours = deriveGlobalHoursFromDayHours(dayHours);

	state.conventions.push({
		id: conventionId,
		name: conventionConfig.name,
		start_date: conventionConfig.startDate,
		end_date: conventionConfig.endDate,
		slot_minutes: slotMinutes,
		day_start_hour: defaultHours.startHour,
		day_end_hour: defaultHours.endHour,
		day_hours: dayHours,
		created_at: timestamp,
		updated_at: timestamp
	});

	const slotCount = generateTimeSlotsInternal(
		conventionId,
		conventionConfig.startDate,
		conventionConfig.endDate,
		defaultHours.startHour,
		defaultHours.endHour,
		slotMinutes,
		dayHours
	);
	applyConventionSlotTiers(conventionId, conventionConfig.slotTierSettings);

	const conventionSlots = state.time_slots.filter((ts) => ts.convention_id === conventionId);

	for (const roomName of roomNames) {
		state.rooms.push(roomRecord(conventionId, roomName, timestamp));
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
				tier: normalizeTier(event.tier, 2),
				auto_schedule: event.auto_schedule === false || event.auto_schedule === 0 ? 0 : 1,
				adult_content: event.adult_content ? 1 : 0,
				needs_laptop: event.needs_laptop ? 1 : 0,
				needs_speakers: event.needs_speakers ? 1 : 0,
				estimated_attendance: normalizeNullableInteger(event.estimated_attendance),
				required_room_tags: normalizeList(event.required_room_tags),
				equipment_needs: normalizeList(event.equipment_needs),
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
