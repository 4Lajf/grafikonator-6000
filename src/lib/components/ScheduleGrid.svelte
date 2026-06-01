<script>
	import { onMount, tick } from 'svelte';
	import {
		getConventions,
		getRooms,
		getTimeSlots,
		getSchedules,
		getUnscheduledEvents,
		autoScheduleAll,
		clearAllSchedules,
		createSchedule,
		updateSchedule,
		deleteSchedule,
		swapSchedules,
		getAvailability
	} from '$lib/database.js';
	import Button from '$lib/components/ui/button/button.svelte';
	import Card from '$lib/components/ui/card/card.svelte';
	import { toast } from 'svelte-sonner';
	import { CircleAlert, TriangleAlert } from 'lucide-svelte';
	import ScheduleEventPanel from '$lib/components/ScheduleEventPanel.svelte';

	function waitForPaint() {
		return new Promise((resolve) => {
			requestAnimationFrame(() => {
				requestAnimationFrame(resolve);
			});
		});
	}

	async function flushUi() {
		await tick();
		await waitForPaint();
	}

	let convention = $state(null);
	let rooms = $state([]);
	let timeSlots = $state([]);
	let schedules = $state([]);
	let unscheduled = $state([]);
	let availability = $state([]);
	let loading = $state(true);
	let autoScheduling = $state(false);
	let autoScheduleProgress = $state({ current: 0, total: 0, phase: '' });
	let showIssuesPanel = $state(true);
	let daySections = $state([]);
	let selectedSchedule = $state(null);
	let selectedUnscheduledEvent = $state(null);
	let panelAnchorRect = $state(null);
	let blockNextClick = $state(false);

	const TIME_COL_WIDTH = 56;
	const ROOM_COL_WIDTH = 240;
	const SLOT_HEIGHT = 30;
	const DRAG_THRESHOLD = 5;
	const PREVIEW_SCHEDULE_ID = '__preview__';

	let dragState = $state(null);
	let dropPreview = $state(null);
	let placementHints = $state({ cells: new Map(), swaps: new Map() });

	let dropPreviewFrame = null;
	let pendingPreviewCoords = null;
	let dropTargetRects = [];
	let sheetScrollEl = null;
	let hintIndexes = {
		availabilityTier: new Map(),
		daySchedules: new Map(),
		slotIndexByDate: new Map(),
		slotById: new Map()
	};

	const SEVERITY = {
		ERROR: 'error',
		WARNING: 'warning',
		INFO: 'info'
	};

	const TIER_COLORS = {
		1: { bg: '#e6f4ea', border: '#34a853', text: '#137333', label: 'OK' },
		2: { bg: '#fef7e0', border: '#fbbc04', text: '#b06000', label: 'Wolę nie' },
		3: { bg: '#fce8e6', border: '#ea4335', text: '#c5221f', label: 'Nie mogę' }
	};

	const ISSUE_COLORS = {
		error: { bg: '#fce8e6', border: '#ea4335', text: '#c5221f', label: 'Błąd' },
		warning: { bg: '#fef7e0', border: '#f9ab00', text: '#b06000', label: 'Ostrzeżenie' }
	};

	function formatTime(timeStr) {
		return String(timeStr || '').slice(0, 5);
	}

	function isHourStart(timeStr) {
		return formatTime(timeStr).endsWith(':00');
	}

	function hostLabel(item) {
		if (item?.host_name) return item.host_name;
		if (item?.hosts?.length) return item.hosts.map((h) => h.display_name).filter(Boolean).join(', ');
		return '—';
	}

	function formatDate(dateStr) {
		if (!dateStr) return '';
		const [year, month, day] = dateStr.split('-').map(Number);
		return new Date(year, month - 1, day).toLocaleDateString('pl-PL', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
	}

	function getDayTimeSlots(date) {
		return timeSlots.filter((ts) => ts.date === date);
	}

	function getEndTime(schedule) {
		const dayTimeSlots = getDayTimeSlots(schedule.start_slot?.date);
		const startIdx = dayTimeSlots.findIndex((ts) => ts.id === schedule.start_time_slot_id);
		if (startIdx < 0) return '';
		const endSlot = dayTimeSlots[startIdx + schedule.slot_count - 1];
		return formatTime(endSlot?.end_time);
	}

	const TILE_META_HEIGHT = 22;
	const TILE_TITLE_LINE_HEIGHT = 16;
	const TILE_VERTICAL_PADDING = 6;

	function getSlotTileHeight(slotCount) {
		return slotCount * SLOT_HEIGHT - 2;
	}

	function getMaxTitleLines(slotCount) {
		const availableHeight =
			getSlotTileHeight(slotCount) - TILE_META_HEIGHT - TILE_VERTICAL_PADDING;
		return Math.max(1, Math.floor(availableHeight / TILE_TITLE_LINE_HEIGHT));
	}

	function getHostIds(schedule) {
		return schedule.hosts?.map((h) => h.id) || [];
	}

	function getSlotRange(schedule, dayTimeSlots = getDayTimeSlots(schedule.start_slot?.date)) {
		const startIdx = dayTimeSlots.findIndex((ts) => ts.id === schedule.start_time_slot_id);
		if (startIdx < 0) return [];
		return dayTimeSlots.slice(startIdx, startIdx + schedule.slot_count).map((s) => s.id);
	}

	function getAvailabilityTier(personId, slotId) {
		return hintIndexes.availabilityTier.get(`${personId}|${slotId}`) ?? 3;
	}

	function getScheduleWorstTier(schedule) {
		const hostIds = getHostIds(schedule);
		if (!hostIds.length) return 1;
		const slotIds = getSlotRange(schedule);
		let worst = 1;
		for (const hostId of hostIds) {
			for (const slotId of slotIds) {
				worst = Math.max(worst, getAvailabilityTier(hostId, slotId));
			}
		}
		return worst;
	}

	function pushIssue(result, issue) {
		result.push(issue);
	}

	function pushConsecutiveRunIssues(result, sorted, runStart, runEnd, hostId, consecutive) {
		const person = schedules
			.find((s) => s.id === sorted[runStart].sched.id)
			?.hosts?.find((h) => h.id === hostId);
		const message = `${person?.display_name || 'Prowadzący'}: ${consecutive} slotów bez przerwy`;
		for (let j = runStart; j <= runEnd; j++) {
			pushIssue(result, {
				severity: SEVERITY.WARNING,
				message,
				scheduleId: sorted[j].sched.id,
				personId: hostId
			});
		}
	}

	function dedupeIssues(issueList) {
		const uniqueIssues = [];
		const seen = new Set();
		for (const issue of issueList) {
			const key = `${issue.severity}|${issue.message}|${issue.scheduleId}|${issue.personId ?? ''}`;
			if (!seen.has(key)) {
				seen.add(key);
				uniqueIssues.push(issue);
			}
		}
		return uniqueIssues;
	}

	function getTileAppearance(scheduleId, tier) {
		const scheduleIssues = issues.filter((issue) => issue.scheduleId === scheduleId);
		return appearanceFromIssues(scheduleIssues, tier);
	}

	function appearanceFromIssues(scheduleIssues, tier) {
		const hasError = scheduleIssues.some((issue) => issue.severity === SEVERITY.ERROR);
		const hasWarning = scheduleIssues.some((issue) => issue.severity === SEVERITY.WARNING);

		if (hasError) {
			return {
				...ISSUE_COLORS.error,
				kind: 'error',
				messages: scheduleIssues.map((issue) => issue.message)
			};
		}
		if (hasWarning) {
			return {
				...ISSUE_COLORS.warning,
				kind: 'warning',
				messages: scheduleIssues.map((issue) => issue.message)
			};
		}

		const tierStyle = TIER_COLORS[tier] || TIER_COLORS[1];
		return {
			...tierStyle,
			kind: 'ok',
			messages: []
		};
	}

	function collectHypotheticalIssues(hypotheticalSchedules) {
		const result = [];
		const dates = [...new Set(timeSlots.map((ts) => ts.date))].sort();
		for (const date of dates) {
			const dayTimeSlots = timeSlots.filter((ts) => ts.date === date);
			const daySchedules = hypotheticalSchedules.filter((s) =>
				dayTimeSlots.some((ts) => ts.id === s.start_time_slot_id)
			);
			if (!dayTimeSlots.length || !daySchedules.length) continue;
			collectIssuesForDay(daySchedules, dayTimeSlots, result);
		}
		return dedupeIssues(result);
	}

	function getEventSlotCount(event) {
		if (!convention?.slot_minutes) return 1;
		return Math.ceil(event.duration_minutes / convention.slot_minutes);
	}

	function makeUnscheduledDragItem(event) {
		return {
			id: `unscheduled-${event.id}`,
			isUnscheduled: true,
			eventId: event.id,
			schedule: {
				slot_count: getEventSlotCount(event),
				event,
				hosts: event.hosts,
				host_name: event.host_name,
				room_id: null,
				start_time_slot_id: null
			}
		};
	}

	function getPreviewScheduleId(item) {
		return item.isUnscheduled ? PREVIEW_SCHEDULE_ID : item.id;
	}

	function patchSchedulePlacement(sched, roomId, startTimeSlotId) {
		const slot = timeSlots.find((ts) => ts.id === startTimeSlotId);
		sched.room_id = roomId;
		sched.start_time_slot_id = startTimeSlotId;
		if (slot) sched.start_slot = slot;
	}

	function buildHypotheticalSchedules(item, target) {
		const hyp = schedules.map((s) => ({
			...s,
			start_slot: s.start_slot ? { ...s.start_slot } : null
		}));

		if (item.isUnscheduled) {
			const day = daySections[target.dayIdx];
			const daySchedules = hyp.filter((s) =>
				day.timeSlots.some((ts) => ts.id === s.start_time_slot_id)
			);
			const existing = findOccupyingSchedule(
				target.roomId,
				target.rowIdx,
				item.schedule.slot_count,
				daySchedules,
				day.timeSlots,
				null
			);

			if (existing) {
				const idx = hyp.findIndex((s) => s.id === existing.id);
				if (idx >= 0) hyp.splice(idx, 1);
			}

			const slot = timeSlots.find((ts) => ts.id === target.startTimeSlotId);
			hyp.push({
				id: PREVIEW_SCHEDULE_ID,
				event_id: item.eventId,
				room_id: target.roomId,
				start_time_slot_id: target.startTimeSlotId,
				slot_count: item.schedule.slot_count,
				start_slot: slot ? { ...slot } : null,
				event: item.schedule.event,
				hosts: item.schedule.hosts || [],
				host_name: item.schedule.host_name
			});
			return hyp;
		}

		const dragged = hyp.find((s) => s.id === item.id);
		if (!dragged) return hyp;

		const day = daySections[target.dayIdx];
		const daySchedules = schedules.filter((s) => s.start_slot?.date === day.date);
		const existing = findOccupyingSchedule(
			target.roomId,
			target.rowIdx,
			item.schedule.slot_count,
			daySchedules,
			day.timeSlots,
			item.id
		);

		if (existing) {
			const other = hyp.find((s) => s.id === existing.id);
			if (!other) return hyp;
			const aRoom = dragged.room_id;
			const aSlot = dragged.start_time_slot_id;
			const aCount = dragged.slot_count;
			patchSchedulePlacement(dragged, other.room_id, other.start_time_slot_id);
			dragged.slot_count = other.slot_count;
			patchSchedulePlacement(other, aRoom, aSlot);
			other.slot_count = aCount;
		} else {
			patchSchedulePlacement(dragged, target.roomId, target.startTimeSlotId);
		}

		return hyp;
	}

	function getDropPreviewAppearance(item, target) {
		if (!target || !item) {
			return appearanceFromIssues([], 1);
		}

		const samePlace =
			!item.isUnscheduled &&
			item.schedule.room_id === target.roomId &&
			item.schedule.start_time_slot_id === target.startTimeSlotId;
		if (samePlace) {
			return getTileAppearance(item.id, item.tier);
		}

		const hyp = buildHypotheticalSchedules(item, target);
		const previewId = getPreviewScheduleId(item);
		const previewIssues = collectHypotheticalIssues(hyp).filter((issue) => issue.scheduleId === previewId);
		const dragged = hyp.find((s) => s.id === previewId);
		const tier = dragged ? getScheduleWorstTier(dragged) : item.tier;
		return appearanceFromIssues(previewIssues, tier);
	}

	function buildDropPreview(clientX, clientY, item) {
		const target = getDropTarget(clientX, clientY, item.schedule.slot_count);
		if (!target) return null;
		return {
			...target,
			appearance: getCachedDropPreviewAppearance(item, target)
		};
	}

	function getCachedDropPreviewAppearance(item, target) {
		if (!target || !item) {
			return appearanceFromIssues([], 1);
		}

		const samePlace =
			!item.isUnscheduled &&
			item.schedule.room_id === target.roomId &&
			item.schedule.start_time_slot_id === target.startTimeSlotId;
		if (samePlace) {
			return getTileAppearance(item.id, item.tier);
		}

		const day = daySections[target.dayIdx];
		const daySchedules = hintIndexes.daySchedules.get(day.date) ?? [];
		const existing = findOccupyingSchedule(
			target.roomId,
			target.rowIdx,
			item.schedule.slot_count,
			daySchedules,
			day.timeSlots,
			item.isUnscheduled ? null : item.id
		);

		if (existing) {
			if (!item.isUnscheduled) {
				return getSwapPreviewAppearance(item, existing, day, daySchedules);
			}
			return (
				placementHints.swaps.get(existing.id) ??
				getFastPlacementAppearance(item, target, day, daySchedules, existing)
			);
		}

		const cellKey = `${target.dayIdx}-${target.colIdx}-${target.rowIdx}`;
		const cached = placementHints.cells.get(cellKey);
		return cached ?? getFastPlacementAppearance(item, target, day, daySchedules, existing);
	}

	function buildRoomColumnItems(dayTimeSlots, daySchedules) {
		return rooms.map((room) => ({
			room,
			items: daySchedules
				.filter((s) => s.room_id === room.id)
				.map((s) => ({
					id: s.id,
					schedule: s,
					rowIdx: dayTimeSlots.findIndex((ts) => ts.id === s.start_time_slot_id),
					tier: getScheduleWorstTier(s)
				}))
				.filter((item) => item.rowIdx >= 0)
		}));
	}

	function rebuildHintIndexes() {
		const availabilityTier = new Map();
		for (const row of availability) {
			availabilityTier.set(`${row.person_id}|${row.time_slot_id}`, row.tier);
		}

		const slotById = new Map();
		const slotIndexByDate = new Map();
		for (const slot of timeSlots) {
			slotById.set(slot.id, slot);
			if (!slotIndexByDate.has(slot.date)) slotIndexByDate.set(slot.date, new Map());
			slotIndexByDate.get(slot.date).set(slot.id, slotIndexByDate.get(slot.date).size);
		}

		const daySchedules = new Map();
		for (const schedule of schedules) {
			const date = schedule.start_slot?.date ?? slotById.get(schedule.start_time_slot_id)?.date;
			if (!date) continue;
			if (!daySchedules.has(date)) daySchedules.set(date, []);
			daySchedules.get(date).push(schedule);
		}

		hintIndexes = {
			availabilityTier,
			daySchedules,
			slotIndexByDate,
			slotById
		};
	}

	function buildDaySections() {
		const dates = [...new Set(timeSlots.map((ts) => ts.date))].sort();
		daySections = dates.map((date) => {
			const dayTimeSlots = timeSlots.filter((ts) => ts.date === date);
			const daySchedules = hintIndexes.daySchedules.get(date) ?? [];
			return {
				date,
				timeSlots: dayTimeSlots,
				roomColumnItems: buildRoomColumnItems(dayTimeSlots, daySchedules)
			};
		});
	}

	function collectIssuesForDay(daySchedules, dayTimeSlots, result) {
		const personSlotMap = new Map();
		const personScheduleSequence = new Map();
		const roomSlotMap = new Map();

		for (const sched of daySchedules) {
			const hostIds = getHostIds(sched);
			const slotIds = getSlotRange(sched, dayTimeSlots);
			const startIdx = dayTimeSlots.findIndex((ts) => ts.id === sched.start_time_slot_id);

			if (startIdx >= 0 && startIdx + sched.slot_count > dayTimeSlots.length) {
				pushIssue(result, {
					severity: SEVERITY.ERROR,
					message: 'Za mało slotów w tym dniu',
					scheduleId: sched.id
				});
			}

			if (!roomSlotMap.has(sched.room_id)) roomSlotMap.set(sched.room_id, new Map());
			const roomSlots = roomSlotMap.get(sched.room_id);
			for (const slotId of slotIds) {
				if (roomSlots.has(slotId)) {
					const other = roomSlots.get(slotId);
					if (other.id !== sched.id) {
						pushIssue(result, {
							severity: SEVERITY.ERROR,
							message: `Sala zajęta — konflikt z „${other.event.title}"`,
							scheduleId: sched.id
						});
						pushIssue(result, {
							severity: SEVERITY.ERROR,
							message: `Sala zajęta — konflikt z „${sched.event.title}"`,
							scheduleId: other.id
						});
					}
				} else {
					roomSlots.set(slotId, sched);
				}
			}

			for (const hostId of hostIds) {
				if (!personSlotMap.has(hostId)) personSlotMap.set(hostId, new Map());
				if (!personScheduleSequence.has(hostId)) personScheduleSequence.set(hostId, []);

				const hostSlots = personSlotMap.get(hostId);
				for (const slotId of slotIds) {
					if (hostSlots.has(slotId)) {
						const other = hostSlots.get(slotId);
						pushIssue(result, {
							severity: SEVERITY.ERROR,
							message: `Konflikt czasu z „${other.event.title}"`,
							scheduleId: sched.id,
							personId: hostId
						});
						pushIssue(result, {
							severity: SEVERITY.ERROR,
							message: `Konflikt czasu z „${sched.event.title}"`,
							scheduleId: other.id,
							personId: hostId
						});
					} else {
						hostSlots.set(slotId, sched);
					}
				}

				personScheduleSequence.get(hostId).push({ sched, startIdx, roomId: sched.room_id });

				for (const slotId of slotIds) {
					const tier = getAvailabilityTier(hostId, slotId);
					if (tier === 3) {
						const person = sched.hosts?.find((h) => h.id === hostId);
						result.push({
							severity: SEVERITY.ERROR,
							message: `${person?.display_name || 'Prowadzący'} niedostępny podczas "${sched.event.title}"`,
							scheduleId: sched.id,
							personId: hostId
						});
						break;
					} else if (tier === 2) {
						const person = sched.hosts?.find((h) => h.id === hostId);
						result.push({
							severity: SEVERITY.WARNING,
							message: `${person?.display_name || 'Prowadzący'} woli nie w czasie "${sched.event.title}"`,
							scheduleId: sched.id,
							personId: hostId
						});
						break;
					}
				}
			}
		}

		for (const [hostId, seq] of personScheduleSequence) {
			const sorted = seq.sort((a, b) => a.startIdx - b.startIdx);
			for (let i = 1; i < sorted.length; i++) {
				const prev = sorted[i - 1];
				const curr = sorted[i];
				const prevEnd = prev.startIdx + prev.sched.slot_count;
				if (curr.startIdx === prevEnd && prev.roomId !== curr.roomId) {
					const prevRoom = rooms.find((r) => r.id === prev.roomId)?.name || '?';
					const currRoom = rooms.find((r) => r.id === curr.roomId)?.name || '?';
					const person = daySchedules
						.find((s) => s.id === prev.sched.id)
						?.hosts?.find((h) => h.id === hostId);
					const message = `${person?.display_name || 'Prowadzący'}: ${prevRoom} → ${currRoom} bez przerwy`;
					pushIssue(result, {
						severity: SEVERITY.WARNING,
						message,
						scheduleId: prev.sched.id,
						personId: hostId
					});
					pushIssue(result, {
						severity: SEVERITY.WARNING,
						message,
						scheduleId: curr.sched.id,
						personId: hostId
					});
				}
			}

			let runStart = 0;
			let consecutive = sorted[0]?.sched.slot_count ?? 0;

			for (let i = 1; i < sorted.length; i++) {
				const prev = sorted[i - 1];
				const curr = sorted[i];
				const prevEnd = prev.startIdx + prev.sched.slot_count;

				if (curr.startIdx === prevEnd) {
					consecutive += curr.sched.slot_count;
					continue;
				}

				if (consecutive >= 6) {
					pushConsecutiveRunIssues(result, sorted, runStart, i - 1, hostId, consecutive);
				}

				runStart = i;
				consecutive = curr.sched.slot_count;
			}

			if (consecutive >= 6) {
				pushConsecutiveRunIssues(result, sorted, runStart, sorted.length - 1, hostId, consecutive);
			}
		}
	}

	const issues = $derived.by(() => {
		const result = [];
		if (!schedules.length) return result;

		const dates = [...new Set(timeSlots.map((ts) => ts.date))].sort();
		for (const date of dates) {
			const dayTimeSlots = timeSlots.filter((ts) => ts.date === date);
			const daySchedules = hintIndexes.daySchedules.get(date) ?? [];
			if (!dayTimeSlots.length || !daySchedules.length) continue;
			collectIssuesForDay(daySchedules, dayTimeSlots, result);
		}

		return dedupeIssues(result).sort((a, b) => {
			const order = { error: 0, warning: 1, info: 2 };
			return order[a.severity] - order[b.severity];
		});
	});

	const panelTimeSlots = $derived.by(() => {
		if (selectedUnscheduledEvent) return timeSlots;
		if (!selectedSchedule?.start_slot?.date) return [];
		const day = daySections.find((section) => section.date === selectedSchedule.start_slot.date);
		return day?.timeSlots ?? [];
	});

	const issueSummary = $derived.by(() => {
		const seen = new Set();
		return issues.filter((issue) => {
			const key = `${issue.severity}|${issue.message}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	});

	const errorCount = $derived(issueSummary.filter((i) => i.severity === SEVERITY.ERROR).length);
	const warningCount = $derived(issueSummary.filter((i) => i.severity === SEVERITY.WARNING).length);

	function hintSeverityRank(kind) {
		if (kind === 'error') return 3;
		if (kind === 'warning') return 2;
		return 1;
	}

	function mergePlacementHint(current, next) {
		if (!current) return next;
		if (!next) return current;
		return hintSeverityRank(next.kind) >= hintSeverityRank(current.kind) ? next : current;
	}

	function getCellHintData(dayIdx, colIdx, rowIdx) {
		return placementHints.cells.get(`${dayIdx}-${colIdx}-${rowIdx}`);
	}

	function overlapsRange(schedule, dayTimeSlots, startRow, slotCount) {
		const slotIndex = hintIndexes.slotIndexByDate.get(dayTimeSlots[0]?.date) ?? new Map();
		const scheduleStart =
			slotIndex.get(schedule.start_time_slot_id) ??
			dayTimeSlots.findIndex((ts) => ts.id === schedule.start_time_slot_id);
		if (scheduleStart < 0) return false;
		const scheduleEnd = scheduleStart + schedule.slot_count - 1;
		const targetEnd = startRow + slotCount - 1;
		return !(scheduleEnd < startRow || scheduleStart > targetEnd);
	}

	function schedulesShareHost(schedule, hostIds) {
		return schedule.hosts?.some((host) => hostIds.has(host.id));
	}

	function evaluateScheduleAt(hostIds, roomId, startRow, slotCount, day, daySchedules, ignoredIds) {
		const slotBlock = day.timeSlots.slice(startRow, startRow + slotCount);
		const slotIds = slotBlock.map((slot) => slot.id);
		const slotIndex = hintIndexes.slotIndexByDate.get(day.date) ?? new Map();

		if (slotBlock.length < slotCount) {
			return appearanceFromIssues(
				[{ severity: SEVERITY.ERROR, message: 'Za mało slotów w tym dniu' }],
				1
			);
		}

		let worstTier = 1;
		for (const hostId of hostIds) {
			for (const slotId of slotIds) {
				worstTier = Math.max(worstTier, getAvailabilityTier(hostId, slotId));
			}
		}

		for (const schedule of daySchedules) {
			if (ignoredIds.has(schedule.id)) continue;
			if (schedule.room_id === roomId && overlapsRange(schedule, day.timeSlots, startRow, slotCount)) {
				return appearanceFromIssues(
					[{ severity: SEVERITY.ERROR, message: `Sala zajęta — konflikt z „${schedule.event.title}"` }],
					worstTier
				);
			}
		}

		for (const schedule of daySchedules) {
			if (ignoredIds.has(schedule.id) || !schedulesShareHost(schedule, hostIds)) continue;
			if (overlapsRange(schedule, day.timeSlots, startRow, slotCount)) {
				return appearanceFromIssues(
					[{ severity: SEVERITY.ERROR, message: `Konflikt czasu z „${schedule.event.title}"` }],
					worstTier
				);
			}
		}

		if (worstTier === 3) {
			return appearanceFromIssues(
				[{ severity: SEVERITY.ERROR, message: 'Prowadzący niedostępny w tym czasie' }],
				worstTier
			);
		}

		const warnings = [];
		const targetEnd = startRow + slotCount;
		for (const hostId of hostIds) {
			const sequence = daySchedules
				.filter(
					(schedule) => !ignoredIds.has(schedule.id) && schedule.hosts?.some((host) => host.id === hostId)
				)
				.map((schedule) => ({
					startIdx:
						slotIndex.get(schedule.start_time_slot_id) ??
						day.timeSlots.findIndex((slot) => slot.id === schedule.start_time_slot_id),
					slotCount: schedule.slot_count,
					roomId: schedule.room_id,
					isPreview: false
				}))
				.filter((entry) => entry.startIdx >= 0);

			sequence.push({
				startIdx: startRow,
				slotCount,
				roomId,
				isPreview: true
			});
			sequence.sort((a, b) => a.startIdx - b.startIdx);

			for (let i = 1; i < sequence.length; i++) {
				const prev = sequence[i - 1];
				const curr = sequence[i];
				const prevEnd = prev.startIdx + prev.slotCount;
				if ((prev.isPreview || curr.isPreview) && curr.startIdx === prevEnd && prev.roomId !== curr.roomId) {
					warnings.push({
						severity: SEVERITY.WARNING,
						message: 'Zmiana sali bez przerwy'
					});
					break;
				}
			}

			let runStart = startRow;
			let runEnd = targetEnd;
			let expanded = true;
			while (expanded) {
				expanded = false;
				for (const entry of sequence) {
					if (entry.startIdx === runEnd) {
						runEnd += entry.slotCount;
						expanded = true;
					} else if (entry.startIdx + entry.slotCount === runStart) {
						runStart = entry.startIdx;
						expanded = true;
					}
				}
			}
			if (runEnd - runStart >= 6) {
				warnings.push({
					severity: SEVERITY.WARNING,
					message: '6+ slotów bez przerwy'
				});
			}
		}

		if (worstTier === 2) {
			warnings.push({
				severity: SEVERITY.WARNING,
				message: 'Prowadzący woli nie w tym czasie'
			});
		}

		return appearanceFromIssues(warnings, worstTier);
	}

	function getScheduleStartRow(schedule, day) {
		const slotIndex = hintIndexes.slotIndexByDate.get(day.date) ?? new Map();
		return (
			slotIndex.get(schedule.start_time_slot_id) ??
			day.timeSlots.findIndex((slot) => slot.id === schedule.start_time_slot_id)
		);
	}

	function getSwapPreviewAppearance(item, existing, day, daySchedules) {
		const dragged = item.schedule;
		const aStartRow = getScheduleStartRow(dragged, day);
		const bStartRow = getScheduleStartRow(existing, day);
		if (aStartRow < 0 || bStartRow < 0) return appearanceFromIssues([], 1);

		const ignoredIds = new Set([item.id, existing.id]);
		const aHosts = new Set(dragged.hosts?.map((host) => host.id) ?? []);
		const bHosts = new Set(existing.hosts?.map((host) => host.id) ?? []);

		const aAppearance = evaluateScheduleAt(
			aHosts,
			existing.room_id,
			bStartRow,
			existing.slot_count,
			day,
			daySchedules,
			ignoredIds
		);
		const bAppearance = evaluateScheduleAt(
			bHosts,
			dragged.room_id,
			aStartRow,
			dragged.slot_count,
			day,
			daySchedules,
			ignoredIds
		);

		return mergePlacementHint(aAppearance, bAppearance);
	}

	function wouldSwapWithItem(item, existing, roomId, day, daySchedules) {
		if (item.isUnscheduled || existing.id === item.id || existing.room_id !== roomId) return false;

		const maxStartRow = Math.max(0, day.timeSlots.length - item.schedule.slot_count);
		for (let startRow = 0; startRow <= maxStartRow; startRow++) {
			const found = findOccupyingSchedule(
				roomId,
				startRow,
				item.schedule.slot_count,
				daySchedules,
				day.timeSlots,
				item.id
			);
			if (found?.id === existing.id) return true;
		}
		return false;
	}

	function getFastPlacementAppearance(item, target, day, daySchedules, existing) {
		const ignoredIds = new Set();
		if (!item.isUnscheduled) ignoredIds.add(item.id);
		if (existing) ignoredIds.add(existing.id);

		const hostIds = new Set(item.schedule.hosts?.map((host) => host.id) ?? []);
		return evaluateScheduleAt(
			hostIds,
			target.roomId,
			target.rowIdx,
			item.schedule.slot_count,
			day,
			daySchedules,
			ignoredIds
		);
	}

	function computePlacementHintsForItem(item) {
		const slotCount = item.schedule.slot_count;
		const rawCells = new Map();
		const swaps = new Map();

		for (let dayIdx = 0; dayIdx < daySections.length; dayIdx++) {
			const day = daySections[dayIdx];
			const daySchedules = hintIndexes.daySchedules.get(day.date) ?? [];

			for (let colIdx = 0; colIdx < day.roomColumnItems.length; colIdx++) {
				const roomId = day.roomColumnItems[colIdx].room.id;
				const maxStartRow = Math.max(0, day.timeSlots.length - slotCount);

				if (!item.isUnscheduled) {
					for (const existing of daySchedules) {
						if (wouldSwapWithItem(item, existing, roomId, day, daySchedules)) {
							swaps.set(existing.id, getSwapPreviewAppearance(item, existing, day, daySchedules));
						}
					}
				}

				for (let startRow = 0; startRow <= maxStartRow; startRow++) {
					const startSlot = day.timeSlots[startRow];
					if (!startSlot) continue;

					const target = {
						dayIdx,
						colIdx,
						rowIdx: startRow,
						roomId,
						startTimeSlotId: startSlot.id
					};
					const existing = findOccupyingSchedule(
						roomId,
						startRow,
						slotCount,
						daySchedules,
						day.timeSlots,
						item.isUnscheduled ? null : item.id
					);

					if (existing) {
						if (item.isUnscheduled) {
							swaps.set(
								existing.id,
								getFastPlacementAppearance(item, target, day, daySchedules, existing)
							);
						}
						continue;
					}

					const appearance = getFastPlacementAppearance(item, target, day, daySchedules, null);

					for (let r = startRow; r < startRow + slotCount; r++) {
						const key = `${dayIdx}-${colIdx}-${r}`;
						rawCells.set(key, mergePlacementHint(rawCells.get(key), appearance));
					}
				}
			}
		}

		const cells = new Map();
		for (const [key, hint] of rawCells) {
			const [dayIdx, colIdx, rowIdx] = key.split('-').map(Number);
			const topKey = `${dayIdx}-${colIdx}-${rowIdx - 1}`;
			const rightKey = `${dayIdx}-${colIdx + 1}-${rowIdx}`;
			const bottomKey = `${dayIdx}-${colIdx}-${rowIdx + 1}`;
			const leftKey = `${dayIdx}-${colIdx - 1}-${rowIdx}`;

			cells.set(key, {
				...hint,
				mergeTop: rawCells.get(topKey)?.kind === hint.kind,
				mergeRight: rawCells.get(rightKey)?.kind === hint.kind,
				mergeBottom: rawCells.get(bottomKey)?.kind === hint.kind,
				mergeLeft: rawCells.get(leftKey)?.kind === hint.kind
			});
		}

		return { cells, swaps };
	}

	function computeAndApplyHints(item) {
		const result = computePlacementHintsForItem(item);
		placementHints = result;
	}

	function scheduleDropPreview(clientX, clientY) {
		pendingPreviewCoords = { clientX, clientY };
		if (dropPreviewFrame !== null) return;

		dropPreviewFrame = requestAnimationFrame(() => {
			dropPreviewFrame = null;
			if (!dragState?.moved || !pendingPreviewCoords) return;
			const { clientX: x, clientY: y } = pendingPreviewCoords;
			dropPreview = buildDropPreview(x, y, dragState.item);
		});
	}

	function onDragScroll() {
		if (!dragState?.moved || !pendingPreviewCoords) return;
		scheduleDropPreview(pendingPreviewCoords.clientX, pendingPreviewCoords.clientY);
	}

	function attachDragWindowListeners() {
		window.addEventListener('pointermove', onWindowPointerMove);
		window.addEventListener('pointerup', onWindowPointerUp);
		window.addEventListener('pointercancel', onWindowPointerCancel);
		getDropTargetScrollEl()?.addEventListener('scroll', onDragScroll, { passive: true });
	}

	function detachDragWindowListeners() {
		window.removeEventListener('pointermove', onWindowPointerMove);
		window.removeEventListener('pointerup', onWindowPointerUp);
		window.removeEventListener('pointercancel', onWindowPointerCancel);
		getDropTargetScrollEl()?.removeEventListener('scroll', onDragScroll);
	}

	function clearDragState() {
		hintCacheBuildToken++;
		clearActiveDragState();
	}

	function clearActiveDragState() {
		detachDragWindowListeners();
		if (dropPreviewFrame !== null) {
			cancelAnimationFrame(dropPreviewFrame);
			dropPreviewFrame = null;
		}
		pendingPreviewCoords = null;
		dropTargetRects = [];
		dragState = null;
		dropPreview = null;
		placementHints = { cells: new Map(), swaps: new Map() };
	}

	onMount(async () => {
		await loadConvention();
		return () => {
			clearDragState();
		};
	});

	async function loadConvention() {
		loading = true;
		try {
			const { active } = await getConventions();
			if (!active) {
				convention = null;
				return;
			}
			convention = active;
			await loadSchedule();
		} catch (error) {
			toast.error('Błąd ładowania', { description: error.message });
		} finally {
			loading = false;
		}
	}

	async function loadSchedule(options = {}) {
		if (!convention) return;
		const [roomsData, slotsData, schedulesData, unscheduledData, availData] = await Promise.all([
			getRooms(convention.id),
			getTimeSlots(convention.id),
			getSchedules(convention.id),
			getUnscheduledEvents(convention.id),
			getAvailability(convention.id)
		]);
		rooms = roomsData;
		timeSlots = slotsData;
		schedules = schedulesData;
		unscheduled = unscheduledData;
		availability = availData;
		rebuildHintIndexes();
		buildDaySections();

		if (selectedSchedule) {
			selectedSchedule = schedules.find((s) => s.id === selectedSchedule.id) || null;
			if (!selectedSchedule) closeEventPanel();
		}

		if (selectedUnscheduledEvent) {
			selectedUnscheduledEvent =
				unscheduled.find((event) => event.id === selectedUnscheduledEvent.id) || null;
			if (!selectedUnscheduledEvent) closeEventPanel();
		}
	}

	function openEventPanel(schedule, anchorEl) {
		selectedUnscheduledEvent = null;
		selectedSchedule = schedule;
		panelAnchorRect = anchorEl.getBoundingClientRect();
	}

	function openUnscheduledPanel(event, anchorEl) {
		selectedSchedule = null;
		selectedUnscheduledEvent = event;
		panelAnchorRect = anchorEl.getBoundingClientRect();
	}

	function closeEventPanel() {
		selectedSchedule = null;
		selectedUnscheduledEvent = null;
		panelAnchorRect = null;
	}

	function handleUnscheduledClick(event, unscheduledEvent, anchorEl) {
		if (blockNextClick || dragState?.moved) {
			blockNextClick = false;
			return;
		}
		event.stopPropagation();
		openUnscheduledPanel(unscheduledEvent, anchorEl);
	}

	function handleEventClick(event, schedule, anchorEl) {
		if (blockNextClick || dragState?.moved) {
			blockNextClick = false;
			return;
		}
		event.stopPropagation();
		openEventPanel(schedule, anchorEl);
	}

	function getDropTargetScrollEl() {
		return sheetScrollEl ?? document.querySelector('.sheet-scroll');
	}

	function dropTargetViewportRect(rect) {
		const scrollEl = getDropTargetScrollEl();
		if (!scrollEl) {
			return {
				left: rect.contentLeft,
				top: rect.contentTop,
				right: rect.contentLeft + rect.width,
				bottom: rect.contentTop + rect.height
			};
		}

		const scrollRect = scrollEl.getBoundingClientRect();
		const left = rect.contentLeft - scrollEl.scrollLeft + scrollRect.left;
		const top = rect.contentTop - scrollEl.scrollTop + scrollRect.top;
		return {
			left,
			top,
			right: left + rect.width,
			bottom: top + rect.height
		};
	}

	function collectDropTargetRects(slotCount) {
		const scrollEl = getDropTargetScrollEl();
		const scrollRect = scrollEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
		const scrollTop = scrollEl?.scrollTop ?? 0;
		const scrollLeft = scrollEl?.scrollLeft ?? 0;
		const rects = [];

		for (let dayIdx = 0; dayIdx < daySections.length; dayIdx++) {
			const day = daySections[dayIdx];

			for (let colIdx = 0; colIdx < day.roomColumnItems.length; colIdx++) {
				const el = document.querySelector(`[data-drop-col="${dayIdx}-${colIdx}"]`);
				if (!el) continue;

				const rect = el.getBoundingClientRect();
				rects.push({
					dayIdx,
					colIdx,
					contentLeft: rect.left - scrollRect.left + scrollLeft,
					contentTop: rect.top - scrollRect.top + scrollTop,
					width: rect.width,
					height: rect.height,
					maxStartRow: Math.max(0, day.timeSlots.length - slotCount),
					timeSlots: day.timeSlots,
					roomId: day.roomColumnItems[colIdx].room.id
				});
			}
		}
		return rects;
	}

	function getDropTarget(clientX, clientY, slotCount) {
		if (dropTargetRects.length > 0) {
			for (const rect of dropTargetRects) {
				const viewport = dropTargetViewportRect(rect);
				if (
					clientX < viewport.left ||
					clientX > viewport.right ||
					clientY < viewport.top ||
					clientY > viewport.bottom
				) {
					continue;
				}

				const rawRow = Math.floor((clientY - viewport.top) / SLOT_HEIGHT);
				const rowIdx = Math.max(0, Math.min(rawRow, rect.maxStartRow));
				const startSlot = rect.timeSlots[rowIdx];
				if (!startSlot) return null;

				return {
					dayIdx: rect.dayIdx,
					colIdx: rect.colIdx,
					rowIdx,
					roomId: rect.roomId,
					startTimeSlotId: startSlot.id
				};
			}
		}

		for (let dayIdx = 0; dayIdx < daySections.length; dayIdx++) {
			const day = daySections[dayIdx];

			for (let colIdx = 0; colIdx < day.roomColumnItems.length; colIdx++) {
				const el = document.querySelector(`[data-drop-col="${dayIdx}-${colIdx}"]`);
				if (!el) continue;

				const rect = el.getBoundingClientRect();
				if (
					clientX < rect.left ||
					clientX > rect.right ||
					clientY < rect.top ||
					clientY > rect.bottom
				) {
					continue;
				}

				const rawRow = Math.floor((clientY - rect.top) / SLOT_HEIGHT);
				const maxStartRow = Math.max(0, day.timeSlots.length - slotCount);
				const rowIdx = Math.max(0, Math.min(rawRow, maxStartRow));
				const startSlot = day.timeSlots[rowIdx];
				if (!startSlot) return null;

				return {
					dayIdx,
					colIdx,
					rowIdx,
					roomId: day.roomColumnItems[colIdx].room.id,
					startTimeSlotId: startSlot.id
				};
			}
		}

		return null;
	}

	function findOccupyingSchedule(roomId, startRowIdx, slotCount, daySchedules, dayTimeSlots, excludeId) {
		const targetEnd = startRowIdx + slotCount - 1;
		const slotIndex = hintIndexes.slotIndexByDate.get(dayTimeSlots[0]?.date) ?? new Map();
		return daySchedules.find((s) => {
			if (s.id === excludeId || s.room_id !== roomId) return false;
			const startIdx =
				slotIndex.get(s.start_time_slot_id) ??
				dayTimeSlots.findIndex((ts) => ts.id === s.start_time_slot_id);
			if (startIdx < 0) return false;
			const endIdx = startIdx + s.slot_count - 1;
			return !(endIdx < startRowIdx || startIdx > targetEnd);
		});
	}

	async function commitDrop(item, targetDayIdx, target) {
		if (!target?.startTimeSlotId) return;

		const schedule = item.schedule;
		const day = daySections[targetDayIdx];
		const daySchedules = hintIndexes.daySchedules.get(day.date) ?? [];

		if (item.isUnscheduled) {
			const existing = findOccupyingSchedule(
				target.roomId,
				target.rowIdx,
				schedule.slot_count,
				daySchedules,
				day.timeSlots,
				null
			);

			if (existing) {
				await deleteSchedule(existing.id);
			}

			await createSchedule({
				event_id: item.eventId,
				room_id: target.roomId,
				start_time_slot_id: target.startTimeSlotId,
				slot_count: schedule.slot_count
			});
			return;
		}

		const samePlace =
			schedule.room_id === target.roomId && schedule.start_time_slot_id === target.startTimeSlotId;
		if (samePlace) return;

		const existing = findOccupyingSchedule(
			target.roomId,
			target.rowIdx,
			schedule.slot_count,
			daySchedules,
			day.timeSlots,
			item.id
		);

		if (existing) {
			await swapSchedules(item.id, existing.id);
			return;
		}

		await updateSchedule(item.id, {
			room_id: target.roomId,
			start_time_slot_id: target.startTimeSlotId
		});
	}

	function beginDrag(event, item, meta = {}) {
		if (event.button !== 0) return;

		event.preventDefault();
		if (dragState) clearActiveDragState();

		dragState = {
			item,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			moved: false,
			...meta
		};
		dropTargetRects = collectDropTargetRects(item.schedule.slot_count);
		attachDragWindowListeners();
	}

	function startUnscheduledDrag(event, item) {
		beginDrag(event, item);
	}

	function startEventDrag(event, item, dayIdx, colIdx) {
		beginDrag(event, item, { dayIdx, colIdx });
	}

	function onWindowPointerMove(event) {
		if (!dragState || event.pointerId !== dragState.pointerId) return;

		if (
			!dragState.moved &&
			Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) > DRAG_THRESHOLD
		) {
			const item = dragState.item;
			dragState = { ...dragState, moved: true };
			computeAndApplyHints(item);
		}

		if (dragState.moved) {
			scheduleDropPreview(event.clientX, event.clientY);
		}
	}

	async function onWindowPointerUp(event) {
		if (!dragState || event.pointerId !== dragState.pointerId) return;

		const { item, moved } = dragState;
		clearActiveDragState();

		if (!moved) return;

		blockNextClick = true;
		const target = getDropTarget(event.clientX, event.clientY, item.schedule.slot_count);

		try {
			if (target) await commitDrop(item, target.dayIdx, target);
		} catch (error) {
			toast.error('Błąd przenoszenia', { description: error.message });
		} finally {
			await loadSchedule();
		}
	}

	function onWindowPointerCancel(event) {
		if (!dragState || event.pointerId !== dragState.pointerId) return;
		clearActiveDragState();
	}

	async function handlePanelSaved(options = {}) {
		await loadSchedule(options);
	}

	async function handleDeleteSchedule(scheduleId) {
		try {
			await deleteSchedule(scheduleId);
			toast.success('Usunięto z grafiku');
			await loadSchedule();
		} catch (error) {
			toast.error('Błąd usuwania', { description: error.message });
		}
	}

	async function handleAutoScheduleAll() {
		const total = schedules.length + unscheduled.length;
		if (total === 0) return;

		autoScheduling = true;
		autoScheduleProgress = { current: 0, total, phase: 'Przebudowa grafiku...' };
		closeEventPanel();
		await flushUi();

		try {
			const result = await autoScheduleAll(convention.id, async (progress) => {
				autoScheduleProgress = {
					current: progress.current,
					total: progress.total,
					phase: progress.phase
				};
				await flushUi();
			});

			autoScheduleProgress = { current: total, total, phase: 'Ładowanie grafiku...' };
			await flushUi();
			await loadSchedule();

			toast.success('Auto-grafik gotowy', {
				description: `${result.successes.length} zaplanowano, ${result.errors.length} niezaplanowanych`
			});
		} catch (error) {
			toast.error('Auto-grafik nieudany', { description: error.message });
		} finally {
			autoScheduling = false;
			autoScheduleProgress = { current: 0, total: 0, phase: '' };
		}
	}

	async function handleClearSchedule() {
		if (!convention || schedules.length === 0) return;
		if (
			!confirm(
				`Usunąć wszystkie ${schedules.length} atrakcje z grafiku? Wrócą na listę niezaplanowanych.`
			)
		) {
			return;
		}
		try {
			const { removed } = await clearAllSchedules(convention.id);
			closeEventPanel();
			toast.success('Grafik wyczyszczony', {
				description: `${removed} atrakcji przeniesiono do niezaplanowanych`
			});
			await loadSchedule();
		} catch (error) {
			toast.error('Błąd czyszczenia grafiku', { description: error.message });
		}
	}
</script>

{#if loading}
	<div class="flex h-full items-center justify-center text-sm text-muted-foreground">Ładowanie…</div>
{:else if !convention}
	<div class="flex h-full items-center justify-center bg-background p-6">
		<Card class="max-w-md p-8 text-center">
			<h2 class="g-section-title mb-2">Brak konwentu</h2>
			<p class="mb-4 text-sm text-muted-foreground">Wgraj CSV w konfiguracji, aby utworzyć grafik.</p>
			<Button href="/setup">Przejdź do importu</Button>
		</Card>
	</div>
{:else}
	<div class="sheet-root" class:sheet-root--dragging={dragState?.moved}>
		<header class="sheet-toolbar">
			<div class="sheet-toolbar-left">
				<h1 class="sheet-title">{convention.name}</h1>
				<span class="sheet-subtitle">
					{daySections.length} {daySections.length === 1 ? 'dzień' : 'dni'} · {schedules.length} zaplanowanych · {unscheduled.length} oczekujących
				</span>
			</div>
			<div class="sheet-toolbar-right">
				<button
					class="sheet-btn"
					onclick={handleClearSchedule}
					disabled={autoScheduling || schedules.length === 0}
				>
					Odzaplanuj wszystko
				</button>
				<button class="sheet-btn sheet-btn--primary" onclick={handleAutoScheduleAll} disabled={autoScheduling || unscheduled.length === 0}>
					{autoScheduling ? 'Planowanie…' : 'Auto-grafik'}
				</button>
			</div>
		</header>

		{#if issueSummary.length > 0}
			<div class="sheet-issues">
				<div class="sheet-issues-bar">
					{#if errorCount > 0}<span class="badge badge--error">{errorCount} błędów</span>{/if}
					{#if warningCount > 0}<span class="badge badge--warning">{warningCount} ostrzeżeń</span>{/if}
					{#if showIssuesPanel}
						{#each issueSummary as issue}
							<div class="sheet-issue sheet-issue--{issue.severity}">
								<span>{issue.severity === 'error' ? '✕' : '⚠'}</span>
								<span>{issue.message}</span>
							</div>
						{/each}
					{/if}
					<button
						class="sheet-issues-toggle"
						onclick={() => (showIssuesPanel = !showIssuesPanel)}
						aria-expanded={showIssuesPanel}
						title={showIssuesPanel ? 'Zwiń ostrzeżenia' : 'Rozwiń ostrzeżenia'}
					>
						{showIssuesPanel ? '▼' : '▶'}
					</button>
				</div>
			</div>
		{/if}

		<div class="sheet-body">
			<div class="sheet-scroll" bind:this={sheetScrollEl}>
				{#if daySections.length === 0}
					<div class="sheet-empty">Brak slotów w grafiku</div>
				{:else}
					{#each daySections as day, dayIdx (day.date)}
						<section class="sheet-day-section">
							<h2 class="sheet-day-header">{formatDate(day.date)}</h2>
							<div
								class="sheet-grid"
								style="
									--time-w: {TIME_COL_WIDTH}px;
									--room-w: {ROOM_COL_WIDTH}px;
									--slot-h: {SLOT_HEIGHT}px;
									grid-template-columns: var(--time-w) repeat({rooms.length}, var(--room-w));
									grid-template-rows: 32px repeat({day.timeSlots.length}, var(--slot-h));
								"
							>
								<div class="sheet-corner"></div>

								{#each rooms as room, idx}
									<div class="sheet-col-header" style="grid-column: {idx + 2}; grid-row: 1">
										{room.name}
									</div>
								{/each}

								{#each day.timeSlots as slot, rowIdx}
									<div
										class="sheet-row-label"
										class:sheet-row-label--hour={isHourStart(slot.start_time)}
										style="grid-column: 1; grid-row: {rowIdx + 2}"
									>
										{formatTime(slot.start_time)}
									</div>

									{#each rooms as _room, colIdx}
										{@const cellHint = dragState?.moved
											? getCellHintData(dayIdx, colIdx, rowIdx)
											: null}
										<div
											class="sheet-cell"
											class:sheet-cell--hour={isHourStart(slot.start_time)}
											class:sheet-cell--hint={cellHint}
											class:sheet-cell--hint-error={cellHint?.kind === 'error'}
											class:sheet-cell--hint-warning={cellHint?.kind === 'warning'}
											class:sheet-cell--hint-ok={cellHint?.kind === 'ok'}
											class:sheet-cell--merge-top={cellHint?.mergeTop}
											class:sheet-cell--merge-right={cellHint?.mergeRight}
											class:sheet-cell--merge-bottom={cellHint?.mergeBottom}
											class:sheet-cell--merge-left={cellHint?.mergeLeft}
											style="
												grid-column: {colIdx + 2};
												grid-row: {rowIdx + 2};
												{cellHint
													? `--cell-hint-bg: ${cellHint.bg}; --cell-hint-border: ${cellHint.border};`
													: ''}
											"
										></div>
									{/each}
								{/each}

								{#each day.roomColumnItems as col, colIdx}
									<div
										class="sheet-events-col"
										data-drop-col="{dayIdx}-{colIdx}"
										style="grid-column: {colIdx + 2}; grid-row: 2 / span {day.timeSlots.length}"
									>
										{#if dropPreview?.dayIdx === dayIdx && dropPreview?.colIdx === colIdx && dragState?.item && dropPreview.appearance}
											<div
												class="sheet-drop-preview"
												class:sheet-drop-preview--error={dropPreview.appearance.kind === 'error'}
												class:sheet-drop-preview--warning={dropPreview.appearance.kind === 'warning'}
												class:sheet-drop-preview--ok={dropPreview.appearance.kind === 'ok'}
												style="
													top: {dropPreview.rowIdx * SLOT_HEIGHT + 1}px;
													height: {getSlotTileHeight(dragState.item.schedule.slot_count)}px;
													--drop-bg: {dropPreview.appearance.bg};
													--drop-border: {dropPreview.appearance.border};
												"
												title={dropPreview.appearance.messages?.length
													? dropPreview.appearance.messages.join(' · ')
													: dropPreview.appearance.label}
											></div>
										{/if}
										{#each col.items as item (item.id)}
											{@const appearance = getTileAppearance(item.id, item.tier)}
											{@const swapHint =
												dragState?.moved && dragState.item.id !== item.id
													? placementHints.swaps.get(item.id)
													: null}
											{@const edgeAppearance = swapHint ?? appearance}
											{@const showDragEdge = Boolean(swapHint)}
											<div
												class="sheet-event"
												class:sheet-event--error={appearance.kind === 'error'}
												class:sheet-event--warning={appearance.kind === 'warning'}
												class:sheet-event--selected={selectedSchedule?.id === item.id}
												class:sheet-event--dragging={dragState?.item?.id === item.id && dragState?.moved}
												class:sheet-event--drag-edge={showDragEdge}
												class:sheet-event--drag-edge-error={showDragEdge && edgeAppearance.kind === 'error'}
												class:sheet-event--drag-edge-warning={showDragEdge && edgeAppearance.kind === 'warning'}
												class:sheet-event--drag-edge-ok={showDragEdge && edgeAppearance.kind === 'ok'}
												style="
													top: {item.rowIdx * SLOT_HEIGHT + 1}px;
													height: {getSlotTileHeight(item.schedule.slot_count)}px;
													max-height: {getSlotTileHeight(item.schedule.slot_count)}px;
													--title-lines: {getMaxTitleLines(item.schedule.slot_count)};
													--ev-bg: {appearance.bg};
													--ev-border: {appearance.border};
													--ev-text: {appearance.text};
													--ev-edge: {edgeAppearance.border};
												"
												title="{showDragEdge && swapHint?.messages?.length
													? swapHint.messages.join(' · ')
													: appearance.messages.length
														? appearance.messages.join(' · ')
														: `${item.schedule.event.title} — ${hostLabel(item.schedule)}`}"
												onpointerdown={(event) => startEventDrag(event, item, dayIdx, colIdx)}
												onclick={(event) => handleEventClick(event, item.schedule, event.currentTarget)}
												oncontextmenu={(e) => {
													e.preventDefault();
													handleDeleteSchedule(item.id);
												}}
											>
												<div class="sheet-event-meta">
													<span class="sheet-event-time">
														{formatTime(item.schedule.start_slot?.start_time)}–{getEndTime(item.schedule)}
													</span>
													<span class="sheet-event-host">{hostLabel(item.schedule)}</span>
													{#if appearance.kind === 'error'}
														<span class="sheet-event-meta-icon sheet-event-meta-icon--error" aria-label="Błąd">
															<CircleAlert size={12} strokeWidth={2.25} />
														</span>
													{:else if appearance.kind === 'warning'}
														<span
															class="sheet-event-meta-icon sheet-event-meta-icon--warning"
															aria-label="{appearance.messages.length > 1 ? `${appearance.messages.length} ostrzeżenia` : 'Ostrzeżenie'}"
														>
															{#if appearance.messages.length > 1}
																<span class="sheet-event-meta-count">{appearance.messages.length}</span>
															{:else}
																<TriangleAlert size={12} strokeWidth={2.25} />
															{/if}
														</span>
													{/if}
												</div>
												<div class="sheet-event-title">{item.schedule.event.title}</div>
											</div>
										{/each}
									</div>
								{/each}
							</div>
						</section>
					{/each}
				{/if}
			</div>

			<aside class="sheet-sidebar">
				<div class="sheet-sidebar-header">
					<span>Niezaplanowane</span>
					<span class="sheet-sidebar-count">{unscheduled.length}</span>
				</div>
				<div class="sheet-sidebar-list">
					{#each unscheduled as event}
						{@const dragItem = makeUnscheduledDragItem(event)}
						<div
							class="sheet-sidebar-item"
							class:sheet-sidebar-item--dragging={dragState?.item?.id === dragItem.id && dragState?.moved}
							onpointerdown={(e) => startUnscheduledDrag(e, dragItem)}
							onclick={(e) => handleUnscheduledClick(e, event, e.currentTarget)}
							role="button"
							tabindex="0"
						>
							<span class="sheet-sidebar-item-title">{event.title}</span>
							<span class="sheet-sidebar-item-meta">{hostLabel(event)} · {event.duration_minutes} min</span>
						</div>
					{/each}
					{#if unscheduled.length === 0}
						<div class="sheet-sidebar-empty">Wszystko zaplanowane</div>
					{/if}
				</div>
			</aside>
		</div>

		<footer class="sheet-footer">
			<div class="sheet-legend">
				<span>Dostępność:</span>
				{#each Object.entries(TIER_COLORS) as [_tier, style]}
					<span class="sheet-legend-chip" style="background:{style.bg}; border-color:{style.border}; color:{style.text}">
						{style.label}
					</span>
				{/each}
				<span class="sheet-legend-divider">·</span>
				<span class="sheet-legend-chip" style="background:{ISSUE_COLORS.warning.bg}; border-color:{ISSUE_COLORS.warning.border}; color:{ISSUE_COLORS.warning.text}">
					<TriangleAlert size={10} strokeWidth={2.5} /> Ostrzeżenie
				</span>
				<span class="sheet-legend-chip" style="background:{ISSUE_COLORS.error.bg}; border-color:{ISSUE_COLORS.error.border}; color:{ISSUE_COLORS.error.text}">
					<CircleAlert size={10} strokeWidth={2.5} /> Błąd
				</span>
			</div>
			<span class="sheet-footer-hint">Kliknij = szczegóły · przeciągnij = sala/czas · niezaplanowane → grafik · PPM = usuń</span>
		</footer>

		{#if autoScheduling}
			<div class="sheet-progress-overlay" role="status" aria-live="polite" aria-busy="true">
				<div class="sheet-progress-card">
					<div class="sheet-progress-spinner" aria-hidden="true"></div>
					<p class="sheet-progress-title">Automatyczne planowanie</p>
					<p class="sheet-progress-phase">{autoScheduleProgress.phase || 'Przetwarzanie...'}</p>
					<div class="sheet-progress-bar-wrap">
						<div
							class="sheet-progress-bar"
							style="width: {autoScheduleProgress.total > 0
								? Math.max(4, (autoScheduleProgress.current / autoScheduleProgress.total) * 100)
								: 0}%"
						></div>
					</div>
					<p class="sheet-progress-count">
						{autoScheduleProgress.current} / {autoScheduleProgress.total}
					</p>
				</div>
			</div>
		{/if}

		<ScheduleEventPanel
			schedule={selectedSchedule}
			unscheduledEvent={selectedUnscheduledEvent}
			anchorRect={panelAnchorRect}
			{convention}
			{rooms}
			timeSlots={panelTimeSlots}
			issues={issues}
			onclose={closeEventPanel}
			onsaved={handlePanelSaved}
		/>
	</div>
{/if}

<style>
	.sheet-root {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		height: 100%;
		background: #fff;
		color: #202124;
		font-family: Roboto, Arial, sans-serif;
		font-size: 13px;
	}

	.sheet-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.625rem 1rem;
		background: #fff;
		border-bottom: 1px solid #dadce0;
		flex-shrink: 0;
	}

	.sheet-toolbar-left {
		min-width: 0;
	}

	.sheet-title {
		margin: 0;
		font-size: 15px;
		font-weight: 500;
		color: #202124;
		line-height: 1.2;
	}

	.sheet-subtitle {
		display: block;
		margin-top: 0.125rem;
		font-size: 12px;
		color: #5f6368;
	}

	.sheet-toolbar-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.sheet-progress-overlay {
		position: fixed;
		top: 64px;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 80;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		background: rgba(248, 249, 250, 0.94);
		backdrop-filter: blur(2px);
	}

	.sheet-progress-card {
		background: #fff;
		border: 1px solid #dadce0;
		border-radius: 12px;
		padding: 2rem 2.5rem;
		box-shadow: 0 8px 28px rgba(60, 64, 67, 0.28);
		text-align: center;
		width: min(100%, 420px);
	}

	.sheet-progress-spinner {
		width: 2.5rem;
		height: 2.5rem;
		margin: 0 auto 1rem;
		border: 3px solid #e8eaed;
		border-top-color: #1a73e8;
		border-radius: 50%;
		animation: sheet-progress-spin 0.8s linear infinite;
	}

	@keyframes sheet-progress-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.sheet-progress-title {
		margin: 0 0 0.5rem;
		font-size: 16px;
		font-weight: 500;
		color: #202124;
	}

	.sheet-progress-phase {
		margin: 0 0 1rem;
		font-size: 13px;
		color: #5f6368;
		min-height: 2.6em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: pre-line;
	}

	.sheet-progress-bar-wrap {
		height: 8px;
		background: #e8eaed;
		border-radius: 4px;
		overflow: hidden;
	}

	.sheet-progress-bar {
		height: 100%;
		background: #1a73e8;
		border-radius: 4px;
		transition: width 0.15s ease-out;
	}

	.sheet-progress-count {
		margin: 0.75rem 0 0;
		font-size: 12px;
		color: #5f6368;
		font-variant-numeric: tabular-nums;
	}

	.sheet-btn {
		height: 2rem;
		padding: 0 0.875rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		background: #fff;
		color: #3c4043;
		font-size: 13px;
		font-weight: 500;
		line-height: 1;
		white-space: nowrap;
		flex-shrink: 0;
		cursor: pointer;
	}

	.sheet-btn:hover {
		background: #f8f9fa;
	}

	.sheet-btn--primary {
		background: #1a73e8;
		border-color: #1a73e8;
		color: #fff;
	}

	.sheet-btn--primary:hover {
		background: #1765cc;
	}

	.sheet-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.sheet-issues {
		background: #fef7e0;
		border-bottom: 1px solid #fbbc04;
		flex-shrink: 0;
		position: relative;
		z-index: 45;
	}

	.sheet-issues-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		max-height: 88px;
		overflow-y: auto;
	}

	.sheet-issues-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		margin-left: auto;
		padding: 0;
		border: 1px solid #fbbc04;
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
		font-size: 10px;
		color: #5f6368;
		flex-shrink: 0;
	}

	.sheet-issues-toggle:hover {
		background: #fff8e1;
	}

	.badge {
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 500;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.badge--error {
		background: #fce8e6;
		color: #c5221f;
	}

	.badge--warning {
		background: #fff;
		border: 1px solid #fbbc04;
		color: #b06000;
	}

	.sheet-issue {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 12px;
		line-height: 1.3;
		max-width: 100%;
	}

	.sheet-issue--error {
		background: #fce8e6;
		color: #c5221f;
	}

	.sheet-issue--warning {
		background: #fff;
		border: 1px solid #fbbc04;
		color: #b06000;
	}

	.sheet-body {
		display: flex;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.sheet-scroll {
		flex: 1;
		overflow: auto;
		background: #fff;
		padding: 0 0.75rem 0.75rem;
	}

	.sheet-day-section + .sheet-day-section {
		margin-top: 1.5rem;
	}

	.sheet-day-section {
		--sticky-day-header-h: 2.25rem;
	}

	.sheet-day-header {
		margin: 0 -0.75rem;
		padding: 0.5rem 0.75rem;
		background: #f8f9fa;
		border: 1px solid #dadce0;
		border-left: none;
		border-right: none;
		font-size: 13px;
		font-weight: 600;
		color: #3c4043;
		position: sticky;
		top: 0;
		z-index: 40;
		box-shadow: 0 1px 0 #dadce0;
	}

	.sheet-day-section:first-child .sheet-day-header {
		border-top: none;
	}

	.sheet-day-section .sheet-grid {
		margin-top: 0;
		border-top: none;
	}

	.sheet-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 240px;
		color: #5f6368;
		font-size: 13px;
	}

	.sheet-grid {
		display: grid;
		width: max-content;
		min-width: 100%;
		position: relative;
		border-right: 1px solid #dadce0;
		border-bottom: 1px solid #dadce0;
	}

	.sheet-corner {
		position: sticky;
		top: 0;
		left: 0;
		z-index: 30;
		grid-column: 1;
		grid-row: 1;
		background: #f8f9fa;
		border-right: 1px solid #dadce0;
		border-bottom: 1px solid #dadce0;
	}

	.sheet-col-header {
		position: sticky;
		top: var(--sticky-day-header-h, 2.25rem);
		z-index: 25;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 0.5rem;
		background: #f8f9fa;
		border-right: 1px solid #dadce0;
		border-bottom: 1px solid #dadce0;
		font-size: 12px;
		font-weight: 500;
		color: #3c4043;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sheet-row-label {
		position: sticky;
		left: 0;
		z-index: 10;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 0.25rem;
		background: #f8f9fa;
		border-right: 1px solid #dadce0;
		border-bottom: 1px solid #e8eaed;
		font-size: 11px;
		color: #9aa0a6;
		font-variant-numeric: tabular-nums;
		height: var(--slot-h);
	}

	.sheet-row-label--hour {
		color: #3c4043;
		font-weight: 500;
		font-size: 12px;
	}

	.sheet-cell {
		position: relative;
		width: var(--room-w);
		height: var(--slot-h);
		border-right: 1px solid #e8eaed;
		border-bottom: 1px solid #e8eaed;
		background: #fff;
		box-sizing: border-box;
	}

	.sheet-cell--hour {
		border-top: 1px solid #dadce0;
	}

	.sheet-cell--hint {
		background: color-mix(in srgb, var(--cell-hint-bg, #e6f4ea) 58%, #fff);
		border-right-color: transparent;
		border-bottom-color: transparent;
	}

	.sheet-cell--hint::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		border: 2px solid color-mix(in srgb, var(--cell-hint-border, #34a853) 72%, transparent);
		border-radius: 3px;
	}

	.sheet-cell--merge-top::after {
		border-top-color: transparent;
		border-top-left-radius: 0;
		border-top-right-radius: 0;
	}

	.sheet-cell--merge-right::after {
		border-right-color: transparent;
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}

	.sheet-cell--merge-bottom::after {
		border-bottom-color: transparent;
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}

	.sheet-cell--merge-left::after {
		border-left-color: transparent;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}

	.sheet-cell--hint-ok {
		background: color-mix(in srgb, #e6f4ea 62%, #fff);
		--cell-hint-border: #34a853;
	}

	.sheet-cell--hint-warning {
		background: color-mix(in srgb, #fef7e0 68%, #fff);
		--cell-hint-border: #f9ab00;
	}

	.sheet-cell--hint-error {
		background: color-mix(in srgb, #fce8e6 68%, #fff);
		--cell-hint-border: #ea4335;
	}

	.sheet-root--dragging .sheet-cell:not(.sheet-cell--hint) {
		background: #f3f4f6;
	}

	.sheet-events-col {
		position: relative;
		width: var(--room-w);
		min-height: 100%;
		border-right: 1px solid #e8eaed;
		pointer-events: none;
		overflow: visible;
	}

	.sheet-events-col :global(*) {
		pointer-events: auto;
	}

	:global(.sheet-drop-target) {
		background: #e8f0fe !important;
		outline: 2px solid #1a73e8;
		outline-offset: -2px;
	}

	.sheet-drop-preview {
		position: absolute;
		left: 2px;
		right: 2px;
		border: 2px dashed var(--drop-border, #34a853);
		border-radius: 2px;
		background: color-mix(in srgb, var(--drop-bg, #e6f4ea) 82%, transparent);
		pointer-events: none;
		z-index: 15;
		box-sizing: border-box;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--drop-border, #34a853) 35%, transparent);
	}

	.sheet-drop-preview--ok {
		background: color-mix(in srgb, #e6f4ea 85%, transparent);
		border-color: #34a853;
	}

	.sheet-drop-preview--warning {
		background: color-mix(in srgb, #fef7e0 88%, transparent);
		border-color: #f9ab00;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, #f9ab00 35%, transparent);
	}

	.sheet-drop-preview--error {
		background: color-mix(in srgb, #fce8e6 88%, transparent);
		border-color: #ea4335;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, #ea4335 35%, transparent);
	}

	.sheet-event {
		position: absolute;
		left: 2px;
		right: 2px;
		padding: 0.25rem 0.375rem 0.3125rem;
		background: var(--ev-bg);
		border: 1px solid var(--ev-border);
		border-radius: 2px;
		cursor: grab;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
		z-index: 1;
		box-sizing: border-box;
		touch-action: none;
		user-select: none;
	}

	.sheet-event--error {
		border-width: 2px;
		box-shadow: inset 0 0 0 1px rgba(234, 67, 53, 0.12);
	}

	.sheet-event--warning {
		border-width: 2px;
		box-shadow: inset 0 0 0 1px rgba(249, 171, 0, 0.12);
	}

	.sheet-event--selected {
		outline: 2px solid #1a73e8;
		outline-offset: 1px;
		z-index: 25;
	}

	.sheet-event--dragging {
		opacity: 0.45;
		cursor: grabbing;
		z-index: 30;
	}

	.sheet-event--drag-edge {
		border-width: 3px;
		border-color: var(--ev-edge, var(--ev-border));
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--ev-edge, var(--ev-border)) 28%, transparent),
			0 0 0 1px color-mix(in srgb, var(--ev-edge, var(--ev-border)) 55%, transparent);
		z-index: 20;
	}

	.sheet-event--drag-edge-ok {
		--ev-edge: #34a853;
	}

	.sheet-event--drag-edge-warning {
		--ev-edge: #f9ab00;
	}

	.sheet-event--drag-edge-error {
		--ev-edge: #ea4335;
	}

	.sheet-event-meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
		min-height: 1.25rem;
		margin: -0.25rem -0.375rem 0;
		padding: 0.125rem 0.375rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.12);
		background: rgba(255, 255, 255, 0.62);
	}

	.sheet-event-time {
		font-size: 11px;
		font-weight: 700;
		line-height: 1.2;
		color: #111827;
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
		letter-spacing: 0.01em;
	}

	.sheet-event-host {
		font-size: 11px;
		font-weight: 600;
		line-height: 1.2;
		color: var(--ev-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 1 1 auto;
	}

	.sheet-event-meta-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-left: auto;
		line-height: 0;
	}

	.sheet-event-meta-icon--error {
		color: #ea4335;
	}

	.sheet-event-meta-icon--warning {
		color: #f9ab00;
	}

	.sheet-event-meta-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 14px;
		height: 14px;
		padding: 0 3px;
		border-radius: 999px;
		background: #f9ab00;
		color: #fff;
		font-size: 9px;
		font-weight: 700;
		line-height: 1;
	}

	.sheet-event:hover {
		box-shadow: 0 2px 8px rgba(60, 64, 67, 0.18);
		z-index: 20;
	}

	.sheet-event:active {
		cursor: grabbing;
		z-index: 30;
	}

	.sheet-event-title {
		font-size: 12px;
		font-weight: 500;
		color: #202124;
		line-height: 1.35;
		word-break: break-word;
		overflow-wrap: break-word;
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: var(--title-lines, 2);
		line-clamp: var(--title-lines, 2);
	}

	.sheet-sidebar {
		width: 260px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		border-left: 1px solid #dadce0;
		background: #fff;
	}

	.sheet-sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.625rem 0.75rem;
		border-bottom: 1px solid #dadce0;
		background: #f8f9fa;
		font-size: 12px;
		font-weight: 500;
		color: #3c4043;
	}

	.sheet-sidebar-count {
		background: #e8eaed;
		color: #3c4043;
		padding: 0.125rem 0.375rem;
		border-radius: 999px;
		font-size: 11px;
	}

	.sheet-sidebar-list {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.sheet-sidebar-item {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.5rem 0.625rem;
		background: #fff;
		border: 1px solid #dadce0;
		border-radius: 4px;
		cursor: grab;
		text-align: left;
		transition: background 0.1s;
		user-select: none;
		touch-action: none;
	}

	.sheet-sidebar-item--dragging {
		opacity: 0.45;
		cursor: grabbing;
	}

	.sheet-root--dragging .sheet-sidebar-item {
		cursor: grabbing;
	}

	.sheet-sidebar-item:hover {
		background: #f8f9fa;
		border-color: #bdc1c6;
	}

	.sheet-sidebar-item-title {
		font-size: 12px;
		font-weight: 500;
		color: #202124;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.sheet-sidebar-item-meta {
		font-size: 11px;
		color: #5f6368;
	}

	.sheet-sidebar-empty {
		padding: 2rem 0.75rem;
		text-align: center;
		color: #9aa0a6;
		font-size: 12px;
	}

	.sheet-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 1rem;
		background: #f8f9fa;
		border-top: 1px solid #dadce0;
		flex-shrink: 0;
	}

	.sheet-legend {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 12px;
		color: #5f6368;
	}

	.sheet-legend-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.1875rem;
		padding: 0.125rem 0.375rem;
		border: 1px solid;
		border-radius: 4px;
		font-size: 11px;
		font-weight: 500;
	}

	.sheet-legend-divider {
		color: #dadce0;
	}

	.sheet-footer-hint {
		font-size: 11px;
		color: #9aa0a6;
	}
</style>
