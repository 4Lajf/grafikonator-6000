import {
	haveSharedTags,
	normalizeColor,
	normalizeScheduleMode,
	normalizeTags,
	SCHEDULE_MODES
} from './scheduling/common.js';
import { normalizeClusterLimit, normalizeEventModeSettings } from './scheduling/event-scheduler.js';
import {
	buildPeopleAutoSchedulePlan,
	getRoomPreferenceTier,
	normalizePeopleModeSettings,
	normalizePersonSchedulingFields
} from './scheduling/people-scheduler.js';

const STORAGE_KEY = 'grafikonator-6000-data';
const MAX_UNDO_GROUPS = 50;

/** @typedef {import('./import/importer.js').PreviewResult} PreviewResult */

function createEmptyState() {
	return {
		active_convention_id: null,
		conventions: [],
		people: [],
		rooms: [],
		events: [],
		event_hosts: [],
		time_slots: [],
		availability: [],
		schedules: [],
		people_schedules: [],
		undo_history: [],
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

function normalizeConventionModeSettings(mode, settings = {}) {
	const scheduleMode = normalizeScheduleMode(mode);
	if (scheduleMode === SCHEDULE_MODES.PEOPLE) {
		return normalizePeopleModeSettings(settings);
	}
	return normalizeEventModeSettings(settings);
}

function normalizeNullableColor(value) {
	return normalizeColor(value);
}

function normalizePersonFields(value = {}) {
	return normalizePersonSchedulingFields(value);
}

function roomNameTag(name) {
	return String(name || '').trim();
}

function capabilitiesWithRoomNameTag(name, capabilities) {
	const normalized = normalizeRoomCapabilities(capabilities);
	const tag = roomNameTag(name);
	if (tag && !normalized.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
		normalized.tags = [...normalized.tags, tag];
	}
	return normalized;
}

function nextRoomSortOrder(conventionId) {
	const orders = state.rooms
		.filter((room) => room.convention_id === conventionId)
		.map((room) => Number(room.sort_order))
		.filter(Number.isFinite);
	return orders.length ? Math.max(...orders) + 1 : 0;
}

function newestConvention() {
	return [...state.conventions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

function activeConventionRecord() {
	return (
		state.conventions.find((convention) => convention.id === state.active_convention_id) ??
		newestConvention()
	);
}

function recordUndo(conventionId, label, snapshot) {
	if (!conventionId || !snapshot) return;
	const entry = {
		id: crypto.randomUUID(),
		convention_id: conventionId,
		label,
		snapshot,
		created_at: now()
	};
	const current = state.undo_history.filter((item) => item.convention_id === conventionId);
	const others = state.undo_history.filter((item) => item.convention_id !== conventionId);
	state.undo_history = [entry, ...current].slice(0, MAX_UNDO_GROUPS).concat(others);
}

function cloneSnapshot(value) {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function getConventionEventIds(conventionId) {
	return new Set(
		state.events.filter((event) => event.convention_id === conventionId).map((event) => event.id)
	);
}

function getConventionPersonIds(conventionId) {
	return new Set(
		state.people.filter((person) => person.convention_id === conventionId).map((person) => person.id)
	);
}

function snapshotScheduleState(conventionId) {
	const eventIds = getConventionEventIds(conventionId);
	const personIds = getConventionPersonIds(conventionId);
	return cloneSnapshot({
		type: 'schedules',
		eventIds: [...eventIds],
		personIds: [...personIds],
		schedules: state.schedules.filter((schedule) => eventIds.has(schedule.event_id)),
		people_schedules: state.people_schedules.filter((schedule) => personIds.has(schedule.person_id))
	});
}

function snapshotRoomState(conventionId) {
	const rooms = state.rooms.filter((room) => room.convention_id === conventionId);
	return cloneSnapshot({
		type: 'rooms',
		rooms,
		roomIds: rooms.map((room) => room.id)
	});
}

function snapshotConventionState(conventionId) {
	const eventIds = getConventionEventIds(conventionId);
	const personIds = getConventionPersonIds(conventionId);
	const roomIds = new Set(
		state.rooms.filter((room) => room.convention_id === conventionId).map((room) => room.id)
	);
	return cloneSnapshot({
		type: 'convention',
		rooms: state.rooms.filter((room) => room.convention_id === conventionId),
		events: state.events.filter((event) => event.convention_id === conventionId),
		people: state.people.filter((person) => person.convention_id === conventionId),
		event_hosts: state.event_hosts.filter((host) => eventIds.has(host.event_id)),
		schedules: state.schedules.filter((schedule) => eventIds.has(schedule.event_id)),
		people_schedules: state.people_schedules.filter((schedule) => personIds.has(schedule.person_id)),
		availability: state.availability.filter((entry) => personIds.has(entry.person_id)),
		time_slots: state.time_slots.filter((slot) => slot.convention_id === conventionId),
		roomIds: [...roomIds],
		eventIds: [...eventIds],
		personIds: [...personIds]
	});
}

function restoreConventionSnapshot(conventionId, snapshot) {
	if (snapshot?.type === 'schedules') {
		const eventIds = new Set(snapshot.eventIds ?? []);
		const personIds = new Set(snapshot.personIds ?? []);
		state.schedules = state.schedules
			.filter((schedule) => !eventIds.has(schedule.event_id))
			.concat(snapshot.schedules ?? []);
		state.people_schedules = state.people_schedules
			.filter((schedule) => !personIds.has(schedule.person_id))
			.concat(snapshot.people_schedules ?? []);
		return;
	}

	if (snapshot?.type === 'rooms') {
		state.rooms = state.rooms
			.filter((room) => room.convention_id !== conventionId)
			.concat(snapshot.rooms ?? []);
		return;
	}

	const currentEventIds = new Set(
		state.events.filter((event) => event.convention_id === conventionId).map((event) => event.id)
	);
	const currentPersonIds = new Set(
		state.people.filter((person) => person.convention_id === conventionId).map((person) => person.id)
	);
	state.rooms = state.rooms.filter((room) => room.convention_id !== conventionId).concat(snapshot.rooms ?? []);
	state.events = state.events.filter((event) => event.convention_id !== conventionId).concat(snapshot.events ?? []);
	state.people = state.people.filter((person) => person.convention_id !== conventionId).concat(snapshot.people ?? []);
	state.event_hosts = state.event_hosts
		.filter((host) => !currentEventIds.has(host.event_id))
		.concat(snapshot.event_hosts ?? []);
	state.schedules = state.schedules
		.filter((schedule) => !currentEventIds.has(schedule.event_id))
		.concat(snapshot.schedules ?? []);
	state.people_schedules = state.people_schedules
		.filter((schedule) => !currentPersonIds.has(schedule.person_id))
		.concat(snapshot.people_schedules ?? []);
	state.availability = state.availability
		.filter((entry) => !currentPersonIds.has(entry.person_id))
		.concat(snapshot.availability ?? []);
	state.time_slots = state.time_slots
		.filter((slot) => slot.convention_id !== conventionId)
		.concat(snapshot.time_slots ?? []);
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

function roomRecord(conventionId, name, timestamp, capabilities = roomCapabilitiesForName(name), sortOrder = 0) {
	return {
		id: crypto.randomUUID(),
		convention_id: conventionId,
		name,
		description: capabilities.notes || null,
		capabilities: serializeRoomCapabilities(capabilities),
		sort_order: sortOrder,
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

	for (const key of ['people_schedules', 'undo_history']) {
		if (!Array.isArray(state[key])) {
			state[key] = [];
			changed = true;
		}
	}

	if (
		state.active_convention_id &&
		!state.conventions.some((convention) => convention.id === state.active_convention_id)
	) {
		state.active_convention_id = null;
		changed = true;
	}

	if (!state.active_convention_id && state.conventions.length > 0) {
		state.active_convention_id = newestConvention()?.id ?? null;
		changed = true;
	}

	for (const convention of state.conventions) {
		const mode = normalizeScheduleMode(convention.schedule_mode);
		if (convention.schedule_mode !== mode) {
			convention.schedule_mode = mode;
			changed = true;
		}
		const settings = normalizeConventionModeSettings(mode, convention.mode_settings);
		if (JSON.stringify(convention.mode_settings ?? {}) !== JSON.stringify(settings)) {
			convention.mode_settings = settings;
			changed = true;
		}
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
		if (event.color !== normalizeNullableColor(event.color)) {
			event.color = normalizeNullableColor(event.color);
			changed = true;
		}
		const conflictTags = normalizeTags(event.conflict_tags);
		if (JSON.stringify(event.conflict_tags ?? []) !== JSON.stringify(conflictTags)) {
			event.conflict_tags = conflictTags;
			changed = true;
		}
		const coScheduleTags = normalizeTags(event.co_schedule_tags);
		if (JSON.stringify(event.co_schedule_tags ?? []) !== JSON.stringify(coScheduleTags)) {
			event.co_schedule_tags = coScheduleTags;
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

	for (const person of state.people) {
		const fields = normalizePersonFields(person);
		for (const key of ['min_blocks', 'max_blocks']) {
			if (person[key] !== fields[key]) {
				person[key] = fields[key];
				changed = true;
			}
		}
		if (person.color !== normalizeNullableColor(person.color)) {
			person.color = normalizeNullableColor(person.color);
			changed = true;
		}
		if (JSON.stringify(person.conflict_tags ?? []) !== JSON.stringify(fields.conflict_tags)) {
			person.conflict_tags = fields.conflict_tags;
			changed = true;
		}
		if (JSON.stringify(person.co_schedule_tags ?? []) !== JSON.stringify(fields.co_schedule_tags)) {
			person.co_schedule_tags = fields.co_schedule_tags;
			changed = true;
		}
		if (JSON.stringify(person.tag_preferences ?? {}) !== JSON.stringify(fields.tag_preferences)) {
			person.tag_preferences = fields.tag_preferences;
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

	const roomOrderByConvention = new Map();
	for (const room of [...state.rooms].sort((a, b) => {
		if (a.convention_id !== b.convention_id) return a.convention_id.localeCompare(b.convention_id);
		return a.name.localeCompare(b.name);
	})) {
		if (!roomOrderByConvention.has(room.convention_id)) roomOrderByConvention.set(room.convention_id, 0);
		if (!Number.isFinite(Number(room.sort_order))) {
			room.sort_order = roomOrderByConvention.get(room.convention_id);
			changed = true;
		}
		roomOrderByConvention.set(room.convention_id, roomOrderByConvention.get(room.convention_id) + 1);
		const defaults = roomCapabilitiesForName(room.name);
		const current = normalizeRoomCapabilities(room.capabilities ?? defaults);
		const convention = state.conventions.find((entry) => entry.id === room.convention_id);
		const peopleMode = normalizeScheduleMode(convention?.schedule_mode) === SCHEDULE_MODES.PEOPLE;
		const currentCapacity = current.capacity ?? 0;
		const defaultCapacity = defaults.capacity ?? 0;
		let normalized = {
			...current,
			capacity: Math.max(currentCapacity, defaultCapacity) || null,
			tags: [...defaults.tags],
			noisePolicy: current.noisePolicy ?? defaults.noisePolicy,
			notes: current.notes ?? defaults.notes
		};
		if (peopleMode) normalized = capabilitiesWithRoomNameTag(room.name, normalized);
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
			persist();
		}
	} catch {
		state = createEmptyState();
	}
	loaded = true;
}

function isQuotaExceededError(error) {
	return (
		error?.name === 'QuotaExceededError' ||
		error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
		error?.code === 22 ||
		error?.code === 1014
	);
}

function dropOldestUndoEntry() {
	if (!state.undo_history.length) return false;
	let oldestIndex = 0;
	for (let i = 1; i < state.undo_history.length; i++) {
		const currentCreatedAt = state.undo_history[i].created_at ?? '';
		const oldestCreatedAt = state.undo_history[oldestIndex].created_at ?? '';
		if (currentCreatedAt < oldestCreatedAt || (currentCreatedAt === oldestCreatedAt && i > oldestIndex)) {
			oldestIndex = i;
		}
	}
	state.undo_history = state.undo_history.filter((_, index) => index !== oldestIndex);
	return true;
}

function persist() {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		return;
	} catch (error) {
		if (!isQuotaExceededError(error)) throw error;
	}

	while (dropOldestUndoEntry()) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
			return;
		} catch (error) {
			if (!isQuotaExceededError(error)) throw error;
		}
	}

	throw new Error('Nie można zapisać danych lokalnie: pamięć przeglądarki jest pełna.');
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
	return activeConventionRecord();
}

export function getConventions() {
	const active = getActiveConvention();
	return {
		conventions: getConventionsList(),
		active,
		activeId: active?.id ?? null
	};
}

export function createConvention(data) {
	ensureLoaded();
	const id = crypto.randomUUID();
	const timestamp = now();
	const slotMinutes = Number(data.slot_minutes) || 30;
	const scheduleMode = normalizeScheduleMode(data.schedule_mode);
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
		schedule_mode: scheduleMode,
		mode_settings: normalizeConventionModeSettings(scheduleMode, data.mode_settings),
		created_at: timestamp,
		updated_at: timestamp
	};
	state.conventions.push(convention);
	state.active_convention_id = id;
	persist();
	return convention;
}

export function setActiveConvention(id) {
	ensureLoaded();
	const convention = state.conventions.find((entry) => entry.id === id);
	if (!convention) throw new Error('Nie znaleziono profilu');
	state.active_convention_id = id;
	persist();
	return convention;
}

export function deleteConvention(id) {
	ensureLoaded();
	const convention = state.conventions.find((entry) => entry.id === id);
	if (!convention) return { deleted: false, active: getActiveConvention() };

	const eventIds = getConventionEventIds(id);
	const personIds = getConventionPersonIds(id);
	const roomIds = new Set(
		state.rooms.filter((room) => room.convention_id === id).map((room) => room.id)
	);
	const slotIds = new Set(
		state.time_slots.filter((slot) => slot.convention_id === id).map((slot) => slot.id)
	);

	state.conventions = state.conventions.filter((entry) => entry.id !== id);
	state.rooms = state.rooms.filter((room) => room.convention_id !== id);
	state.events = state.events.filter((event) => event.convention_id !== id);
	state.people = state.people.filter((person) => person.convention_id !== id);
	state.event_hosts = state.event_hosts.filter((host) => !eventIds.has(host.event_id));
	state.schedules = state.schedules.filter((schedule) => !eventIds.has(schedule.event_id));
	state.people_schedules = state.people_schedules.filter(
		(schedule) => !personIds.has(schedule.person_id)
	);
	state.availability = state.availability.filter(
		(entry) => !personIds.has(entry.person_id) && !slotIds.has(entry.time_slot_id)
	);
	state.time_slots = state.time_slots.filter((slot) => slot.convention_id !== id);
	state.import_value_mappings = state.import_value_mappings.filter(
		(mapping) => mapping.convention_id !== id
	);
	state.undo_history = state.undo_history.filter((entry) => entry.convention_id !== id);

	if (state.active_convention_id === id) {
		state.active_convention_id = newestConvention()?.id ?? null;
	}

	persist();
	return {
		deleted: true,
		active: getActiveConvention(),
		removed: {
			rooms: roomIds.size,
			events: eventIds.size,
			people: personIds.size,
			timeSlots: slotIds.size
		}
	};
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
	if (updates.schedule_mode !== undefined) {
		convention.schedule_mode = normalizeScheduleMode(updates.schedule_mode);
	}
	if (updates.mode_settings !== undefined || updates.schedule_mode !== undefined) {
		convention.mode_settings = normalizeConventionModeSettings(
			convention.schedule_mode,
			updates.mode_settings ?? convention.mode_settings
		);
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
	const id = crypto.randomUUID();
	const timestamp = now();
	const fields = normalizePersonFields(data);
	const person = {
		id,
		convention_id: conventionId,
		display_name: data.display_name,
		phone: data.phone || null,
		notes: data.notes || null,
		min_blocks: fields.min_blocks,
		max_blocks: fields.max_blocks,
		color: normalizeNullableColor(data.color),
		conflict_tags: fields.conflict_tags,
		co_schedule_tags: fields.co_schedule_tags,
		tag_preferences: fields.tag_preferences,
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
	if (
		updates.min_blocks !== undefined ||
		updates.max_blocks !== undefined ||
		updates.conflict_tags !== undefined ||
		updates.co_schedule_tags !== undefined ||
		updates.tag_preferences !== undefined
	) {
		const fields = normalizePersonFields({ ...person, ...updates });
		person.min_blocks = fields.min_blocks;
		person.max_blocks = fields.max_blocks;
		person.conflict_tags = fields.conflict_tags;
		person.co_schedule_tags = fields.co_schedule_tags;
		person.tag_preferences = fields.tag_preferences;
	}
	if (updates.color !== undefined) person.color = normalizeNullableColor(updates.color);
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
	state.people_schedules = state.people_schedules.filter((schedule) => schedule.person_id !== id);
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
		.sort((a, b) => {
			const orderA = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 0;
			const orderB = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 0;
			if (orderA !== orderB) return orderA - orderB;
			return a.name.localeCompare(b.name);
		})
		.map((room) => ({
			...room,
			capabilities: normalizeRoomCapabilities(room.capabilities)
		}));
}

export function createRoom(conventionId, data) {
	ensureLoaded();
	const id = crypto.randomUUID();
	const timestamp = now();
	const convention = getConvention(conventionId);
	const baseCapabilities = normalizeRoomCapabilities(
		data.capabilities ?? roomCapabilitiesForName(data.name)
	);
	const capabilities =
		normalizeScheduleMode(convention?.schedule_mode) === SCHEDULE_MODES.PEOPLE
			? capabilitiesWithRoomNameTag(data.name, baseCapabilities)
			: baseCapabilities;
	const room = {
		id,
		convention_id: conventionId,
		name: data.name,
		description: data.description || capabilities.notes || null,
		capabilities: serializeRoomCapabilities(capabilities),
		sort_order: nextRoomSortOrder(conventionId),
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
	if (updates.sort_order !== undefined) {
		const sortOrder = Number(updates.sort_order);
		if (Number.isFinite(sortOrder)) room.sort_order = Math.floor(sortOrder);
	}
	room.updated_at = now();
	persist();
	return { ...room, capabilities: normalizeRoomCapabilities(room.capabilities) };
}

export function reorderRooms(conventionId, orderedRoomIds) {
	ensureLoaded();
	const ids = Array.isArray(orderedRoomIds) ? orderedRoomIds : [];
	const roomById = new Map(state.rooms.filter((room) => room.convention_id === conventionId).map((room) => [room.id, room]));
	if (ids.some((id) => !roomById.has(id))) throw new Error('Nieprawidłowa kolejność sal');
	const snapshot = snapshotRoomState(conventionId);
	const timestamp = now();
	ids.forEach((id, index) => {
		const room = roomById.get(id);
		room.sort_order = index;
		room.updated_at = timestamp;
	});
	recordUndo(conventionId, 'Zmiana kolejności sal', snapshot);
	persist();
	return getRooms(conventionId);
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
		color: normalizeNullableColor(data.color),
		conflict_tags: normalizeTags(data.conflict_tags),
		co_schedule_tags: normalizeTags(data.co_schedule_tags),
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
	if (updates.color !== undefined) {
		event.color = normalizeNullableColor(updates.color);
	}
	if (updates.conflict_tags !== undefined) {
		event.conflict_tags = normalizeTags(updates.conflict_tags);
	}
	if (updates.co_schedule_tags !== undefined) {
		event.co_schedule_tags = normalizeTags(updates.co_schedule_tags);
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
	state.people_schedules = state.people_schedules.filter(
		(schedule) => !peopleIds.has(schedule.person_id) || activeSlotIds.has(schedule.time_slot_id)
	);
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

function setAvailabilityExactInternal(personId, slotId, tier, timestamp) {
	const normalizedTier = normalizeTier(tier, 1);
	const existing = state.availability.find(
		(a) => a.person_id === personId && a.time_slot_id === slotId
	);
	if (existing) {
		existing.tier = normalizedTier;
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
			color: normalizeNullableColor(event?.color),
			conflict_tags: normalizeTags(event?.conflict_tags),
			co_schedule_tags: normalizeTags(event?.co_schedule_tags),
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

function mapPeopleScheduleRow(schedule) {
	const person = state.people.find((p) => p.id === schedule.person_id);
	const room = state.rooms.find((r) => r.id === schedule.room_id);
	const slot = state.time_slots.find((ts) => ts.id === schedule.time_slot_id);
	return {
		id: schedule.id,
		person_id: schedule.person_id,
		room_id: schedule.room_id,
		time_slot_id: schedule.time_slot_id,
		start_time_slot_id: schedule.time_slot_id,
		slot_count: 1,
		status: schedule.status || 'scheduled',
		locked: schedule.locked === true,
		notes: schedule.notes || null,
		created_at: schedule.created_at,
		updated_at: schedule.updated_at,
		person,
		event: person
			? {
					id: person.id,
					title: person.display_name,
					duration_minutes: 0,
					tier: 2,
					auto_schedule: 1,
					color: normalizeNullableColor(person.color),
					conflict_tags: normalizeTags(person.conflict_tags),
					co_schedule_tags: normalizeTags(person.co_schedule_tags),
					host_name: person.display_name
				}
			: null,
		room: room
			? {
					id: room.id,
					name: room.name,
					capabilities: normalizeRoomCapabilities(room.capabilities)
				}
			: null,
		start_slot: slot
			? {
					id: slot.id,
					date: slot.date,
					start_time: slot.start_time,
					end_time: slot.end_time
				}
			: null,
		time_slot: slot,
		hosts: person ? [{ id: person.id, display_name: person.display_name }] : [],
		host_name: person?.display_name ?? null
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
			const orderA = Number.isFinite(Number(roomA?.sort_order)) ? Number(roomA.sort_order) : 0;
			const orderB = Number.isFinite(Number(roomB?.sort_order)) ? Number(roomB.sort_order) : 0;
			if (orderA !== orderB) return orderA - orderB;
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
	const event = state.events.find((e) => e.id === data.event_id);
	const snapshot = event ? snapshotScheduleState(event.convention_id) : null;
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
	if (event) recordUndo(event.convention_id, 'Dodanie do grafiku', snapshot);
	persist();
	return getScheduleById(id);
}

export function updateSchedule(id, updates) {
	ensureLoaded();
	const schedule = state.schedules.find((s) => s.id === id);
	if (!schedule) return null;
	const event = state.events.find((e) => e.id === schedule.event_id);
	const snapshot = event ? snapshotScheduleState(event.convention_id) : null;

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

	if (event) recordUndo(event.convention_id, 'Zmiana grafiku', snapshot);
	persist();
	return getScheduleById(id);
}

export function deleteSchedule(id) {
	ensureLoaded();
	const schedule = state.schedules.find((s) => s.id === id);
	const event = schedule ? state.events.find((e) => e.id === schedule.event_id) : null;
	const snapshot = event ? snapshotScheduleState(event.convention_id) : null;
	state.schedules = state.schedules.filter((s) => s.id !== id);
	if (event) recordUndo(event.convention_id, 'Usunięcie z grafiku', snapshot);
	persist();
}

export function clearAllSchedules(conventionId) {
	ensureLoaded();
	const eventIds = new Set(
		state.events.filter((e) => e.convention_id === conventionId).map((e) => e.id)
	);
	const removed = state.schedules.filter((s) => eventIds.has(s.event_id)).length;
	const snapshot = snapshotScheduleState(conventionId);
	state.schedules = state.schedules.filter((s) => !eventIds.has(s.event_id));
	let removedPeopleSchedules = 0;
	state.people_schedules = state.people_schedules.filter((s) => {
		const person = state.people.find((p) => p.id === s.person_id);
		const remove = person?.convention_id === conventionId;
		if (remove) removedPeopleSchedules++;
		return !remove;
	});
	recordUndo(conventionId, 'Wyczyszczenie grafiku', snapshot);
	persist();
	return { removed: removed + removedPeopleSchedules };
}

export function swapSchedules(scheduleIdA, scheduleIdB) {
	ensureLoaded();
	const a = state.schedules.find((s) => s.id === scheduleIdA);
	const b = state.schedules.find((s) => s.id === scheduleIdB);
	if (!a || !b) throw new Error('Nie znaleziono wpisu w grafiku');
	const event = state.events.find((e) => e.id === a.event_id);
	const snapshot = event ? snapshotScheduleState(event.convention_id) : null;
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

	if (event) recordUndo(event.convention_id, 'Zamiana pozycji', snapshot);
	persist();
	return [getScheduleById(scheduleIdA), getScheduleById(scheduleIdB)];
}

export function swapPeopleSchedules(scheduleIdA, scheduleIdB) {
	ensureLoaded();
	const a = state.people_schedules.find((s) => s.id === scheduleIdA);
	const b = state.people_schedules.find((s) => s.id === scheduleIdB);
	if (!a || !b) throw new Error('Nie znaleziono wpisu w grafiku');
	const person = state.people.find((p) => p.id === a.person_id);
	const snapshot = person ? snapshotScheduleState(person.convention_id) : null;
	if (a.locked === true || b.locked === true) {
		throw new Error('Nie można zamienić zablokowanej pozycji');
	}

	// Exchange only the placement (room + slot). Occupancy validation is skipped
	// on purpose: the caller has already gated the move on the issue engine, and
	// the two entries trade spots atomically so neither one transiently collides.
	const timestamp = now();
	const aRoom = a.room_id;
	const aSlot = a.time_slot_id;

	a.room_id = b.room_id;
	a.time_slot_id = b.time_slot_id;
	a.updated_at = timestamp;

	b.room_id = aRoom;
	b.time_slot_id = aSlot;
	b.updated_at = timestamp;

	if (person) recordUndo(person.convention_id, 'Zamiana pozycji osób', snapshot);
	persist();
	return [getPeopleScheduleById(scheduleIdA), getPeopleScheduleById(scheduleIdB)];
}

export function movePeopleSchedules(moves) {
	ensureLoaded();
	if (!Array.isArray(moves) || moves.length === 0) return [];

	const normalizedMoves = moves.map((move) => ({
		id: move.scheduleId ?? move.schedule_id ?? move.id,
		room_id: move.room_id,
		time_slot_id: move.time_slot_id ?? move.start_time_slot_id
	}));
	const moveById = new Map();
	let conventionId = null;

	for (const move of normalizedMoves) {
		if (!move.id) throw new Error('Brak identyfikatora wpisu');
		const schedule = state.people_schedules.find((entry) => entry.id === move.id);
		if (!schedule) throw new Error('Nie znaleziono wpisu w grafiku');
		const person = state.people.find((entry) => entry.id === schedule.person_id);
		if (!person) throw new Error('Nie znaleziono osoby');
		conventionId = conventionId ?? person.convention_id;
		if (person.convention_id !== conventionId) {
			throw new Error('Nie można przenosić wpisów między profilami');
		}
		const nextRoomId = move.room_id ?? schedule.room_id;
		const nextSlotId = move.time_slot_id ?? schedule.time_slot_id;
		if (!state.rooms.some((room) => room.id === nextRoomId && room.convention_id === conventionId)) {
			throw new Error('Nie znaleziono sali');
		}
		if (!state.time_slots.some((slot) => slot.id === nextSlotId && slot.convention_id === conventionId)) {
			throw new Error('Nie znaleziono slotu');
		}
		if (
			schedule.locked === true &&
			(nextRoomId !== schedule.room_id || nextSlotId !== schedule.time_slot_id)
		) {
			throw new Error('Nie można przenieść zablokowanej pozycji');
		}
		moveById.set(schedule.id, { room_id: nextRoomId, time_slot_id: nextSlotId });
	}

	const finalSchedules = state.people_schedules
		.map((schedule) => {
			const person = state.people.find((entry) => entry.id === schedule.person_id);
			if (!person || person.convention_id !== conventionId) return null;
			const placement = moveById.get(schedule.id) ?? {
				room_id: schedule.room_id,
				time_slot_id: schedule.time_slot_id
			};
			return { ...schedule, ...placement, person };
		})
		.filter(Boolean);

	const roomSlotOccupancy = new Map();
	const personSlotOccupancy = new Map();
	for (const schedule of finalSchedules) {
		const roomSlotKey = `${schedule.room_id}|${schedule.time_slot_id}`;
		if (roomSlotOccupancy.has(roomSlotKey)) throw new Error('Sala zajęta w tym czasie');
		roomSlotOccupancy.set(roomSlotKey, schedule.id);

		const personSlotKey = `${schedule.person_id}|${schedule.time_slot_id}`;
		if (personSlotOccupancy.has(personSlotKey)) {
			throw new Error(`${schedule.person.display_name}: ma już wpis w tym czasie`);
		}
		personSlotOccupancy.set(personSlotKey, schedule.id);

		if (!moveById.has(schedule.id)) continue;

		const availabilityTier = getEffectiveAvailability(schedule.person_id, schedule.time_slot_id);
		if (availabilityTier === 3) {
			throw new Error(`${schedule.person.display_name}: niedostępny w tym czasie`);
		}
		const room = state.rooms.find((entry) => entry.id === schedule.room_id);
		const roomPreferenceTier = getRoomPreferenceTier(schedule.person, {
			...room,
			capabilities: normalizeRoomCapabilities(room?.capabilities)
		});
		if (roomPreferenceTier === 3) {
			throw new Error(`${schedule.person.display_name}: nie chce pracować w ${room?.name ?? 'tej sali'}`);
		}
	}

	for (let i = 0; i < finalSchedules.length; i++) {
		for (let j = i + 1; j < finalSchedules.length; j++) {
			const a = finalSchedules[i];
			const b = finalSchedules[j];
			if (!moveById.has(a.id) && !moveById.has(b.id)) continue;
			if (a.time_slot_id !== b.time_slot_id) continue;
			if (haveSharedTags(a.person.conflict_tags, b.person.conflict_tags)) {
				throw new Error(`Konflikt tagów z ${b.person.display_name}`);
			}
		}
	}

	const snapshot = conventionId ? snapshotScheduleState(conventionId) : null;
	const timestamp = now();
	for (const [scheduleId, placement] of moveById) {
		const schedule = state.people_schedules.find((entry) => entry.id === scheduleId);
		if (!schedule) continue;
		schedule.room_id = placement.room_id;
		schedule.time_slot_id = placement.time_slot_id;
		schedule.updated_at = timestamp;
	}

	if (conventionId) recordUndo(conventionId, 'Zamiana pozycji osób', snapshot);
	persist();
	return [...moveById.keys()].map(getPeopleScheduleById).filter(Boolean);
}

export function getPeopleSchedules(conventionId, date = null) {
	ensureLoaded();
	return state.people_schedules
		.filter((schedule) => {
			const person = state.people.find((p) => p.id === schedule.person_id);
			if (!person || person.convention_id !== conventionId) return false;
			if (!date) return true;
			const slot = state.time_slots.find((ts) => ts.id === schedule.time_slot_id);
			return slot?.date === date;
		})
		.sort((a, b) => {
			const slotA = state.time_slots.find((ts) => ts.id === a.time_slot_id);
			const slotB = state.time_slots.find((ts) => ts.id === b.time_slot_id);
			const roomA = state.rooms.find((r) => r.id === a.room_id);
			const roomB = state.rooms.find((r) => r.id === b.room_id);
			if (slotA?.date !== slotB?.date) return String(slotA?.date).localeCompare(String(slotB?.date));
			if (slotA?.start_time !== slotB?.start_time) {
				return String(slotA?.start_time).localeCompare(String(slotB?.start_time));
			}
			const orderA = Number.isFinite(Number(roomA?.sort_order)) ? Number(roomA.sort_order) : 0;
			const orderB = Number.isFinite(Number(roomB?.sort_order)) ? Number(roomB.sort_order) : 0;
			return orderA - orderB || String(roomA?.name).localeCompare(String(roomB?.name));
		})
		.map(mapPeopleScheduleRow);
}

function getPeopleScheduleById(id) {
	const schedule = state.people_schedules.find((s) => s.id === id);
	return schedule ? mapPeopleScheduleRow(schedule) : null;
}

export function validatePersonPlacement(personId, roomId, timeSlotId, excludeScheduleId = null) {
	ensureLoaded();
	const person = state.people.find((p) => p.id === personId);
	if (!person) throw new Error('Nie znaleziono osoby');
	const room = state.rooms.find((r) => r.id === roomId);
	if (!room) return { valid: false, reason: 'Nie znaleziono sali', code: 'room-missing' };
	const slot = state.time_slots.find((ts) => ts.id === timeSlotId);
	if (!slot) return { valid: false, reason: 'Nie znaleziono slotu', code: 'slot-missing' };
	const availabilityTier = getEffectiveAvailability(personId, timeSlotId);
	if (availabilityTier === 3) {
		return {
			valid: false,
			reason: `${person.display_name}: niedostępny w tym czasie`,
			code: 'availability-unavailable'
		};
	}
	const roomPreferenceTier = getRoomPreferenceTier(person, {
		...room,
		capabilities: normalizeRoomCapabilities(room.capabilities)
	});
	if (roomPreferenceTier === 3) {
		return {
			valid: false,
			reason: `${person.display_name}: nie chce pracować w ${room.name}`,
			code: 'room-tag-unwanted'
		};
	}

	for (const other of state.people_schedules) {
		if (other.id === excludeScheduleId || other.time_slot_id !== timeSlotId) continue;
		if (other.room_id === roomId) {
			return { valid: false, reason: 'Sala zajęta w tym czasie', code: 'room-conflict' };
		}
		if (other.person_id === personId) {
			return { valid: false, reason: 'Osoba ma już wpis w tym czasie', code: 'person-conflict' };
		}
		const otherPerson = state.people.find((p) => p.id === other.person_id);
		if (haveSharedTags(person.conflict_tags, otherPerson?.conflict_tags)) {
			return {
				valid: false,
				reason: `Konflikt tagów z ${otherPerson?.display_name ?? 'inną osobą'}`,
				code: 'tag-conflict'
			};
		}
	}

	const warnings = [];
	for (const tag of normalizeTags(person.co_schedule_tags)) {
		const tagKey = tag.toLowerCase();
		const related = state.people_schedules
			.filter((other) => other.id !== excludeScheduleId)
			.map((other) => ({
				schedule: other,
				person: state.people.find((p) => p.id === other.person_id)
			}))
			.filter(
				({ person: otherPerson }) =>
					otherPerson?.id !== personId &&
					otherPerson?.convention_id === person.convention_id &&
					normalizeTags(otherPerson?.co_schedule_tags).some(
						(otherTag) => otherTag.toLowerCase() === tagKey
					)
			);
		if (!related.length) continue;
		if (related.some(({ schedule }) => schedule.time_slot_id === timeSlotId)) continue;
		warnings.push(
			`Tag wspólnego slotu nie jest razem z ${related[0].person?.display_name ?? 'inną osobą'}`
		);
	}

	return {
		valid: true,
		worstTier: availabilityTier,
		warning:
			availabilityTier === 2
				? `${person.display_name}: woli nie w tym czasie`
				: roomPreferenceTier === 2
					? `${person.display_name}: ${room.name} tylko jak będą braki`
					: warnings[0] || null,
		info: null
	};
}

export function validatePeopleScheduleMove(scheduleId, roomId, timeSlotId) {
	ensureLoaded();
	const schedule = state.people_schedules.find((s) => s.id === scheduleId);
	if (!schedule) throw new Error('Nie znaleziono wpisu w grafiku');
	return validatePersonPlacement(schedule.person_id, roomId, timeSlotId, scheduleId);
}

export function createPeopleSchedule(data) {
	ensureLoaded();
	const person = state.people.find((p) => p.id === data.person_id);
	if (!person) throw new Error('Nie znaleziono osoby');
	const validation = validatePersonPlacement(data.person_id, data.room_id, data.time_slot_id);
	if (!validation.valid) throw new Error(validation.reason);
	const snapshot = snapshotScheduleState(person.convention_id);
	const id = crypto.randomUUID();
	const timestamp = now();
	state.people_schedules.push({
		id,
		person_id: data.person_id,
		room_id: data.room_id,
		time_slot_id: data.time_slot_id,
		status: data.status || 'scheduled',
		locked: data.locked === true,
		notes: data.notes || null,
		created_at: timestamp,
		updated_at: timestamp
	});
	recordUndo(person.convention_id, 'Dodanie osoby do grafiku', snapshot);
	persist();
	return getPeopleScheduleById(id);
}

export function updatePeopleSchedule(id, updates) {
	ensureLoaded();
	const schedule = state.people_schedules.find((s) => s.id === id);
	if (!schedule) return null;
	const person = state.people.find((p) => p.id === schedule.person_id);
	const snapshot = person ? snapshotScheduleState(person.convention_id) : null;
	const nextRoomId = updates.room_id ?? schedule.room_id;
	const nextSlotId = updates.time_slot_id ?? updates.start_time_slot_id ?? schedule.time_slot_id;
	if (schedule.locked === true && (nextRoomId !== schedule.room_id || nextSlotId !== schedule.time_slot_id)) {
		throw new Error('Ta pozycja jest zablokowana — odblokuj ją przed przeniesieniem');
	}
	const validation = validatePersonPlacement(schedule.person_id, nextRoomId, nextSlotId, schedule.id);
	if (!validation.valid) throw new Error(validation.reason);
	if (updates.room_id !== undefined) schedule.room_id = updates.room_id;
	if (updates.time_slot_id !== undefined || updates.start_time_slot_id !== undefined) {
		schedule.time_slot_id = nextSlotId;
	}
	if (updates.status !== undefined) schedule.status = updates.status;
	if (updates.locked !== undefined) schedule.locked = updates.locked === true;
	if (updates.notes !== undefined) schedule.notes = updates.notes;
	schedule.updated_at = now();
	if (person) recordUndo(person.convention_id, 'Zmiana grafiku osoby', snapshot);
	persist();
	return getPeopleScheduleById(id);
}

export function deletePeopleSchedule(id) {
	ensureLoaded();
	const schedule = state.people_schedules.find((s) => s.id === id);
	const person = schedule ? state.people.find((p) => p.id === schedule.person_id) : null;
	const snapshot = person ? snapshotScheduleState(person.convention_id) : null;
	state.people_schedules = state.people_schedules.filter((s) => s.id !== id);
	if (person) recordUndo(person.convention_id, 'Usunięcie osoby z grafiku', snapshot);
	persist();
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

function eventTagConflict(event, slotIds, excludeScheduleId = null) {
	for (const sched of state.schedules) {
		if (sched.id === excludeScheduleId || sched.event_id === event.id) continue;
		const otherEvent = state.events.find((e) => e.id === sched.event_id);
		if (!otherEvent || !haveSharedTags(event.conflict_tags, otherEvent.conflict_tags)) continue;
		const block = getSlotBlock(otherEvent.convention_id, sched.start_time_slot_id, sched.slot_count);
		if (block.some((slot) => slotIds.includes(slot.id))) {
			return otherEvent;
		}
	}
	return null;
}

function eventCoScheduleWarning(event, slotIds, excludeScheduleId = null) {
	if (!normalizeTags(event.co_schedule_tags).length) return null;
	for (const sched of state.schedules) {
		if (sched.id === excludeScheduleId || sched.event_id === event.id) continue;
		const otherEvent = state.events.find((e) => e.id === sched.event_id);
		if (!otherEvent || !haveSharedTags(event.co_schedule_tags, otherEvent.co_schedule_tags)) continue;
		const block = getSlotBlock(otherEvent.convention_id, sched.start_time_slot_id, sched.slot_count);
		if (!block.some((slot) => slotIds.includes(slot.id))) {
			return `Tag wspólnego slotu nie jest razem z „${otherEvent.title}"`;
		}
	}
	return null;
}

function getDaySlots(conventionId, date) {
	return state.time_slots
		.filter((ts) => ts.convention_id === conventionId && ts.date === date && ts.is_active === 1)
		.sort((a, b) => a.start_time.localeCompare(b.start_time));
}

function countHostSchedulingWarnings() {
	return 0;
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
const AUTO_SOLVER_CLUSTER_WEIGHT = 2_500;
const AUTO_SOLVER_CO_SCHEDULE_WEIGHT = 750;
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
	for (const key of placement.tagKeys || []) occupancy.tags.add(key);
	for (const key of placement.coTagKeys || []) occupancy.coTags.add(key);
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
	for (const key of placement.tagKeys || []) occupancy.tags.delete(key);
	for (const key of placement.coTagKeys || []) occupancy.coTags.delete(key);
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
		placement.hostKeys.some((key) => occupancy.host.has(key)) ||
		(placement.tagKeys || []).some((key) => occupancy.tags.has(key))
	);
}

function solverCoScheduleBonus(occupancy, placement) {
	return (placement.coTagKeys || []).filter((key) => occupancy.coTags.has(key)).length;
}

function solverClusterDelta(occupancy, placement) {
	let delta = 0;
	const settings = normalizeEventModeSettings(getConvention(placement.conventionId)?.mode_settings);
	const limit = normalizeClusterLimit(settings.cluster_same_person_limit);
	if (limit === '0') return 0;
	const max = limit === 'MAX' ? Number.POSITIVE_INFINITY : Number(limit);
	for (const entry of placement.hostDateEntries) {
		const key = `${entry.hostId}|${entry.date}`;
		const current = occupancy.hostDates.get(key) || [];
		const clustered = current.filter((other) => Math.abs(other.startIdx - entry.startIdx) <= 1).length;
		if (Number.isFinite(max) && clustered >= max) delta += clustered - max + 1;
		else delta -= clustered;
	}
	return delta;
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
		solverClusterDelta(occupancy, placement) * AUTO_SOLVER_CLUSTER_WEIGHT -
		solverCoScheduleBonus(occupancy, placement) * AUTO_SOLVER_CO_SCHEDULE_WEIGHT +
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
		tags: new Set(),
		coTags: new Set(),
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
			conventionId,
			roomKeys: block.map((slot) => `${schedule.room_id}|${slot.id}`),
			hostKeys: hostIds.flatMap((hostId) => block.map((slot) => `${hostId}|${slot.id}`)),
			tagKeys: normalizeTags(event.conflict_tags).flatMap((tag) =>
				block.map((slot) => `${tag.toLowerCase()}|${slot.id}`)
			),
			coTagKeys: normalizeTags(event.co_schedule_tags).flatMap((tag) =>
				block.map((slot) => `${tag.toLowerCase()}|${slot.id}`)
			),
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
					conventionId: item.conventionId,
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
					tagKeys: normalizeTags(item.event?.conflict_tags).flatMap((tag) =>
						block.map((slot) => `${tag.toLowerCase()}|${slot.id}`)
					),
					coTagKeys: normalizeTags(item.event?.co_schedule_tags).flatMap((tag) =>
						block.map((slot) => `${tag.toLowerCase()}|${slot.id}`)
					),
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
		tags: new Set(occupancy.tags),
		coTags: new Set(occupancy.coTags),
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
		const peopleSchedules = state.people_schedules.filter((s) => s.person_id === person.id);
		const totalSlots =
			personSchedules.reduce((sum, s) => sum + s.slot_count, 0) + peopleSchedules.length;
		return {
			id: person.id,
			display_name: person.display_name,
			min_blocks: person.min_blocks,
			max_blocks: person.max_blocks,
			color: normalizeNullableColor(person.color),
			conflict_tags: normalizeTags(person.conflict_tags),
			co_schedule_tags: normalizeTags(person.co_schedule_tags),
			schedule_count: personSchedules.length + peopleSchedules.length,
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

async function autoSchedulePeople(conventionId, onProgress = null) {
	const people = getPeople(conventionId);
	const rooms = getRooms(conventionId);
	const slots = getTimeSlots(conventionId);
	const availability = getAvailability(conventionId);
	const existingSchedules = getPeopleSchedules(conventionId);
	const snapshot = snapshotScheduleState(conventionId);

	if (onProgress) {
		await onProgress({
			current: 0,
			total: people.length,
			phase: 'Budowanie zbalansowanego grafiku osób...'
		});
		await yieldToBrowser();
	}

	const locked = state.people_schedules.filter((schedule) => {
		const person = state.people.find((p) => p.id === schedule.person_id);
		return person?.convention_id === conventionId && schedule.locked === true;
	});
	state.people_schedules = state.people_schedules.filter((schedule) => {
		const person = state.people.find((p) => p.id === schedule.person_id);
		return person?.convention_id !== conventionId || schedule.locked === true;
	});

	const plan = buildPeopleAutoSchedulePlan({
		people,
		rooms,
		slots,
		availability,
		existingSchedules: locked.map(mapPeopleScheduleRow),
		settings: getConvention(conventionId)?.mode_settings ?? {}
	});

	const timestamp = now();
	let applied = 0;
	for (const placement of plan) {
		state.people_schedules.push({
			id: crypto.randomUUID(),
			person_id: placement.person_id,
			room_id: placement.room_id,
			time_slot_id: placement.time_slot_id,
			status: 'scheduled',
			locked: false,
			notes: null,
			created_at: timestamp,
			updated_at: timestamp
		});
		applied++;
		if (onProgress && applied % 10 === 0) {
			await onProgress({
				current: Math.min(applied, people.length),
				total: people.length,
				phase: `Zapisywanie grafiku osób (${applied})...`
			});
			await yieldToBrowser();
		}
	}

	recordUndo(conventionId, 'Autoplanowanie osób', snapshot);
	persist();
	const scheduled = getPeopleSchedules(conventionId);
	return {
		successes: scheduled,
		errors: [],
		totalProcessed: people.length,
		restored: false
	};
}

export async function autoScheduleAll(conventionId, onProgress = null) {
	ensureLoaded();
	const convention = getConvention(conventionId);
	if (normalizeScheduleMode(convention?.schedule_mode) === SCHEDULE_MODES.PEOPLE) {
		return autoSchedulePeople(conventionId, onProgress);
	}
	const autoEvents = state.events.filter(
		(event) => event.convention_id === conventionId && event.auto_schedule !== 0
	);
	const eventIds = new Set(autoEvents.map((e) => e.id));
	const originalState = JSON.parse(JSON.stringify(state));
	const undoSnapshot = snapshotScheduleState(conventionId);
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
				error: 'Autoplanowanie nie poprawiło liczby zaplanowanych atrakcji'
			})),
			totalProcessed: autoEvents.length,
			restored: true
		};
	}

	recordUndo(conventionId, 'Autoplanowanie atrakcji', undoSnapshot);
	persist();
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
		return { valid: false, reason: 'Brak wystarczającej liczby kolejnych terminów' };
	}
	let worstTier = 1;
	let unavailableHost = null;
	for (const hostId of hostIds) {
		for (const slotId of slotIds) {
			const tier = getEffectiveAvailability(hostId, slotId);
			worstTier = Math.max(worstTier, tier);
			if (tier === 3 && !unavailableHost) {
				unavailableHost = event.hosts.find((host) => host.id === hostId);
			}
		}
	}
	if (unavailableHost) {
		return {
			valid: false,
			reason: `${unavailableHost.display_name || 'Prowadzący'}: niedostępny w tym czasie`,
			code: 'availability-unavailable'
		};
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
	const tagConflict = eventTagConflict(event, slotIds, excludeScheduleId);
	if (tagConflict) {
		return {
			valid: false,
			reason: `Konflikt tagów z „${tagConflict.title}"`,
			code: 'tag-conflict'
		};
	}

	const eventTier = getEventTierForScheduling(event);
	const slotTier = getBlockPopularityTier(slotIds);
	const tierMismatch = Math.abs(eventTier - slotTier);
	const coScheduleWarning = eventCoScheduleWarning(event, slotIds, excludeScheduleId);

	return {
		valid: true,
		worstTier,
		eventTier,
		slotTier,
		tierMismatch,
		roomFit,
		warning: worstTier === 2 ? 'Prowadzący woli nie w tym czasie' : coScheduleWarning,
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
	const scheduleMode = normalizeScheduleMode(conventionConfig.scheduleMode ?? conventionConfig.schedule_mode);
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
		schedule_mode: scheduleMode,
		mode_settings: normalizeConventionModeSettings(scheduleMode, conventionConfig.modeSettings),
		created_at: timestamp,
		updated_at: timestamp
	});
	state.active_convention_id = conventionId;

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

	for (const [index, roomName] of roomNames.entries()) {
		const capabilities =
			scheduleMode === SCHEDULE_MODES.PEOPLE
				? capabilitiesWithRoomNameTag(roomName, roomCapabilitiesForName(roomName))
				: roomCapabilitiesForName(roomName);
		state.rooms.push(roomRecord(conventionId, roomName, timestamp, capabilities, index));
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
				color: normalizeNullableColor(event.color),
				conflict_tags: normalizeTags(event.conflict_tags),
				co_schedule_tags: normalizeTags(event.co_schedule_tags),
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
	const scheduleMode = normalizeScheduleMode(conventionConfig.scheduleMode ?? conventionConfig.schedule_mode);
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
		schedule_mode: scheduleMode,
		mode_settings: normalizeConventionModeSettings(scheduleMode, conventionConfig.modeSettings),
		created_at: timestamp,
		updated_at: timestamp
	});
	state.active_convention_id = conventionId;

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

	for (const [index, roomName] of roomNames.entries()) {
		const capabilities =
			scheduleMode === SCHEDULE_MODES.PEOPLE
				? capabilitiesWithRoomNameTag(roomName, roomCapabilitiesForName(roomName))
				: roomCapabilitiesForName(roomName);
		state.rooms.push(roomRecord(conventionId, roomName, timestamp, capabilities, index));
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
			min_blocks: normalizePersonFields(entry).min_blocks,
			max_blocks: normalizePersonFields(entry).max_blocks,
			color: normalizeNullableColor(entry.color),
			conflict_tags: normalizePersonFields(entry).conflict_tags,
			co_schedule_tags: normalizePersonFields(entry).co_schedule_tags,
			tag_preferences: normalizePersonFields(entry).tag_preferences,
			created_at: timestamp,
			updated_at: timestamp
		});

		if (Array.isArray(entry.availability_ranges) && entry.availability_ranges.length > 0) {
			for (const slot of conventionSlots) {
				const matched = entry.availability_ranges.find(
					(range) =>
						range.date === slot.date &&
						slot.start_time >= range.start &&
						slot.start_time < range.end
				);
				setAvailabilityExactInternal(personId, slot.id, matched?.tier ?? 3, timestamp);
			}
		} else {
			for (const slot of conventionSlots) {
				upsertAvailability(personId, slot.id, 1, timestamp);
			}
		}

		if (scheduleMode === SCHEDULE_MODES.PEOPLE) continue;

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
				color: normalizeNullableColor(event.color),
				conflict_tags: normalizeTags(event.conflict_tags),
				co_schedule_tags: normalizeTags(event.co_schedule_tags),
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
	if (scheduleMode !== SCHEDULE_MODES.PEOPLE && eventCount === 0) {
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

export function getUndoHistory(conventionId) {
	ensureLoaded();
	return state.undo_history
		.filter((entry) => entry.convention_id === conventionId)
		.sort((a, b) => b.created_at.localeCompare(a.created_at))
		.map(({ snapshot, ...entry }) => entry);
}

export function undoLastActions(conventionId, count = 1) {
	ensureLoaded();
	const amount = Math.max(1, Math.floor(Number(count) || 1));
	const conventionHistory = state.undo_history
		.filter((entry) => entry.convention_id === conventionId)
		.sort((a, b) => b.created_at.localeCompare(a.created_at));
	const selected = conventionHistory.slice(0, amount);
	if (selected.length === 0) return { undone: 0 };
	const target = selected[selected.length - 1];
	restoreConventionSnapshot(conventionId, target.snapshot);
	const selectedIds = new Set(selected.map((entry) => entry.id));
	state.undo_history = state.undo_history.filter((entry) => !selectedIds.has(entry.id));
	persist();
	return { undone: selected.length };
}

function csvEscape(value) {
	const text = String(value ?? '');
	if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
	return text;
}

function rowsToCsv(rows) {
	return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

export function exportDataJson() {
	ensureLoaded();
	return JSON.stringify(
		{
			version: 1,
			exported_at: now(),
			state
		},
		null,
		2
	);
}

function convertEventConventionsToPeopleMode(conventionIds = null) {
	for (const convention of state.conventions) {
		if (conventionIds && !conventionIds.has(convention.id)) continue;
		if (normalizeScheduleMode(convention.schedule_mode) !== SCHEDULE_MODES.EVENTS) continue;

		const eventIds = new Set(
			state.events.filter((event) => event.convention_id === convention.id).map((event) => event.id)
		);

		// Carry every scheduled event over into the people grid: each event's host(s)
		// occupy that event's room for every slot the event spanned. This keeps "who
		// is where, when" intact instead of dropping all placements on conversion.
		const timestamp = now();
		const seen = new Set();
		for (const schedule of state.schedules) {
			if (!eventIds.has(schedule.event_id)) continue;
			const block = getSlotBlock(convention.id, schedule.start_time_slot_id, schedule.slot_count || 1);
			const slots = block.length ? block : state.time_slots.filter((ts) => ts.id === schedule.start_time_slot_id);
			for (const hostId of getEventHostIds(schedule.event_id)) {
				for (const slot of slots) {
					const key = `${hostId}|${schedule.room_id}|${slot.id}`;
					if (seen.has(key)) continue;
					seen.add(key);
					state.people_schedules.push({
						id: crypto.randomUUID(),
						person_id: hostId,
						room_id: schedule.room_id,
						time_slot_id: slot.id,
						status: schedule.status || 'scheduled',
						locked: schedule.locked === true,
						notes: schedule.notes || null,
						created_at: timestamp,
						updated_at: timestamp
					});
				}
			}
		}

		convention.schedule_mode = SCHEDULE_MODES.PEOPLE;
		convention.mode_settings = normalizePeopleModeSettings(convention.mode_settings);
		state.schedules = state.schedules.filter((schedule) => !eventIds.has(schedule.event_id));
		state.event_hosts = state.event_hosts.filter((host) => !eventIds.has(host.event_id));
		state.events = state.events.filter((event) => event.convention_id !== convention.id);
		for (const room of state.rooms.filter((entry) => entry.convention_id === convention.id)) {
			room.capabilities = serializeRoomCapabilities(
				capabilitiesWithRoomNameTag(room.name, room.capabilities)
			);
		}
	}
}

// Appends an imported dataset as fresh, fully isolated profile(s): every id is
// remapped to a new UUID so the import can never collide with — or mutate — the
// profiles already in the store. Returns the new active convention id.
function mergeImportedState(importedState) {
	const maps = {
		convention: new Map(),
		person: new Map(),
		room: new Map(),
		event: new Map(),
		slot: new Map()
	};
	const remap = (map, oldId) => {
		if (oldId == null) return oldId;
		if (!map.has(oldId)) map.set(oldId, crypto.randomUUID());
		return map.get(oldId);
	};
	const list = (value) => (Array.isArray(value) ? value : []);

	for (const convention of list(importedState.conventions)) {
		state.conventions.push({ ...convention, id: remap(maps.convention, convention.id) });
	}
	for (const room of list(importedState.rooms)) {
		state.rooms.push({
			...room,
			id: remap(maps.room, room.id),
			convention_id: remap(maps.convention, room.convention_id)
		});
	}
	for (const person of list(importedState.people)) {
		state.people.push({
			...person,
			id: remap(maps.person, person.id),
			convention_id: remap(maps.convention, person.convention_id)
		});
	}
	for (const event of list(importedState.events)) {
		state.events.push({
			...event,
			id: remap(maps.event, event.id),
			convention_id: remap(maps.convention, event.convention_id)
		});
	}
	for (const slot of list(importedState.time_slots)) {
		state.time_slots.push({
			...slot,
			id: remap(maps.slot, slot.id),
			convention_id: remap(maps.convention, slot.convention_id)
		});
	}
	for (const host of list(importedState.event_hosts)) {
		state.event_hosts.push({
			event_id: remap(maps.event, host.event_id),
			person_id: remap(maps.person, host.person_id)
		});
	}
	for (const schedule of list(importedState.schedules)) {
		state.schedules.push({
			...schedule,
			id: crypto.randomUUID(),
			event_id: remap(maps.event, schedule.event_id),
			room_id: remap(maps.room, schedule.room_id),
			start_time_slot_id: remap(maps.slot, schedule.start_time_slot_id)
		});
	}
	for (const schedule of list(importedState.people_schedules)) {
		state.people_schedules.push({
			...schedule,
			id: crypto.randomUUID(),
			person_id: remap(maps.person, schedule.person_id),
			room_id: remap(maps.room, schedule.room_id),
			time_slot_id: remap(maps.slot, schedule.time_slot_id)
		});
	}
	for (const entry of list(importedState.availability)) {
		state.availability.push({
			...entry,
			id: crypto.randomUUID(),
			person_id: remap(maps.person, entry.person_id),
			time_slot_id: remap(maps.slot, entry.time_slot_id)
		});
	}
	for (const mapping of list(importedState.import_value_mappings)) {
		state.import_value_mappings.push({
			...mapping,
			id: crypto.randomUUID(),
			convention_id: remap(maps.convention, mapping.convention_id)
		});
	}

	const firstConvention = list(importedState.conventions)[0];
	return {
		activeId: firstConvention ? maps.convention.get(firstConvention.id) : null,
		conventionIds: new Set(maps.convention.values())
	};
}

export function importDataJson(jsonText, options = {}) {
	ensureLoaded();
	let parsed;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		throw new Error('Plik nie jest poprawnym plikiem JSON.');
	}
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Plik nie zawiera danych do importu.');
	}

	// Accept every shape we have ever exported:
	//  - legacy full dump:    { version, exported_at, state: {…tables} }
	//  - plan export:         { format: 'grafikonator-6000-plan', data: {…tables} }
	//  - a bare state object: { conventions, people, … }
	const importedState =
		(parsed.state && typeof parsed.state === 'object' && parsed.state) ||
		(parsed.data && typeof parsed.data === 'object' && parsed.data) ||
		parsed;

	if (!Array.isArray(importedState.conventions) || importedState.conventions.length === 0) {
		throw new Error('Plik nie zawiera żadnego konwentu do zaimportowania.');
	}

	// Add the import as new isolated profile(s) instead of replacing the store, so
	// existing profiles are preserved.
	const { activeId, conventionIds } = mergeImportedState(importedState);
	if (options.convertEventsToPeople) convertEventConventionsToPeopleMode(conventionIds);
	if (activeId) state.active_convention_id = activeId;
	migrateLoadedState();
	persist();
	return getConventions();
}

export function exportScheduleCsv(conventionId) {
	ensureLoaded();
	const convention = getConvention(conventionId);
	if (!convention) throw new Error('Nie znaleziono konwentu');
	const mode = normalizeScheduleMode(convention.schedule_mode);
	if (mode === SCHEDULE_MODES.PEOPLE) {
		const rows = [
			[
				'Data',
				'Start',
				'Koniec',
				'Sala',
				'Osoba',
				'Kolor',
				'Min. godzin',
				'Maks. slotów',
				'Tagi wykluczające',
				'Tagi wspólnego slotu',
				'Preferencje stanowisk'
			]
		];
		for (const schedule of getPeopleSchedules(conventionId)) {
			const person = schedule.person || {};
			rows.push([
				schedule.start_slot?.date,
				schedule.start_slot?.start_time,
				schedule.start_slot?.end_time,
				schedule.room?.name,
				person.display_name,
				person.color,
				person.min_blocks,
				person.max_blocks,
				normalizeTags(person.conflict_tags).join('; '),
				normalizeTags(person.co_schedule_tags).join('; '),
				Object.entries(person.tag_preferences || {})
					.map(([tag, tier]) => `${tag}=${tier}`)
					.join('; ')
			]);
		}
		return rowsToCsv(rows);
	}

	const rows = [
		[
			'Data',
			'Start',
			'Koniec',
			'Sala',
			'Tytuł',
			'Prowadzący',
			'Czas min',
			'Tier',
			'Kolor',
			'Tagi wykluczające',
			'Tagi wspólnego slotu'
		]
	];
	for (const schedule of getSchedules(conventionId)) {
		rows.push([
			schedule.start_slot?.date,
			schedule.start_slot?.start_time,
			schedule.start_slot?.end_time,
			schedule.room?.name,
			schedule.event?.title,
			schedule.host_name,
			schedule.event?.duration_minutes,
			schedule.event?.tier,
			schedule.event?.color,
			normalizeTags(schedule.event?.conflict_tags).join('; '),
			normalizeTags(schedule.event?.co_schedule_tags).join('; ')
		]);
	}
	return rowsToCsv(rows);
}

export function clearAllData() {
	state = createEmptyState();
	persist();
}
