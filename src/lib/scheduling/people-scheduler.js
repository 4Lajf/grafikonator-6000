import {
	clusterLimitToNumber,
	haveSharedTags,
	normalizeBlockLimit,
	normalizeClusterLimit,
	normalizeTags
} from './common.js';

export function normalizePreferenceTier(value) {
	const text = String(value ?? '')
		.trim()
		.toLowerCase();
	if (!text) return null;
	if (['1', 'x', 'tak', 'chce', 'chcę', 'spoko', 'ok'].includes(text)) return 1;
	if (
		[
			'2',
			'o',
			'obojętnie',
			'obojetnie',
			'jak braki',
			'jak będą braki',
			'jak beda braki',
			'tylko w razie potrzeby',
			'tylko jeśli będzie potrzeba',
			'tylko jesli bedzie potrzeba',
			'jeśli będzie potrzeba',
			'jesli bedzie potrzeba',
			'if needed'
		].includes(text)
	) {
		return 2;
	}
	if (['3', '-', '#', 'nie', 'nie chce', 'nie chcę', 'nie mogę', 'nie moge'].includes(text)) {
		return 3;
	}
	return null;
}

export function normalizeTagPreferences(value = {}) {
	const result = {};
	if (typeof value === 'string') {
		for (const part of value.split(/[,;\n]/)) {
			const [rawTag, rawTier] = part.split(/[:=]/);
			const tag = rawTag?.trim();
			const tier = normalizePreferenceTier(rawTier);
			if (tag && tier) result[tag] = tier;
		}
		return result;
	}
	for (const [tag, tierValue] of Object.entries(value || {})) {
		const normalized = normalizePreferenceTier(tierValue) ?? Number(tierValue);
		if (tag.trim() && [1, 2, 3].includes(normalized)) result[tag.trim()] = normalized;
	}
	return result;
}

export function normalizePeopleModeSettings(settings = {}) {
	return {
		balance_hours: settings.balance_hours !== false,
		cluster_same_person_limit: normalizeClusterLimit(settings.cluster_same_person_limit)
	};
}

export function normalizePersonSchedulingFields(value = {}) {
	const minBlocks = normalizeBlockLimit(value.min_blocks);
	const maxBlocks = normalizeBlockLimit(value.max_blocks);
	return {
		min_blocks: minBlocks,
		max_blocks:
			maxBlocks != null && minBlocks != null && maxBlocks < minBlocks ? minBlocks : maxBlocks,
		conflict_tags: normalizeTags(value.conflict_tags),
		co_schedule_tags: normalizeTags(value.co_schedule_tags),
		tag_preferences: normalizeTagPreferences(value.tag_preferences)
	};
}

// An unset station preference is treated as "tylko w razie potrzeby" (tier 2),
// matching what the preference dropdowns display by default. This keeps the grid
// highlighter (blue) consistent with the editor UI and the auto-planner.
export const DEFAULT_ROOM_PREFERENCE_TIER = 2;

const LOAD_BALANCE_CURRENT_WEIGHT = 100;
const LOAD_BALANCE_TARGET_WEIGHT = 20;
const CLUSTERED_LOAD_BALANCE_CURRENT_WEIGHT = 35;
const CLUSTERED_LOAD_BALANCE_TARGET_WEIGHT = 8;
const MIN_BLOCK_BONUS = 500;
const AVAILABILITY_TIER_WEIGHT = 400;
const ROOM_PREFERENCE_TIER_2_PENALTY = 80;
const ROOM_PREFERENCE_TIER_1_BONUS = 10;
const CONTINUOUS_SHIFT_BONUS = 1000;
const CO_SCHEDULE_BONUS = 25;
const SAME_ROOM_REUSE_BONUS = 280;
const SAME_FAMILY_REUSE_BONUS = 180;
const ADJACENT_SHIFT_BONUS = 240;
const ADJACENT_ROOM_SWITCH_PENALTY = 520;
const NEW_ROOM_PENALTY = 90;
const NEW_FAMILY_PENALTY = 420;
const SAME_DAY_GAP_PENALTY = 90;
const ISOLATED_SHIFT_PENALTY = 260;
const PLAN_ROOM_COUNT_WEIGHT = 260;
const PLAN_FAMILY_COUNT_WEIGHT = 420;
const PLAN_ROOM_SWITCH_WEIGHT = 650;
const PLAN_ISOLATED_SHIFT_WEIGHT = 320;
const PLAN_GAP_WEIGHT = 45;
const PLAN_LOCAL_SEARCH_PASS_LIMIT = 4;
const PLAN_LOCAL_SEARCH_EVALUATION_LIMIT = 6000;

function normalizeTier(value, fallback = 2) {
	const n = Number(value);
	return n === 1 || n === 2 || n === 3 ? n : fallback;
}

function slotPriorityMultiplier(slotTier) {
	const tier = normalizeTier(slotTier, 2);
	if (tier === 1) return 2;
	if (tier === 3) return 0.25;
	return 1;
}

function availabilityTierPenalty(availabilityTier, slotTier) {
	const tier = normalizeTier(availabilityTier, 1);
	return (tier - 1) * AVAILABILITY_TIER_WEIGHT * slotPriorityMultiplier(slotTier);
}

function parseRoomCapabilities(capabilities) {
	if (!capabilities) return {};
	if (typeof capabilities === 'string') {
		try {
			return JSON.parse(capabilities);
		} catch {
			return {};
		}
	}
	return capabilities;
}

function normalizeKey(value) {
	return String(value ?? '')
		.trim()
		.toLowerCase();
}

function inferRoomFamilyName(name) {
	const text = String(name ?? '').trim();
	if (!text) return null;
	const stripped = text.replace(/(?:[\s_-]*\d+)$/, '').trim();
	return stripped && stripped !== text ? stripped : null;
}

export function roomPreferenceKeys(room) {
	const capabilities = parseRoomCapabilities(room?.capabilities);
	return [
		...new Set(
			[room?.name, inferRoomFamilyName(room?.name), ...normalizeTags(capabilities?.tags)].filter(
				Boolean
			)
		)
	];
}

export function getRoomPreferenceTier(person, room) {
	const preferences = normalizeTagPreferences(person?.tag_preferences);
	let matched = null;
	for (const tag of roomPreferenceKeys(room)) {
		const entry = Object.entries(preferences).find(
			([prefTag]) => prefTag.toLowerCase() === String(tag).toLowerCase()
		);
		if (!entry) continue;
		const tier = Number(entry[1]);
		if ([1, 2, 3].includes(tier)) matched = matched == null ? tier : Math.max(matched, tier);
	}
	return matched ?? DEFAULT_ROOM_PREFERENCE_TIER;
}

// Maps a station preference tier to the severity used for grid highlighting.
// 1 (chcę) -> ok/green, 2 (tylko w razie potrzeby) -> info/blue, 3 (nie chcę) -> error/red.
export function roomPreferenceSeverity(tier) {
	if (Number(tier) === 3) return 'error';
	if (Number(tier) === 2) return 'info';
	return 'ok';
}

function getPersonCount(counts, personId) {
	return counts.get(personId) ?? 0;
}

function buildRoomInfo(rooms) {
	return new Map(
		rooms.map((room) => {
			const keys = roomPreferenceKeys(room);
			const roomNameKey = normalizeKey(room.name);
			const familyKeys = keys.map(normalizeKey).filter((key) => key && key !== roomNameKey);
			return [
				room.id,
				{
					room,
					keys,
					familyKeys: familyKeys.length ? familyKeys : [roomNameKey].filter(Boolean)
				}
			];
		})
	);
}

function placementConflicts(placement, selected, peopleById) {
	const person = peopleById.get(placement.person_id);
	for (const other of selected) {
		if (other.room_id === placement.room_id && other.time_slot_id === placement.time_slot_id)
			return true;
		if (other.person_id === placement.person_id && other.time_slot_id === placement.time_slot_id)
			return true;
		const otherPerson = peopleById.get(other.person_id);
		if (
			haveSharedTags(person?.conflict_tags, otherPerson?.conflict_tags) &&
			other.time_slot_id === placement.time_slot_id
		) {
			return true;
		}
	}
	return false;
}

// Length of the back-to-back run of earlier slots (same day, same station) the
// person is already assigned to immediately before this placement's slot.
function consecutiveRunBefore(placement, selected, slotOrder) {
	const me = slotOrder.get(placement.time_slot_id);
	if (!me) return 0;
	const assignedIdx = new Set();
	for (const entry of selected) {
		if (entry.person_id !== placement.person_id || entry.room_id !== placement.room_id) continue;
		const pos = slotOrder.get(entry.time_slot_id);
		if (pos && pos.date === me.date) assignedIdx.add(pos.index);
	}
	let run = 0;
	let idx = me.index - 1;
	while (assignedIdx.has(idx)) {
		run++;
		idx--;
	}
	return run;
}

function personPlacementStats(personId, selected, slotOrder, roomInfoById) {
	const rooms = new Set();
	const families = new Set();
	const sameDate = new Map();
	for (const entry of selected) {
		if (entry.person_id !== personId) continue;
		rooms.add(entry.room_id);
		for (const familyKey of roomInfoById.get(entry.room_id)?.familyKeys || []) {
			families.add(familyKey);
		}
		const pos = slotOrder.get(entry.time_slot_id);
		if (!pos) continue;
		if (!sameDate.has(pos.date)) sameDate.set(pos.date, []);
		sameDate.get(pos.date).push({
			index: pos.index,
			roomId: entry.room_id
		});
	}
	return { rooms, families, sameDate };
}

function shiftShapeScore(placement, selected, cluster, roomInfoById) {
	if (!cluster?.maxRun) return 0;
	const pos = cluster.slotOrder.get(placement.time_slot_id);
	if (!pos) return 0;
	const stats = personPlacementStats(
		placement.person_id,
		selected,
		cluster.slotOrder,
		roomInfoById
	);
	const roomInfo = roomInfoById.get(placement.room_id);
	const placementFamilies = roomInfo?.familyKeys || [];
	let score = 0;

	if (stats.rooms.has(placement.room_id)) {
		score -= SAME_ROOM_REUSE_BONUS;
	} else if (stats.rooms.size > 0) {
		score += NEW_ROOM_PENALTY;
	}

	const sharesFamily = placementFamilies.some((key) => stats.families.has(key));
	if (sharesFamily) {
		score -= SAME_FAMILY_REUSE_BONUS;
	} else if (stats.families.size > 0 && placementFamilies.length) {
		score += NEW_FAMILY_PENALTY;
	}

	const sameDay = stats.sameDate.get(pos.date) || [];
	if (sameDay.length) {
		const nearestDistance = Math.min(...sameDay.map((entry) => Math.abs(entry.index - pos.index)));
		const hasAdjacentSameRoom = sameDay.some(
			(entry) => entry.index === pos.index - 1 && entry.roomId === placement.room_id
		);
		const hasAdjacentDifferentRoom = sameDay.some(
			(entry) => Math.abs(entry.index - pos.index) === 1 && entry.roomId !== placement.room_id
		);
		if (hasAdjacentSameRoom) {
			score -= ADJACENT_SHIFT_BONUS;
		} else if (hasAdjacentDifferentRoom) {
			score += ADJACENT_ROOM_SWITCH_PENALTY;
		} else {
			score += ISOLATED_SHIFT_PENALTY + Math.min(nearestDistance - 1, 4) * SAME_DAY_GAP_PENALTY;
		}
	}

	return score;
}

function placementScore(
	placement,
	selected,
	counts,
	peopleById,
	target,
	roomsById,
	roomInfoById,
	cluster,
	settings
) {
	const person = peopleById.get(placement.person_id);
	const current = getPersonCount(counts, placement.person_id);
	const max = person?.max_blocks;
	if (max != null && current >= max) return Number.POSITIVE_INFINITY;

	let score = 0;
	if (settings?.balance_hours !== false) {
		const currentWeight = cluster?.maxRun
			? CLUSTERED_LOAD_BALANCE_CURRENT_WEIGHT
			: LOAD_BALANCE_CURRENT_WEIGHT;
		const targetWeight = cluster?.maxRun
			? CLUSTERED_LOAD_BALANCE_TARGET_WEIGHT
			: LOAD_BALANCE_TARGET_WEIGHT;
		score += current * currentWeight;
		if (target != null) score += Math.abs(current + 1 - target) * targetWeight;
	}
	if (person?.min_blocks != null && current < person.min_blocks) score -= MIN_BLOCK_BONUS;
	score += availabilityTierPenalty(placement.availability_tier, placement.time_slot_tier);
	const roomPreferenceTier = getRoomPreferenceTier(person, roomsById.get(placement.room_id));
	if (roomPreferenceTier === 3) return Number.POSITIVE_INFINITY;
	if (roomPreferenceTier === 2) score += ROOM_PREFERENCE_TIER_2_PENALTY;
	if (roomPreferenceTier === 1) score -= ROOM_PREFERENCE_TIER_1_BONUS;

	// Clustering: keep each person on a continuous shift in one station, capped at
	// the chosen run length. Continuing a run is strongly preferred over starting a
	// scattered slot; extending past the cap is forbidden so a break is forced.
	if (cluster?.maxRun) {
		const run = consecutiveRunBefore(placement, selected, cluster.slotOrder);
		if (run > 0) {
			if (Number.isFinite(cluster.maxRun) && run >= cluster.maxRun) return Number.POSITIVE_INFINITY;
			score -= CONTINUOUS_SHIFT_BONUS;
		}
	}
	score += shiftShapeScore(placement, selected, cluster, roomInfoById);

	for (const other of selected) {
		const otherPerson = peopleById.get(other.person_id);
		if (
			other.time_slot_id === placement.time_slot_id &&
			haveSharedTags(person?.co_schedule_tags, otherPerson?.co_schedule_tags)
		) {
			score -= CO_SCHEDULE_BONUS;
		}
	}

	return score;
}

function buildSlotOrder(slots) {
	const ordered = [...slots].sort((a, b) => {
		const da = String(a.date ?? '');
		const db = String(b.date ?? '');
		if (da !== db) return da.localeCompare(db);
		return String(a.start_time ?? '').localeCompare(String(b.start_time ?? ''));
	});
	const slotOrder = new Map();
	const perDateIndex = new Map();
	for (const slot of ordered) {
		const date = String(slot.date ?? '');
		const index = perDateIndex.get(date) ?? 0;
		slotOrder.set(slot.id, { date, index });
		perDateIndex.set(date, index + 1);
	}
	return { ordered, slotOrder };
}

function countEligiblePeopleForCell(people, room, slot, availabilityTier) {
	return people.filter((person) => {
		const tier = availabilityTier.get(`${person.id}|${slot.id}`) ?? 1;
		return tier < 3 && getRoomPreferenceTier(person, room) !== 3;
	}).length;
}

function personPlanStats(personId, plan, slotOrder, roomInfoById) {
	const rooms = new Set();
	const families = new Set();
	const byDate = new Map();
	for (const entry of plan) {
		if (entry.person_id !== personId) continue;
		rooms.add(entry.room_id);
		for (const familyKey of roomInfoById.get(entry.room_id)?.familyKeys || []) {
			families.add(familyKey);
		}
		const pos = slotOrder.get(entry.time_slot_id);
		if (!pos) continue;
		if (!byDate.has(pos.date)) byDate.set(pos.date, []);
		byDate.get(pos.date).push({
			index: pos.index,
			roomId: entry.room_id
		});
	}

	let switches = 0;
	let gaps = 0;
	let isolated = 0;
	let maxRun = 0;
	for (const entries of byDate.values()) {
		entries.sort((a, b) => a.index - b.index);
		for (let i = 1; i < entries.length; i++) {
			const distance = entries[i].index - entries[i - 1].index;
			if (distance > 1) gaps += distance - 1;
			if (distance === 1 && entries[i].roomId !== entries[i - 1].roomId) switches++;
		}
		let i = 0;
		while (i < entries.length) {
			let j = i;
			while (
				j + 1 < entries.length &&
				entries[j + 1].index - entries[j].index === 1 &&
				entries[j + 1].roomId === entries[j].roomId
			) {
				j++;
			}
			const run = j - i + 1;
			if (run === 1) isolated++;
			maxRun = Math.max(maxRun, run);
			i = j + 1;
		}
	}

	return { rooms, families, switches, gaps, isolated, maxRun };
}

function planScore(plan, context) {
	let score = 0;
	const seenCells = new Set();
	const seenPersonSlots = new Set();
	const peopleInPlan = new Set();
	const fixedPlacements = context.fixedPlacements ?? [];
	const combinedPlan = fixedPlacements.length ? [...fixedPlacements, ...plan] : plan;

	for (const entry of fixedPlacements) {
		const cellKey = `${entry.room_id}|${entry.time_slot_id}`;
		if (seenCells.has(cellKey)) return Number.POSITIVE_INFINITY;
		seenCells.add(cellKey);
		const personSlotKey = `${entry.person_id}|${entry.time_slot_id}`;
		if (seenPersonSlots.has(personSlotKey)) return Number.POSITIVE_INFINITY;
		seenPersonSlots.add(personSlotKey);
	}

	for (const entry of plan) {
		const cellKey = `${entry.room_id}|${entry.time_slot_id}`;
		if (seenCells.has(cellKey)) return Number.POSITIVE_INFINITY;
		seenCells.add(cellKey);
		const personSlotKey = `${entry.person_id}|${entry.time_slot_id}`;
		if (seenPersonSlots.has(personSlotKey)) return Number.POSITIVE_INFINITY;
		seenPersonSlots.add(personSlotKey);
		peopleInPlan.add(entry.person_id);

		const availabilityTier =
			context.availabilityTier.get(`${entry.person_id}|${entry.time_slot_id}`) ?? 1;
		if (availabilityTier >= 3) return Number.POSITIVE_INFINITY;
		score += availabilityTierPenalty(
			availabilityTier,
			context.slotTier.get(entry.time_slot_id) ?? 2
		);

		const person = context.peopleById.get(entry.person_id);
		const room = context.roomsById.get(entry.room_id);
		const roomPreferenceTier = getRoomPreferenceTier(person, room);
		if (roomPreferenceTier === 3) return Number.POSITIVE_INFINITY;
		if (roomPreferenceTier === 2) score += ROOM_PREFERENCE_TIER_2_PENALTY;
		if (roomPreferenceTier === 1) score -= ROOM_PREFERENCE_TIER_1_BONUS;
	}

	for (const personId of peopleInPlan) {
		const stats = personPlanStats(personId, combinedPlan, context.slotOrder, context.roomInfoById);
		if (
			context.cluster?.maxRun &&
			Number.isFinite(context.cluster.maxRun) &&
			stats.maxRun > context.cluster.maxRun
		) {
			return Number.POSITIVE_INFINITY;
		}
		score += Math.max(0, stats.rooms.size - 1) * PLAN_ROOM_COUNT_WEIGHT;
		score += Math.max(0, stats.families.size - 1) * PLAN_FAMILY_COUNT_WEIGHT;
		score += stats.switches * PLAN_ROOM_SWITCH_WEIGHT;
		score += stats.isolated * PLAN_ISOLATED_SHIFT_WEIGHT;
		score += stats.gaps * PLAN_GAP_WEIGHT;
	}

	return score;
}

function validPlanSwap(plan, leftIndex, rightIndex, context) {
	const left = plan[leftIndex];
	const right = plan[rightIndex];
	if (left.person_id === right.person_id) return null;

	const swappedLeft = { ...left, person_id: right.person_id };
	const swappedRight = { ...right, person_id: left.person_id };
	const base = [
		...(context.fixedPlacements ?? []),
		...plan.filter((_, index) => index !== leftIndex && index !== rightIndex)
	];
	if (placementConflicts(swappedLeft, base, context.peopleById)) return null;
	if (placementConflicts(swappedRight, [...base, swappedLeft], context.peopleById)) return null;

	const swapped = [...plan];
	swapped[leftIndex] = swappedLeft;
	swapped[rightIndex] = swappedRight;
	return swapped;
}

function improvePeoplePlanWithSwaps(plan, context) {
	if (!context.cluster?.maxRun || plan.length < 2) return plan;
	let current = plan;
	let currentScore = planScore(current, context);

	for (let pass = 0; pass < PLAN_LOCAL_SEARCH_PASS_LIMIT; pass++) {
		let improved = false;
		let evaluated = 0;

		search: for (let i = 0; i < current.length; i++) {
			for (let j = i + 1; j < current.length; j++) {
				if (evaluated++ >= PLAN_LOCAL_SEARCH_EVALUATION_LIMIT) break search;
				const swapped = validPlanSwap(current, i, j, context);
				if (!swapped) continue;
				const swappedScore = planScore(swapped, context);
				if (swappedScore < currentScore) {
					current = swapped;
					currentScore = swappedScore;
					improved = true;
					break search;
				}
			}
		}

		if (!improved) break;
	}

	return current;
}

export function buildPeopleAutoSchedulePlan({
	people,
	rooms,
	slots,
	availability,
	existingSchedules,
	settings = {}
}) {
	const peopleById = new Map(people.map((person) => [person.id, person]));
	const roomsById = new Map(rooms.map((room) => [room.id, room]));
	const roomInfoById = buildRoomInfo(rooms);
	const availabilityTier = new Map(
		availability.map((entry) => [
			`${entry.person_id}|${entry.time_slot_id}`,
			Number(entry.tier) || 1
		])
	);
	const slotTier = new Map(slots.map((slot) => [slot.id, normalizeTier(slot.tier, 2)]));
	const { ordered: orderedSlots, slotOrder } = buildSlotOrder(slots);
	const normalizedSettings = normalizePeopleModeSettings(settings);
	const clusterMaxRun = clusterLimitToNumber(normalizedSettings.cluster_same_person_limit);
	const cluster = clusterMaxRun ? { maxRun: clusterMaxRun, slotOrder } : null;
	const selected = existingSchedules
		.filter((entry) => entry.locked)
		.map((entry) => ({
			person_id: entry.person_id,
			room_id: entry.room_id,
			time_slot_id: entry.time_slot_id
		}));
	const counts = new Map();
	for (const entry of selected) {
		counts.set(entry.person_id, getPersonCount(counts, entry.person_id) + 1);
	}

	// Iterate chronologically so a person's earlier slots are already placed when we
	// score the next one — that is what lets clustering extend a continuous shift.
	const unlockedCells = [];
	for (const slot of orderedSlots) {
		const orderedRooms = [...rooms].sort((a, b) => {
			const aCount = countEligiblePeopleForCell(people, a, slot, availabilityTier);
			const bCount = countEligiblePeopleForCell(people, b, slot, availabilityTier);
			if (aCount !== bCount) return aCount - bCount;
			return rooms.indexOf(a) - rooms.indexOf(b);
		});
		for (const room of orderedRooms) {
			if (selected.some((entry) => entry.room_id === room.id && entry.time_slot_id === slot.id))
				continue;
			unlockedCells.push({ room, slot });
		}
	}

	const totalCapacity = unlockedCells.length + selected.length;
	const target =
		normalizedSettings.balance_hours !== false && people.length
			? totalCapacity / people.length
			: null;
	const placements = [];

	for (const cell of unlockedCells) {
		const candidates = people
			.map((person) => ({
				person_id: person.id,
				room_id: cell.room.id,
				time_slot_id: cell.slot.id,
				availability_tier: availabilityTier.get(`${person.id}|${cell.slot.id}`) ?? 1,
				time_slot_tier: slotTier.get(cell.slot.id) ?? 2
			}))
			.filter((candidate) => candidate.availability_tier < 3)
			.filter(
				(candidate) => !placementConflicts(candidate, [...selected, ...placements], peopleById)
			)
			.map((candidate) => ({
				...candidate,
				score: placementScore(
					candidate,
					[...selected, ...placements],
					counts,
					peopleById,
					target,
					roomsById,
					roomInfoById,
					cluster,
					normalizedSettings
				)
			}))
			.filter((candidate) => Number.isFinite(candidate.score))
			.sort((a, b) => a.score - b.score);

		const best = candidates[0];
		if (!best) continue;
		placements.push(best);
		counts.set(best.person_id, getPersonCount(counts, best.person_id) + 1);
	}

	return improvePeoplePlanWithSwaps(placements, {
		peopleById,
		roomsById,
		roomInfoById,
		availabilityTier,
		slotTier,
		slotOrder,
		cluster,
		fixedPlacements: selected
	});
}
