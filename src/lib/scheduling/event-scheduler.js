import {
	normalizeTags,
	CLUSTER_LIMIT_OPTIONS,
	normalizeClusterLimit,
	clusterLimitToNumber
} from './common.js';

export { CLUSTER_LIMIT_OPTIONS, normalizeClusterLimit, clusterLimitToNumber };

export function normalizeEventModeSettings(settings = {}) {
	return {
		cluster_same_person_limit: normalizeClusterLimit(settings.cluster_same_person_limit)
	};
}

export function normalizeEventMetadata(value = {}) {
	return {
		color: value.color ?? null,
		conflict_tags: normalizeTags(value.conflict_tags),
		co_schedule_tags: normalizeTags(value.co_schedule_tags)
	};
}

export function getClusterPenalty(item, placement, plannedPlacements, slotById, hostIdsByEventId, settings) {
	const limit = clusterLimitToNumber(settings?.cluster_same_person_limit);
	if (!limit || !Number.isFinite(limit) && limit !== Number.POSITIVE_INFINITY) return 0;

	const slot = slotById.get(placement.start_time_slot_id);
	if (!slot) return 0;
	let penalty = 0;
	for (const hostId of hostIdsByEventId.get(item.eventId) || []) {
		let sameHostSameDay = 0;
		for (const other of plannedPlacements) {
			if (!hostIdsByEventId.get(other.eventId)?.includes(hostId)) continue;
			const otherSlot = slotById.get(other.start_time_slot_id);
			if (otherSlot?.date === slot.date) sameHostSameDay++;
		}
		if (sameHostSameDay >= limit) penalty += sameHostSameDay - limit + 1;
	}
	return penalty;
}
