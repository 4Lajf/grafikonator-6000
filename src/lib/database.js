import * as db from './local-db.js';
import { previewImport, executeImport, APP_FIELDS } from './import/importer.js';

// Conventions
export async function getConventions() {
	return db.getConventions();
}

export async function createConvention(data) {
	return db.createConvention(data);
}

export async function updateConvention(id, updates) {
	return db.updateConvention(id, updates);
}

export async function getConventionDayHours(conventionId) {
	return db.getConventionDayHours(conventionId);
}

// People
export async function getPeople(conventionId) {
	return db.getPeople(conventionId);
}

export async function createPerson(conventionId, data) {
	return db.createPerson(conventionId, data);
}

export async function updatePerson(id, updates) {
	return db.updatePerson(id, updates);
}

export async function deletePerson(id) {
	return db.deletePerson(id);
}

export async function getPersonWithDetails(personId) {
	return db.getPersonWithDetails(personId);
}

export async function getPersonAvailabilityGrid(personId, conventionId) {
	return db.getPersonAvailabilityGrid(personId, conventionId);
}

export async function setPersonAvailabilityBulk(personId, slotTiers) {
	return db.setPersonAvailabilityBulk(personId, slotTiers);
}

// Rooms
export async function getRooms(conventionId) {
	return db.getRooms(conventionId);
}

export async function createRoom(conventionId, data) {
	return db.createRoom(conventionId, data);
}

export async function updateRoom(id, updates) {
	return db.updateRoom(id, updates);
}

export async function deleteRoom(id) {
	return db.deleteRoom(id);
}

// Events
export async function getEvents(conventionId) {
	return db.getEvents(conventionId);
}

export async function getUnscheduledEvents(conventionId) {
	return db.getUnscheduledEvents(conventionId);
}

export async function createEvent(conventionId, personId, data) {
	return db.createEvent(conventionId, personId, data);
}

export async function updateEvent(id, updates) {
	return db.updateEvent(id, updates);
}

export async function deleteEvent(id) {
	return db.deleteEvent(id);
}

// Time slots
export async function getTimeSlots(conventionId, date = null) {
	return db.getTimeSlots(conventionId, date);
}

export async function generateTimeSlots(conventionId) {
	return db.generateTimeSlotsForConvention(conventionId);
}

export async function updateTimeSlot(id, updates) {
	return db.updateTimeSlot(id, updates);
}

// Availability
export async function getAvailability(conventionId, date = null, personId = null) {
	return db.getAvailability(conventionId, date, personId);
}

export async function setAvailability(personId, timeSlotId, tier) {
	return db.setAvailability(personId, timeSlotId, tier);
}

// Schedules
export async function getSchedules(conventionId, date = null) {
	return db.getSchedules(conventionId, date);
}

export async function getPersonHours(conventionId) {
	return db.getPersonHours(conventionId);
}

export async function createSchedule(schedule) {
	return db.createSchedule(schedule);
}

export async function updateSchedule(id, updates) {
	return db.updateSchedule(id, updates);
}

export async function deleteSchedule(id) {
	return db.deleteSchedule(id);
}

export async function clearAllSchedules(conventionId) {
	return db.clearAllSchedules(conventionId);
}

export async function swapSchedules(scheduleIdA, scheduleIdB) {
	return db.swapSchedules(scheduleIdA, scheduleIdB);
}

export async function validateScheduleMove(scheduleId, roomId, startTimeSlotId) {
	return db.validateScheduleMove(scheduleId, roomId, startTimeSlotId);
}

export async function validateEventPlacement(eventId, roomId, startTimeSlotId, excludeScheduleId = null) {
	return db.validateEventPlacement(eventId, roomId, startTimeSlotId, excludeScheduleId);
}

export async function autoScheduleEvent(eventId, onProgress = null, progress = {}) {
	return db.autoScheduleEvent(eventId, onProgress, progress);
}

export async function autoScheduleAll(conventionId, onProgress = null) {
	return db.autoScheduleAll(conventionId, onProgress);
}

// Import
export async function getImportFields() {
	return { fields: APP_FIELDS };
}

export { previewImport, executeImport };

export async function createManualConvention(data) {
	return db.createManualConvention(data);
}

// Tier labels
export const TIER_OPTIONS = [
	{ value: 1, label: 'Mogę (100%)', color: 'bg-green-100 text-green-800 border-green-300' },
	{ value: 2, label: 'Wolę nie', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
	{ value: 3, label: 'Nie mogę (100%)', color: 'bg-red-100 text-red-800 border-red-300' }
];

export const EVENT_TIER_OPTIONS = [
	{ value: 1, label: 'Tier 1 (najwyższy priorytet)' },
	{ value: 2, label: 'Tier 2 (średni priorytet)' },
	{ value: 3, label: 'Tier 3 (najniższy priorytet)' }
];

export const SLOT_TIER_OPTIONS = [
	{ value: 1, label: 'Tier 1 (najbardziej popularny slot)' },
	{ value: 2, label: 'Tier 2 (neutralny slot)' },
	{ value: 3, label: 'Tier 3 (najmniej popularny slot)' }
];

export function getTierInfo(tier) {
	return TIER_OPTIONS.find((t) => t.value === tier) || TIER_OPTIONS[2];
}
