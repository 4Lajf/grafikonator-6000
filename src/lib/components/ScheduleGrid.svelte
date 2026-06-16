<script>
	import { onMount, tick } from 'svelte';
	import {
		getConventions,
		getRooms,
		getTimeSlots,
		getSchedules,
		getPeopleSchedules,
		getUnscheduledEvents,
		getPeople,
		getPersonHours,
		autoScheduleAll,
		clearAllSchedules,
		createSchedule,
		createPeopleSchedule,
		updateSchedule,
		updatePeopleSchedule,
		movePeopleSchedules,
		swapPeopleSchedules,
		deleteSchedule,
		deletePeopleSchedule,
		getUndoHistory,
		undoLastActions,
		getAvailability
	} from '$lib/database.js';
	import Button from '$lib/components/ui/button/button.svelte';
	import Card from '$lib/components/ui/card/card.svelte';
	import { toast } from 'svelte-sonner';
	import { CircleAlert, TriangleAlert, ArrowUpDown, Lock, Search, X } from 'lucide-svelte';
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
	let people = $state([]);
	let personHours = $state([]);
	let undoHistory = $state([]);
	let selectedSlot = $state(null);
	/** @type {'none' | 'asc' | 'desc'} */
	let unscheduledSort = $state('none');
	let sidebarSearch = $state('');
	let availability = $state([]);
	let loading = $state(true);
	let autoScheduling = $state(false);
	let autoScheduleProgress = $state({ current: 0, total: 0, phase: '' });
	let showIssuesPanel = $state(true);
	let showErrorIssues = $state(true);
	let showWarningIssues = $state(true);
	let showInfoIssues = $state(false);
	let daySections = $state([]);
	let selectedSchedule = $state(null);
	let selectedUnscheduledEvent = $state(null);
	let highlightedIssueScheduleIds = $state(new Set());
	let highlightedIssueKey = $state('');
	let highlightedIssueSeverity = $state(null);
	let highlightedIssueRoomId = $state(null);
	let highlightedIssueSlotIds = $state(new Set());
	let panelAnchorRect = $state(null);
	let blockNextClick = $state(false);
	let chainSwap = $state({
		mode: 'idle',
		sourceScheduleId: null,
		targetScheduleId: null,
		options: [],
		previewOption: null,
		computing: false,
		applying: false,
		timedOut: false,
		error: ''
	});

	const TIME_COL_WIDTH = 56;
	const ROOM_COL_WIDTH_BASE = 240;
	const ROOM_COL_WIDTH_HOURLY = 300;
	const SLOT_HEIGHT = 54;
	const DRAG_THRESHOLD = 5;
	const PREVIEW_SCHEDULE_ID = '__preview__';
	const CHAIN_SWAP_MAX_DEPTH = 5;
	const CHAIN_SWAP_NODE_LIMIT = 4000;
	const CHAIN_SWAP_BRANCH_LIMIT = 14;
	const CHAIN_SWAP_TIME_BUDGET_MS = 1200;
	const CHAIN_SWAP_EVAL_LIMIT = 40;
	const CHAIN_SWAP_OPTION_LIMIT = 6;
	const roomColumnWidth = $derived(
		convention?.slot_minutes >= 60 ? ROOM_COL_WIDTH_HOURLY : ROOM_COL_WIDTH_BASE
	);
	const isPeopleMode = $derived(convention?.schedule_mode === 'people');

	let dragState = $state(null);
	let dropPreview = $state(null);
	let placementHints = $state({ cells: new Map(), swaps: new Map() });

	let dropPreviewFrame = null;
	let progressiveSwapFrame = null;
	let progressiveSwapScrollFrame = null;
	let progressiveSwapItem = null;
	let progressiveSwapQueue = [];
	let progressiveQueuedSwapIds = new Set();
	let progressiveComputedSwapIds = new Set();
	let hintComputeToken = 0;
	let pendingPreviewCoords = null;
	let dropTargetRects = [];
	let sheetScrollEl = $state(null);
	// Per-run caches for the chain-swap planner (range lookups + valid placement
	// lists). Reset at the start of every planning run; never reactive.
	let chainRangeCache = new Map();
	let chainValidPlacements = new Map();
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

	const OK_TILE_COLORS = TIER_COLORS[1];
	const PENDING_SWAP_COLORS = {
		bg: '#f1f3f4',
		border: '#9aa0a6',
		text: '#5f6368',
		label: 'Sprawdzam…',
		kind: 'pending',
		messages: ['Sprawdzam, czy ta zamiana przejdzie…']
	};

	const sidebarSearchTerm = $derived(normalizeSearchText(sidebarSearch));
	const sidebarTotalCount = $derived(isPeopleMode ? people.length : unscheduled.length);

	const displayedUnscheduled = $derived.by(() => {
		let list;
		if (isPeopleMode) {
			const hoursById = new Map(personHours.map((entry) => [entry.id, entry]));
			list = people.map((person) => ({
				id: person.id,
				title: person.display_name,
				duration_minutes: convention?.slot_minutes ?? 30,
				tier: 2,
				auto_schedule: 1,
				host_name: person.display_name,
				hosts: [{ id: person.id, display_name: person.display_name }],
				person,
				color: person.color,
				notes: person.notes,
				conflict_tags: person.conflict_tags,
				co_schedule_tags: person.co_schedule_tags,
				hours: hoursById.get(person.id)
			}));
		} else {
			list = [...unscheduled];
			if (unscheduledSort === 'asc') {
				list.sort((a, b) => Number(a.tier ?? 2) - Number(b.tier ?? 2));
			} else if (unscheduledSort === 'desc') {
				list.sort((a, b) => Number(b.tier ?? 2) - Number(a.tier ?? 2));
			}
		}
		if (!sidebarSearchTerm) return list;
		return list.filter((item) => sidebarItemMatchesSearch(item, sidebarSearchTerm));
	});

	const unscheduledSortTitle = $derived(
		unscheduledSort === 'none'
			? 'Sortuj wg tieru (rosnąco)'
			: unscheduledSort === 'asc'
				? 'Tier rosnąco — kliknij: malejąco'
				: 'Tier malejąco — kliknij: bez sortowania'
	);
	const autoSchedulableCount = $derived(
		isPeopleMode
			? people.length
			: schedules.filter((schedule) => schedule.event?.auto_schedule !== 0).length +
					unscheduled.filter((event) => event.auto_schedule !== 0).length
	);
	const chainSwapSource = $derived(
		chainSwap.sourceScheduleId
			? schedules.find((schedule) => schedule.id === chainSwap.sourceScheduleId)
			: null
	);
	const chainSwapTarget = $derived(
		chainSwap.targetScheduleId
			? schedules.find((schedule) => schedule.id === chainSwap.targetScheduleId)
			: null
	);
	const chainPreviewActive = $derived(chainSwap.mode === 'preview' && !!chainSwap.previewOption);
	// Schedules that move in the previewed option (used to dim everything else).
	const chainPreviewMovingIds = $derived(
		new Set((chainSwap.previewOption?.moves ?? []).map((move) => move.scheduleId))
	);
	// Destination ghost tiles keyed by "dayIdx-colIdx" so each room column can
	// render where its incoming events will land.
	const chainPreviewGhostsByCol = $derived.by(() => {
		const byCol = new Map();
		if (!chainPreviewActive) return byCol;
		const moves = chainSwap.previewOption.moves;
		moves.forEach((move, index) => {
			const slot = hintIndexes.slotById.get(move.to.start_time_slot_id);
			if (!slot) return;
			const dayIdx = daySections.findIndex((day) => day.date === slot.date);
			if (dayIdx < 0) return;
			const colIdx = daySections[dayIdx].roomColumnItems.findIndex(
				(col) => col.room.id === move.to.room_id
			);
			if (colIdx < 0) return;
			const slotIndex = hintIndexes.slotIndexByDate.get(slot.date) ?? new Map();
			const rowIdx =
				slotIndex.get(move.to.start_time_slot_id) ??
				daySections[dayIdx].timeSlots.findIndex((s) => s.id === move.to.start_time_slot_id);
			if (rowIdx < 0) return;
			const schedule = schedules.find((s) => s.id === move.scheduleId);
			const key = `${dayIdx}-${colIdx}`;
			if (!byCol.has(key)) byCol.set(key, []);
			byCol.get(key).push({
				order: index + 1,
				rowIdx,
				slotCount: schedule?.slot_count ?? 1,
				title: move.title,
				fromLabel: formatPlacement(move.from)
			});
		});
		return byCol;
	});
	const activeDropEdgeIds = $derived.by(() => {
		const item = dragState?.item;
		if (!dragState?.moved || !item || !dropPreview) return new Set();

		const day = daySections[dropPreview.dayIdx];
		if (!day) return new Set();

		const daySchedules = hintIndexes.daySchedules.get(day.date) ?? [];
		return new Set(
			findOccupyingSchedules(
				dropPreview.roomId,
				dropPreview.rowIdx,
				item.schedule.slot_count,
				daySchedules,
				day.timeSlots,
				item.isUnscheduled ? null : item.id
			).map((schedule) => schedule.id)
		);
	});
	const activeHintItem = $derived.by(() => {
		if (dragState?.moved) return dragState.item;
		if (selectedSchedule) return { id: selectedSchedule.id, schedule: selectedSchedule };
		if (selectedUnscheduledEvent) return makeUnscheduledDragItem(selectedUnscheduledEvent);
		return null;
	});

	const ISSUE_COLORS = {
		error: { bg: '#fce8e6', border: '#ea4335', text: '#c5221f', label: 'Błąd' },
		warning: { bg: '#fef7e0', border: '#f9ab00', text: '#b06000', label: 'Ostrzeżenie' },
		info: { bg: '#e8f0fe', border: '#1a73e8', text: '#1967d2', label: 'Info' }
	};

	function formatTime(timeStr) {
		return String(timeStr || '').slice(0, 5);
	}

	function cycleUnscheduledSort() {
		unscheduledSort =
			unscheduledSort === 'none' ? 'asc' : unscheduledSort === 'asc' ? 'desc' : 'none';
	}

	function normalizeSearchText(value) {
		return String(value ?? '')
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/\u0142/g, 'l')
			.replace(/\u0141/g, 'l')
			.toLowerCase()
			.trim();
	}

	function flattenSearchValue(value) {
		if (value == null) return '';
		if (Array.isArray(value)) return value.map(flattenSearchValue).join(' ');
		if (typeof value === 'object') {
			return Object.entries(value)
				.flatMap(([key, entry]) => [key, entry])
				.map(flattenSearchValue)
				.join(' ');
		}
		return String(value);
	}

	function sidebarItemMatchesSearch(item, term) {
		const person = item?.person;
		const searchable = [
			item?.title,
			item?.host_name,
			item?.notes,
			item?.organizer_notes,
			item?.conflict_tags,
			item?.co_schedule_tags,
			item?.hosts?.map((host) => host.display_name),
			person?.display_name,
			person?.notes,
			person?.availability_notes,
			person?.conflict_tags,
			person?.co_schedule_tags,
			person?.tag_preferences
		]
			.map(flattenSearchValue)
			.join(' ');

		return normalizeSearchText(searchable).includes(term);
	}

	function scheduleMatchesSearch(schedule, term) {
		const person = schedule?.person;
		const event = schedule?.event;
		const searchable = [
			event?.title,
			event?.kind,
			event?.organizer_notes,
			event?.conflict_tags,
			event?.co_schedule_tags,
			event?.required_room_tags,
			schedule?.host_name,
			schedule?.hosts?.map((host) => host.display_name),
			schedule?.room?.name,
			schedule?.start_slot?.date,
			schedule?.start_slot?.start_time,
			schedule?.start_slot?.end_time,
			person?.display_name,
			person?.notes,
			person?.availability_notes,
			person?.conflict_tags,
			person?.co_schedule_tags,
			person?.tag_preferences
		]
			.map(flattenSearchValue)
			.join(' ');

		return normalizeSearchText(searchable).includes(term);
	}

	// When the sidebar search is active, scheduled tiles that match are spotlighted
	// and the rest dimmed. `null` means no active search (tiles render normally).
	const searchMatchScheduleIds = $derived.by(() => {
		if (!sidebarSearchTerm) return null;
		const ids = new Set();
		for (const schedule of schedules) {
			if (scheduleMatchesSearch(schedule, sidebarSearchTerm)) ids.add(schedule.id);
		}
		return ids;
	});

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

	function getScheduleStartSlotId(schedule) {
		return schedule?.start_time_slot_id ?? schedule?.time_slot_id ?? null;
	}

	function getEndTime(schedule) {
		const startSlotId = getScheduleStartSlotId(schedule);
		const startSlot = schedule.start_slot ?? hintIndexes.slotById.get(startSlotId);
		const dayTimeSlots = getDayTimeSlots(startSlot?.date);
		const startIdx = dayTimeSlots.findIndex((ts) => ts.id === startSlotId);
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
		const startSlotId = getScheduleStartSlotId(schedule);
		const startIdx = dayTimeSlots.findIndex((ts) => ts.id === startSlotId);
		if (startIdx < 0) return [];
		return dayTimeSlots.slice(startIdx, startIdx + schedule.slot_count).map((s) => s.id);
	}

	function getAvailabilityTier(personId, slotId) {
		return hintIndexes.availabilityTier.get(`${personId}|${slotId}`) ?? 1;
	}

	function normalizeTier(value, fallback = 2) {
		const n = Number(value);
		return n === 1 || n === 2 || n === 3 ? n : fallback;
	}

	function normalizeTagList(value) {
		if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
		return String(value ?? '')
			.split(/[,;\n]/)
			.map((tag) => tag.trim())
			.filter(Boolean);
	}

	const ROOM_TAG_LABELS = {
		main_stage: 'Scena główna',
		loud_audio: 'Głośne audio',
		large_screen: 'Duży ekran',
		projector: 'Projektor',
		panel: 'Panel',
		quiet_room: 'Cicha sala',
		discussion: 'Dyskusja',
		contest: 'Konkurs',
		open_area: 'Otwarta przestrzeń',
		drop_in: 'Drop-in',
		rhythm_games: 'Gry rytmiczne',
		workshop_tables: 'Stoły warsztatowe',
		materials: 'Materiały',
		noisy_ok: 'Hałas dozwolony',
		performance: 'Występ'
	};

	function formatRoomTagLabel(tag) {
		return (
			ROOM_TAG_LABELS[tag] ??
			String(tag)
				.replace(/_/g, ' ')
				.replace(/\b\w/g, (char) => char.toUpperCase())
		);
	}

	function getRoomTags(room) {
		return normalizeTagList(room?.capabilities?.tags);
	}

	function formatRoomHeaderName(room) {
		const capacity = Number(room?.capabilities?.capacity);
		if (Number.isFinite(capacity) && capacity > 0) {
			return `${room.name} [${capacity}]`;
		}
		return room.name;
	}

	function getRoomHeaderTags(room) {
		const tags = getRoomTags(room);
		if (room?.name === 'Auditorium') {
			return tags.includes('main_stage') ? ['main_stage'] : [];
		}
		return tags;
	}

	function getSchedulePerson(schedule) {
		const personId =
			schedule?.person_id ??
			schedule?.event?.person?.id ??
			schedule?.hosts?.[0]?.id ??
			schedule?.event?.id;
		return (
			schedule?.person ??
			schedule?.event?.person ??
			people.find((person) => person.id === personId) ??
			null
		);
	}

	function normalizePreferenceTierValue(value) {
		const numeric = Number(value);
		if ([1, 2, 3].includes(numeric)) return numeric;
		const text = String(value ?? '')
			.trim()
			.toLowerCase();
		if (!text) return null;
		if (['x', 'tak', 'chce', 'chcę', 'spoko', 'ok'].includes(text)) return 1;
		if (
			[
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
		if (['-', '#', 'nie', 'nie chce', 'nie chcę', 'nie mogę', 'nie moge'].includes(text)) {
			return 3;
		}
		return null;
	}

	function getPersonRoomPreferenceTier(person, room) {
		const preferences = person?.tag_preferences || {};
		let matched = null;
		const roomPreferenceKeys = [...new Set([room?.name, ...getRoomTags(room)].filter(Boolean))];
		for (const tag of roomPreferenceKeys) {
			const entry = Object.entries(preferences).find(
				([prefTag]) => prefTag.toLowerCase() === tag.toLowerCase()
			);
			const tier = normalizePreferenceTierValue(entry?.[1]);
			if (tier) matched = matched == null ? tier : Math.max(matched, tier);
		}
		// An unset preference defaults to tier 2 ("tylko w razie potrzeby") so the
		// highlighter shows blue, matching the preference dropdowns' default display.
		return matched ?? 2;
	}

	function getRoomFitIssues(schedule, roomId = schedule?.room_id) {
		const room = rooms.find((r) => r.id === roomId);
		if (!room || !schedule?.event) return [];

		const fitIssues = [];
		const roomTags = new Set(getRoomTags(room));
		const requiredTags = normalizeTagList(schedule.event.required_room_tags);
		const missingTags = requiredTags.filter((tag) => !roomTags.has(tag));
		if (missingTags.length > 0) {
			fitIssues.push({
				severity: SEVERITY.ERROR,
				message: `Sala nie ma tagów: ${missingTags.join(', ')}`,
				scheduleId: schedule.id
			});
		}

		const estimatedAttendance = Number(schedule.event.estimated_attendance);
		const capacity = Number(room.capabilities?.capacity);
		if (
			Number.isFinite(estimatedAttendance) &&
			estimatedAttendance > 0 &&
			Number.isFinite(capacity) &&
			capacity > 0 &&
			estimatedAttendance > capacity
		) {
			fitIssues.push({
				severity: SEVERITY.ERROR,
				message: `Sala za mała: ${estimatedAttendance} osób na ${capacity} miejsc`,
				scheduleId: schedule.id
			});
		}

		return fitIssues;
	}

	function getSlotPopularityTier(slotId) {
		const slot = hintIndexes.slotById.get(slotId);
		return normalizeTier(slot?.tier, 2);
	}

	function slotHypeTier(slot) {
		return normalizeTier(slot?.tier, 2);
	}

	function getScheduleSlotTier(schedule) {
		const slotIds = getSlotRange(schedule);
		if (!slotIds.length) return 2;
		let total = 0;
		for (const slotId of slotIds) total += getSlotPopularityTier(slotId);
		return Math.round(total / slotIds.length);
	}

	function getScheduleWorstAvailabilityTier(schedule) {
		const hostIds = getHostIds(schedule);
		const slotIds = getSlotRange(schedule);
		let worstTier = 1;
		for (const hostId of hostIds) {
			for (const slotId of slotIds) {
				worstTier = Math.max(worstTier, getAvailabilityTier(hostId, slotId));
			}
		}
		return worstTier;
	}

	function getSlotAvailabilitySummary(slotId) {
		const counts = { available: 0, prefer: 0, unavailable: 0 };
		for (const person of people) {
			const tier = getAvailabilityTier(person.id, slotId);
			if (tier === 3) counts.unavailable++;
			else if (tier === 2) counts.prefer++;
			else counts.available++;
		}
		return counts;
	}

	function appearanceToSelectedTier(appearance) {
		if (appearance?.kind === 'error') return 3;
		if (appearance?.kind === 'warning' || appearance?.kind === 'info') return 2;
		return 1;
	}

	function makePeopleModeEventForPerson(person) {
		return {
			id: person.id,
			title: person.display_name,
			tier: 2,
			conflict_tags: person.conflict_tags,
			co_schedule_tags: person.co_schedule_tags,
			person
		};
	}

	function getBestPersonFitForSlot(person, slot, roomId = null) {
		if (!isPeopleMode || !slot) return null;
		const day = daySections.find((section) => section.date === slot.date);
		if (!day) return null;
		const rowIdx = day.timeSlots.findIndex((entry) => entry.id === slot.id);
		if (rowIdx < 0) return null;
		const daySchedules = hintIndexes.daySchedules.get(day.date) ?? [];
		const hostIds = new Set([person.id]);
		let best = null;

		// When a specific room/stanowisko is selected, only score that one; otherwise
		// pick the person's best-fitting room for the slot.
		const candidateRooms = roomId ? rooms.filter((room) => room.id === roomId) : rooms;
		for (const room of candidateRooms) {
			const appearance = evaluateScheduleAt(
				hostIds,
				room.id,
				rowIdx,
				1,
				day,
				daySchedules,
				new Set(),
				makePeopleModeEventForPerson(person)
			);
			const tier = appearanceToSelectedTier(appearance);
			const candidate = { tier, appearance, room };
			if (!best || candidate.tier < best.tier) best = candidate;
			if (candidate.tier === 1) break;
		}

		return best;
	}

	function handleSlotClick(slot, event) {
		if (!isPeopleMode) return;
		if (dismissIssueFocusOnClick(event)) return;
		// Clicking the active hour again turns the whole highlight mode off.
		if (selectedSlot?.slot?.id === slot.id) {
			selectedSlot = null;
			return;
		}
		selectedSlot = { slot, roomId: null };
	}

	function handleRoomHighlightClick(room, event) {
		if (!isPeopleMode || !selectedSlot?.slot?.id) return;
		if (dismissIssueFocusOnClick(event)) return;
		// Clicking the active room again drops back to the all-rooms view for the
		// hour, without leaving highlight mode entirely.
		selectedSlot = {
			...selectedSlot,
			roomId: selectedSlot.roomId === room.id ? null : room.id
		};
	}

	const selectedHighlightRoom = $derived(
		selectedSlot?.roomId ? rooms.find((room) => room.id === selectedSlot.roomId) : null
	);

	// Recomputed whenever the selected hour OR room changes, so the sidebar
	// highlights track room/stanowisko selection, not just the hour. Keyed by
	// person id (the sidebar event id in people mode).
	const selectedSlotFits = $derived.by(() => {
		const fits = new Map();
		if (!isPeopleMode || !selectedSlot?.slot?.id) return fits;
		const { slot, roomId } = selectedSlot;
		for (const person of people) {
			fits.set(person.id, getBestPersonFitForSlot(person, slot, roomId));
		}
		return fits;
	});

	function handleGridKeydown(event) {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			handleUndo(1);
		}
	}

	function pushIssue(result, issue) {
		const code = issue.code || inferIssueCode(issue.message);
		result.push({ ...issue, code, priority: issue.priority ?? issuePriority(code, issue.severity) });
	}

	function inferIssueCode(message = '') {
		const text = String(message).toLowerCase();
		if (text.includes('niedostępny w tym czasie')) return 'availability-unavailable';
		if (text.includes('tier atrakcji')) return 'tier-mismatch';
		if (text.includes('tag')) return 'tag-conflict';
		return 'generic';
	}

	function issuePriority(code, severity) {
		if (code === 'availability-unavailable') return 0;
		if (severity === SEVERITY.ERROR) return 10;
		if (severity === SEVERITY.WARNING) return 20;
		if (severity === SEVERITY.INFO) return 30;
		return 40;
	}

	function pushHostAvailabilityIssues(result, sched, slotIds) {
		for (const hostId of getHostIds(sched)) {
			const person = sched.hosts?.find((host) => host.id === hostId);
			const name = person?.display_name || 'Prowadzący';
			let worstForHost = 1;
			for (const slotId of slotIds) {
				worstForHost = Math.max(worstForHost, getAvailabilityTier(hostId, slotId));
			}
			if (worstForHost === 3) {
				pushIssue(result, {
					severity: SEVERITY.ERROR,
					message: `${name}: niedostępny w tym czasie`,
					scheduleId: sched.id,
					personId: hostId
				});
			} else if (worstForHost === 2) {
				pushIssue(result, {
					severity: SEVERITY.WARNING,
					message: `${name}: woli nie w tym czasie`,
					scheduleId: sched.id,
					personId: hostId
				});
			}
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

	function getTileAppearance(scheduleId) {
		const scheduleIssues = issues.filter((issue) => issue.scheduleId === scheduleId);
		const appearance = appearanceFromIssues(scheduleIssues);
		if (appearance.kind !== 'ok') return appearance;
		const schedule = schedules.find((entry) => entry.id === scheduleId);
		const customColor = schedule?.event?.color || schedule?.person?.color;
		if (!customColor) return appearance;
		return {
			...appearance,
			bg: customColor,
			border: customColor,
			text: '#ffffff'
		};
	}

	function appearanceFromIssues(scheduleIssues, tier = 1, options = {}) {
		// Only surface the messages that match the dominant severity. Otherwise a
		// blocking error tile would also list lower-severity notes (e.g. the
		// info-level tier-mismatch), and consumers like the "Nie można przenieść"
		// toast would show that info note as if it were the blocking reason.
		const errorMessages = scheduleIssues
			.filter((issue) => issue.severity === SEVERITY.ERROR)
			.map((issue) => issue.message);
		const warningMessages = scheduleIssues
			.filter((issue) => issue.severity === SEVERITY.WARNING)
			.map((issue) => issue.message);
		const infoMessages = scheduleIssues
			.filter((issue) => issue.severity === SEVERITY.INFO)
			.map((issue) => issue.message);

		if (errorMessages.length) {
			return {
				...ISSUE_COLORS.error,
				kind: 'error',
				messages: errorMessages
			};
		}
		if (warningMessages.length) {
			return {
				...ISSUE_COLORS.warning,
				kind: 'warning',
				messages: warningMessages
			};
		}
		if (infoMessages.length) {
			return {
				...ISSUE_COLORS.info,
				kind: 'info',
				messages: infoMessages
			};
		}

		if (options.useAvailabilityFallback) {
			const tierStyle = TIER_COLORS[tier] || TIER_COLORS[1];
			return {
				...tierStyle,
				kind: 'ok',
				messages: []
			};
		}

		return {
			...OK_TILE_COLORS,
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
				dayTimeSlots.some((ts) => ts.id === getScheduleStartSlotId(s))
			);
			if (!dayTimeSlots.length || !daySchedules.length) continue;
			collectIssuesForDay(daySchedules, dayTimeSlots, result);
		}
		return dedupeIssues(result);
	}

	function issueKey(issue) {
		return `${issue.severity}|${issue.message}|${issue.scheduleId ?? ''}|${issue.personId ?? ''}`;
	}

	function getSchedulePlacement(schedule) {
		return {
			room_id: schedule.room_id,
			start_time_slot_id: getScheduleStartSlotId(schedule)
		};
	}

	function samePlacement(a, b) {
		return a?.room_id === b?.room_id && a?.start_time_slot_id === b?.start_time_slot_id;
	}

	function placementKey(placement) {
		return `${placement.room_id}|${placement.start_time_slot_id}`;
	}

	function getPlacementSlot(placement) {
		return hintIndexes.slotById.get(placement.start_time_slot_id);
	}

	function getPlacementRange(placement, slotCount) {
		const cacheKey = `${placement.start_time_slot_id}|${slotCount}`;
		if (chainRangeCache.has(cacheKey)) return chainRangeCache.get(cacheKey);

		const startSlot = getPlacementSlot(placement);
		let range = null;
		if (startSlot) {
			const slotIndex = hintIndexes.slotIndexByDate.get(startSlot.date) ?? new Map();
			const daySection = daySections.find((day) => day.date === startSlot.date);
			const daySlots =
				daySection?.timeSlots ?? timeSlots.filter((slot) => slot.date === startSlot.date);
			const startIdx =
				slotIndex.get(placement.start_time_slot_id) ??
				daySlots.findIndex((slot) => slot.id === placement.start_time_slot_id);
			if (startIdx >= 0) {
				const block = daySlots.slice(startIdx, startIdx + slotCount);
				range = {
					date: startSlot.date,
					startIdx,
					endIdx: startIdx + slotCount - 1,
					block,
					slotIds: block.map((slot) => slot.id)
				};
			}
		}

		chainRangeCache.set(cacheKey, range);
		return range;
	}

	function formatPlacement(placement) {
		const room = rooms.find((r) => r.id === placement.room_id);
		const slot = getPlacementSlot(placement);
		return `${room?.name ?? '?'} · ${formatDate(slot?.date)} ${formatTime(slot?.start_time)}`;
	}

	function getWorstAvailabilityTierAt(schedule, placement) {
		const range = getPlacementRange(placement, schedule.slot_count);
		if (!range || range.block.length < schedule.slot_count) return 3;
		let worstTier = 1;
		for (const hostId of getHostIds(schedule)) {
			for (const slotId of range.slotIds) {
				worstTier = Math.max(worstTier, getAvailabilityTier(hostId, slotId));
			}
		}
		return worstTier;
	}

	function getBlockSlotTier(slotIds) {
		if (!slotIds.length) return 2;
		const total = slotIds.reduce((sum, slotId) => sum + getSlotPopularityTier(slotId), 0);
		return Math.round(total / slotIds.length);
	}

	// Whether a schedule can intrinsically sit at a placement, ignoring who else
	// is there. Depends only on the static layout/availability, so results are
	// cached for the duration of a single planning run.
	function getIntrinsicPlacementResult(schedule, placement) {
		const range = getPlacementRange(placement, schedule.slot_count);
		if (!range || range.block.length < schedule.slot_count) {
			return { valid: false, warningCount: 0, score: Infinity };
		}

		const roomFitIssues = getRoomFitIssues(schedule, placement.room_id);
		if (roomFitIssues.some((issue) => issue.severity === SEVERITY.ERROR)) {
			return { valid: false, warningCount: 0, score: Infinity };
		}

		const worstTier = getWorstAvailabilityTierAt(schedule, placement);
		if (worstTier === 3) {
			return { valid: false, warningCount: 0, score: Infinity };
		}
		const warningCount = worstTier === 2 ? 1 : 0;

		const eventTier = normalizeTier(schedule.event?.tier, 2);
		const slotTier = getBlockSlotTier(range.slotIds);
		const tierDistance = Math.abs(eventTier - slotTier);
		const currentSlot = getPlacementSlot(getSchedulePlacement(schedule));
		const roomDistance = Math.max(
			0,
			rooms.findIndex((room) => room.id === placement.room_id)
		);
		const sameDate = currentSlot?.date === range.date;
		const currentStartSlotId = getScheduleStartSlotId(schedule);
		const currentRow = sameDate
			? (hintIndexes.slotIndexByDate.get(range.date)?.get(currentStartSlotId) ?? range.startIdx)
			: range.startIdx;
		const score =
			warningCount * 1000 +
			tierDistance * 30 +
			(sameDate ? 0 : 20) +
			(schedule.room_id === placement.room_id ? 0 : 5) +
			Math.abs(range.startIdx - currentRow) +
			roomDistance;

		return { valid: true, warningCount, score };
	}

	function placementsOverlapInRoom(left, leftPlacement, right, rightPlacement) {
		if (leftPlacement.room_id !== rightPlacement.room_id) return false;
		const leftRange = getPlacementRange(leftPlacement, left.slot_count);
		const rightRange = getPlacementRange(rightPlacement, right.slot_count);
		if (!leftRange || !rightRange || leftRange.date !== rightRange.date) return false;
		return !(leftRange.endIdx < rightRange.startIdx || rightRange.endIdx < leftRange.startIdx);
	}

	function getAssignedPlacement(schedule, assignments) {
		return assignments.get(schedule.id) ?? getSchedulePlacement(schedule);
	}

	function findRoomOverlaps(assignments, movingSchedule, placement, unplacedIds) {
		const overlaps = [];
		for (const candidate of schedules) {
			if (candidate.id === movingSchedule.id || unplacedIds.has(candidate.id)) continue;
			const candidatePlacement = getAssignedPlacement(candidate, assignments);
			if (placementsOverlapInRoom(movingSchedule, placement, candidate, candidatePlacement)) {
				overlaps.push(candidate);
			}
		}
		return overlaps;
	}

	// All intrinsically valid placements for a schedule, sorted best-first. The
	// set does not depend on occupancy, so it is computed once per schedule per
	// planning run and reused across every search node.
	function getValidPlacements(schedule) {
		if (chainValidPlacements.has(schedule.id)) return chainValidPlacements.get(schedule.id);
		const scored = [];
		for (const day of daySections) {
			const maxStartRow = Math.max(0, day.timeSlots.length - schedule.slot_count);
			for (const room of rooms) {
				for (let rowIdx = 0; rowIdx <= maxStartRow; rowIdx++) {
					const startSlot = day.timeSlots[rowIdx];
					if (!startSlot) continue;
					const placement = { room_id: room.id, start_time_slot_id: startSlot.id };
					const intrinsic = getIntrinsicPlacementResult(schedule, placement);
					if (!intrinsic.valid) continue;
					scored.push({ placement, score: intrinsic.score });
				}
			}
		}
		scored.sort((a, b) => a.score - b.score);
		const placements = scored.map((entry) => entry.placement);
		chainValidPlacements.set(schedule.id, placements);
		return placements;
	}

	function buildHypotheticalSchedulesForAssignments(assignments) {
		return schedules.map((schedule) => {
			const placement = assignments.get(schedule.id);
			if (!placement) return schedule;
			const startSlot = getPlacementSlot(placement);
			return {
				...schedule,
				room_id: placement.room_id,
				start_time_slot_id: placement.start_time_slot_id,
				time_slot_id: placement.start_time_slot_id,
				start_slot: startSlot ? { ...startSlot } : schedule.start_slot
			};
		});
	}

	function normalizeTags(value) {
		if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
		return String(value ?? '')
			.split(/[,;\n]/)
			.map((tag) => tag.trim())
			.filter(Boolean);
	}

	function sharedTags(a, b) {
		const right = new Set(normalizeTags(b).map((tag) => tag.toLowerCase()));
		return normalizeTags(a).filter((tag) => right.has(tag.toLowerCase()));
	}

	function getScheduleConflictTags(schedule) {
		return normalizeTags(schedule?.event?.conflict_tags ?? schedule?.person?.conflict_tags);
	}

	function getScheduleCoTags(schedule) {
		return normalizeTags(schedule?.event?.co_schedule_tags ?? schedule?.person?.co_schedule_tags);
	}

	function buildChainMoves(assignments, scheduleById, sourceSchedule, targetSchedule) {
		return [...assignments.entries()]
			.map(([scheduleId, placement]) => {
				const schedule = scheduleById.get(scheduleId);
				if (!schedule || samePlacement(getSchedulePlacement(schedule), placement)) return null;
				return {
					scheduleId,
					title: schedule.event?.title ?? 'Atrakcja',
					from: getSchedulePlacement(schedule),
					to: placement
				};
			})
			.filter(Boolean)
			.sort((a, b) => {
				if (a.scheduleId === sourceSchedule.id) return -1;
				if (b.scheduleId === sourceSchedule.id) return 1;
				if (a.scheduleId === targetSchedule.id) return -1;
				if (b.scheduleId === targetSchedule.id) return 1;
				return a.title.localeCompare(b.title);
			});
	}

	function chainSolutionId(moves) {
		return moves
			.map((move) => `${move.scheduleId}:${placementKey(move.to)}`)
			.sort()
			.join('|');
	}

	// Runs the full issue engine once for a candidate plan. Expensive, so it is
	// only called for the small set of finalists, never inside the search loop.
	function buildChainSwapOption(assignments, moves, baselineIssueKeys) {
		if (!moves.length) return null;
		const changedIds = new Set(moves.map((move) => move.scheduleId));
		const finalIssues = collectHypotheticalIssues(
			buildHypotheticalSchedulesForAssignments(assignments)
		);
		const isGenerated = (issue) =>
			changedIds.has(issue.scheduleId) || !baselineIssueKeys.has(issueKey(issue));

		if (finalIssues.some((issue) => issue.severity === SEVERITY.ERROR && isGenerated(issue))) {
			return null;
		}

		const generatedWarnings = dedupeIssues(
			finalIssues.filter((issue) => issue.severity === SEVERITY.WARNING && isGenerated(issue))
		);
		const generatedInfo = dedupeIssues(
			finalIssues.filter((issue) => issue.severity === SEVERITY.INFO && isGenerated(issue))
		);

		return {
			id: chainSolutionId(moves),
			moves,
			warnings: generatedWarnings,
			info: generatedInfo,
			score: moves.length * 10000 + generatedWarnings.length * 1000 + generatedInfo.length * 10
		};
	}

	function findChainSwapOptions(sourceSchedule, targetSchedule) {
		chainRangeCache = new Map();
		chainValidPlacements = new Map();

		const sourcePlacement = getSchedulePlacement(sourceSchedule);
		const targetPlacement = getSchedulePlacement(targetSchedule);
		if (sourceSchedule.locked) {
			return { options: [], timedOut: false, sourceFits: true, lockedSchedule: sourceSchedule };
		}
		if (samePlacement(sourcePlacement, targetPlacement)) {
			return { options: [], timedOut: false, sourceFits: true, lockedSchedule: null };
		}

		// If the source physically cannot sit in the chosen spot (room/availability),
		// no chain of moves can ever satisfy the request.
		if (!getIntrinsicPlacementResult(sourceSchedule, targetPlacement).valid) {
			return { options: [], timedOut: false, sourceFits: false, lockedSchedule: null };
		}

		const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
		const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
		const deadline = clock() + CHAIN_SWAP_TIME_BUDGET_MS;

		const seedAssignments = new Map([[sourceSchedule.id, targetPlacement]]);
		const seedPending = findRoomOverlaps(
			seedAssignments,
			sourceSchedule,
			targetPlacement,
			new Set()
		)
			.filter((schedule) => schedule.id !== sourceSchedule.id)
			.map((schedule) => schedule.id);
		const seedLocked = findLockedSchedule(seedPending.map((id) => scheduleById.get(id)));
		if (seedLocked) {
			return { options: [], timedOut: false, sourceFits: true, lockedSchedule: seedLocked };
		}

		const rawSolutions = [];
		const seenSolutions = new Set();
		const seenStates = new Set();
		let nodes = 0;
		let timedOut = false;
		let lockedSchedule = null;

		function search(assignments, pendingIds, depth) {
			if (timedOut) return;
			if (nodes++ > CHAIN_SWAP_NODE_LIMIT) return;
			if (clock() > deadline) {
				timedOut = true;
				return;
			}

			const pending = pendingIds.filter((id) => !assignments.has(id));
			const stateKey = `${[...assignments.entries()]
				.map(([id, placement]) => `${id}:${placementKey(placement)}`)
				.sort()
				.join('|')}::${[...pending].sort().join(',')}`;
			if (seenStates.has(stateKey)) return;
			seenStates.add(stateKey);

			if (pending.length === 0) {
				const moves = buildChainMoves(assignments, scheduleById, sourceSchedule, targetSchedule);
				const id = chainSolutionId(moves);
				if (moves.length && !seenSolutions.has(id)) {
					seenSolutions.add(id);
					rawSolutions.push(new Map(assignments));
				}
				return;
			}

			if (depth >= CHAIN_SWAP_MAX_DEPTH) return;

			// Most-constrained displaced event first (fewest valid homes).
			let currentId = null;
			let currentPlacements = null;
			for (const id of pending) {
				const schedule = scheduleById.get(id);
				const placements = schedule ? getValidPlacements(schedule) : [];
				if (currentPlacements === null || placements.length < currentPlacements.length) {
					currentId = id;
					currentPlacements = placements;
				}
			}
			const currentSchedule = scheduleById.get(currentId);
			if (!currentSchedule || !currentPlacements) return;
			if (currentSchedule.locked) {
				lockedSchedule = lockedSchedule ?? currentSchedule;
				return;
			}

			const remainingPending = pending.filter((id) => id !== currentId);
			const unplacedIds = new Set(remainingPending);
			let branches = 0;

			for (const placement of currentPlacements) {
				if (branches >= CHAIN_SWAP_BRANCH_LIMIT || timedOut) break;

				const occupants = findRoomOverlaps(assignments, currentSchedule, placement, unplacedIds);
				// Cannot displace the source (pinned to the chosen spot) or anything we
				// already committed to a placement earlier in this branch.
				if (occupants.some((occupant) => occupant.id === sourceSchedule.id)) continue;
				if (occupants.some((occupant) => assignments.has(occupant.id))) continue;
				const lockedOccupant = findLockedSchedule(occupants);
				if (lockedOccupant) {
					lockedSchedule = lockedSchedule ?? lockedOccupant;
					continue;
				}

				branches++;
				const nextAssignments = new Map(assignments);
				nextAssignments.set(currentId, placement);

				const nextPending = [...remainingPending];
				for (const occupant of occupants) {
					if (!nextAssignments.has(occupant.id) && !nextPending.includes(occupant.id)) {
						nextPending.push(occupant.id);
					}
				}
				search(nextAssignments, nextPending, depth + 1);
			}
		}

		search(seedAssignments, seedPending, 0);

		const baselineIssueKeys = new Set(issues.map(issueKey));
		const prelim = rawSolutions
			.map((assignments) => ({
				assignments,
				moves: buildChainMoves(assignments, scheduleById, sourceSchedule, targetSchedule)
			}))
			.filter((entry) => {
				if (entry.moves.length === 0) return false;
				const lockedMove = entry.moves
					.map((move) => scheduleById.get(move.scheduleId))
					.find((schedule) => schedule?.locked);
				if (lockedMove) {
					lockedSchedule = lockedSchedule ?? lockedMove;
					return false;
				}
				return true;
			})
			.sort((a, b) => a.moves.length - b.moves.length);

		const evaluated = [];
		const evaluatedIds = new Set();
		for (const entry of prelim.slice(0, CHAIN_SWAP_EVAL_LIMIT)) {
			const option = buildChainSwapOption(entry.assignments, entry.moves, baselineIssueKeys);
			if (option && !evaluatedIds.has(option.id)) {
				evaluatedIds.add(option.id);
				evaluated.push(option);
			}
		}

		const sortOptions = (list) =>
			[...list].sort((a, b) => a.score - b.score || a.moves.length - b.moves.length);
		const cleanOptions = sortOptions(evaluated.filter((option) => option.warnings.length === 0));
		const ranked =
			cleanOptions.length > 0 ? cleanOptions : sortOptions(evaluated);

		return {
			options: ranked.slice(0, CHAIN_SWAP_OPTION_LIMIT),
			timedOut,
			sourceFits: true,
			lockedSchedule
		};
	}

	function getEventSlotCount(event) {
		if (isPeopleMode) return 1;
		if (!convention?.slot_minutes) return 1;
		return Math.ceil(event.duration_minutes / convention.slot_minutes);
	}

	function makeUnscheduledDragItem(event) {
		if (isPeopleMode) {
			return {
				id: `person-${event.id}`,
				isUnscheduled: true,
				isPersonBlock: true,
				personId: event.id,
				eventId: event.id,
				schedule: {
					slot_count: 1,
					event,
					hosts: event.hosts,
					host_name: event.host_name,
					room_id: null,
					start_time_slot_id: null
				}
			};
		}
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
		if ('time_slot_id' in sched) sched.time_slot_id = startTimeSlotId;
		if (slot) sched.start_slot = slot;
	}

	function lockedMoveMessage(schedule) {
		const title = schedule?.event?.title ?? 'Ta atrakcja';
		return `„${title}" jest zablokowana i nie może zostać przeniesiona.`;
	}

	function lockedMoveAppearance(schedule) {
		return appearanceFromIssues([{ severity: SEVERITY.ERROR, message: lockedMoveMessage(schedule) }], 1);
	}

	function findLockedSchedule(schedulesToCheck) {
		return schedulesToCheck.find((schedule) => schedule?.locked === true) ?? null;
	}

	function findLockedOverlap(item, target) {
		if (!item || !target) return null;
		const day = daySections[target.dayIdx];
		if (!day) return null;
		const daySchedules = hintIndexes.daySchedules.get(day.date) ?? [];
		return findLockedSchedule(
			findOccupyingSchedules(
				target.roomId,
				target.rowIdx,
				item.schedule.slot_count,
				daySchedules,
				day.timeSlots,
				item.isUnscheduled ? null : item.id
			)
		);
	}

	function buildDirectDropPlan(item, target) {
		if (!target || item.isUnscheduled) return null;

		const targetDay = daySections[target.dayIdx];
		if (!targetDay) return null;
		const targetDaySchedules = hintIndexes.daySchedules.get(targetDay.date) ?? [];
		const sourceDay = daySections.find(
			(section) => section.date === item.schedule.start_slot?.date
		);
		const sourceStartRow = sourceDay ? getScheduleStartRow(item.schedule, sourceDay) : -1;
		if (!targetDay || !sourceDay || sourceStartRow < 0) return null;

		const initialOverlaps = findOccupyingSchedules(
			target.roomId,
			target.rowIdx,
			item.schedule.slot_count,
			targetDaySchedules,
			targetDay.timeSlots,
			item.id
		);

		if (initialOverlaps.length === 0) {
			return {
				target,
				moves: [
					{
						schedule: item.schedule,
						scheduleId: item.id,
						roomId: target.roomId,
						startTimeSlotId: target.startTimeSlotId,
						day: targetDay,
						rowIdx: target.rowIdx
					}
				]
			};
		}

		const targetStartRow = Math.min(
			...initialOverlaps.map((schedule) => getScheduleStartRow(schedule, targetDay))
		);
		const targetStartSlot = targetDay.timeSlots[targetStartRow];
		if (!targetStartSlot) return null;

		const anchoredTarget = {
			...target,
			rowIdx: targetStartRow,
			startTimeSlotId: targetStartSlot.id
		};
		const overlaps = findOccupyingSchedules(
			target.roomId,
			targetStartRow,
			item.schedule.slot_count,
			targetDaySchedules,
			targetDay.timeSlots,
			item.id
		);
		const moves = [
			{
				schedule: item.schedule,
				scheduleId: item.id,
				roomId: target.roomId,
				startTimeSlotId: targetStartSlot.id,
				day: targetDay,
				rowIdx: targetStartRow
			}
		];

		for (const schedule of overlaps) {
			const overlapStartRow = getScheduleStartRow(schedule, targetDay);
			const sourceRowIdx = sourceStartRow + (overlapStartRow - targetStartRow);
			const sourceSlot = sourceDay.timeSlots[sourceRowIdx];
			if (!sourceSlot) return null;

			moves.push({
				schedule,
				scheduleId: schedule.id,
				roomId: item.schedule.room_id,
				startTimeSlotId: sourceSlot.id,
				day: sourceDay,
				rowIdx: sourceRowIdx
			});
		}

		return { target: anchoredTarget, moves };
	}

	function buildHypotheticalDropResult(item, target) {
		const hyp = schedules.map((s) => ({
			...s,
			start_slot: s.start_slot ? { ...s.start_slot } : null
		}));

		if (item.isUnscheduled) {
			const day = daySections[target.dayIdx];
			const daySchedules = hyp.filter((s) =>
				day.timeSlots.some((ts) => ts.id === getScheduleStartSlotId(s))
			);
			const existing = findOccupyingSchedules(
				target.roomId,
				target.rowIdx,
				item.schedule.slot_count,
				daySchedules,
				day.timeSlots,
				null
			);

			for (const schedule of existing) {
				const idx = hyp.findIndex((s) => s.id === schedule.id);
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
			return { schedules: hyp, movedIds: new Set([PREVIEW_SCHEDULE_ID]), target };
		}

		const plan = buildDirectDropPlan(item, target);
		if (!plan) return { schedules: hyp, movedIds: new Set([item.id]), target };

		for (const move of plan.moves) {
			const schedule = hyp.find((s) => s.id === move.scheduleId);
			if (schedule) patchSchedulePlacement(schedule, move.roomId, move.startTimeSlotId);
		}

		return {
			schedules: hyp,
			movedIds: new Set(plan.moves.map((move) => move.scheduleId)),
			target: plan.target
		};
	}

	function buildHypotheticalSchedules(item, target) {
		return buildHypotheticalDropResult(item, target).schedules;
	}

	function getDropPreviewAppearance(item, target) {
		if (!target || !item) {
			return appearanceFromIssues([], 1);
		}

		if (!item.isUnscheduled && item.schedule.locked) {
			return lockedMoveAppearance(item.schedule);
		}

		const lockedOverlap = findLockedOverlap(item, target);
		if (lockedOverlap) return lockedMoveAppearance(lockedOverlap);

		const samePlace =
			!item.isUnscheduled &&
			item.schedule.room_id === target.roomId &&
			getScheduleStartSlotId(item.schedule) === target.startTimeSlotId;
		if (samePlace) {
			return getTileAppearance(item.id);
		}

		const { schedules: hyp, movedIds } = buildHypotheticalDropResult(item, target);
		const previewId = getPreviewScheduleId(item);
		const previewIssues = collectHypotheticalIssues(hyp).filter((issue) =>
			movedIds.has(issue.scheduleId ?? previewId)
		);
		const tier = Math.max(
			1,
			...hyp
				.filter((schedule) => movedIds.has(schedule.id))
				.map((schedule) => getScheduleWorstAvailabilityTier(schedule))
		);
		return appearanceFromIssues(previewIssues, tier, { useAvailabilityFallback: true });
	}

	function buildDropPreview(clientX, clientY, item) {
		const target = getDropTarget(clientX, clientY, item.schedule.slot_count);
		if (!target) return null;
		const plan = buildDirectDropPlan(item, target);
		const previewTarget = plan?.target ?? target;
		return {
			...previewTarget,
			appearance: getCachedDropPreviewAppearance(item, previewTarget)
		};
	}

	function getCachedDropPreviewAppearance(item, target) {
		if (!target || !item) {
			return appearanceFromIssues([], 1);
		}

		if (!item.isUnscheduled && item.schedule.locked) {
			return lockedMoveAppearance(item.schedule);
		}

		const samePlace =
			!item.isUnscheduled &&
			item.schedule.room_id === target.roomId &&
			getScheduleStartSlotId(item.schedule) === target.startTimeSlotId;
		if (samePlace) {
			return getTileAppearance(item.id);
		}

		const lockedOverlap = findLockedOverlap(item, target);
		if (lockedOverlap) return lockedMoveAppearance(lockedOverlap);

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
				return (
					getDirectDropPlanAppearance(item, target) ??
					getSwapPreviewAppearance(item, existing, day, daySchedules)
				);
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
					rowIdx: dayTimeSlots.findIndex((ts) => ts.id === getScheduleStartSlotId(s))
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
			const date = schedule.start_slot?.date ?? slotById.get(getScheduleStartSlotId(schedule))?.date;
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
		const roomSlotMap = new Map();
		const roomScheduleSequence = new Map();

		for (const sched of daySchedules) {
			const hostIds = getHostIds(sched);
			const slotIds = getSlotRange(sched, dayTimeSlots);
			const startIdx = dayTimeSlots.findIndex((ts) => ts.id === getScheduleStartSlotId(sched));
			// Slot popularity ("hype") tiers are an events-mode concept; people view
			// has no hype, so the tier-vs-slot mismatch note must not be generated there.
			if (!isPeopleMode) {
				const eventTier = normalizeTier(sched.event?.tier, 2);
				const slotTier = getScheduleSlotTier(sched);
				if (Math.abs(eventTier - slotTier) > 0) {
					pushIssue(result, {
						severity: SEVERITY.INFO,
						message: `Tier atrakcji T${eventTier} jest w slocie T${slotTier} (${sched.event.title})`,
						scheduleId: sched.id
					});
				}
			}

			if (startIdx >= 0 && startIdx + sched.slot_count > dayTimeSlots.length) {
				pushIssue(result, {
					severity: SEVERITY.ERROR,
					message: 'Brak wystarczającej liczby terminów tego dnia',
					scheduleId: sched.id
				});
			}

			for (const issue of getRoomFitIssues(sched)) {
				pushIssue(result, issue);
			}

			pushHostAvailabilityIssues(result, sched, slotIds);

			if (isPeopleMode) {
				const person = getSchedulePerson(sched);
				const room = rooms.find((entry) => entry.id === sched.room_id);
				const roomPreferenceTier = getPersonRoomPreferenceTier(person, room);
				if (roomPreferenceTier === 3) {
					pushIssue(result, {
						severity: SEVERITY.ERROR,
						code: 'room-tag-unwanted',
						message: `${person?.display_name || 'Osoba'}: nie chce pracować w ${room?.name || 'tym stanowisku'}`,
						scheduleId: sched.id,
						personId: person?.id
					});
				} else if (roomPreferenceTier === 2) {
					pushIssue(result, {
						severity: SEVERITY.INFO,
						code: 'room-tag-soft',
						message: `${person?.display_name || 'Osoba'}: ${room?.name || 'stanowisko'} tylko jeśli będzie potrzeba`,
						scheduleId: sched.id,
						personId: person?.id
					});
				}
			}

			if (!roomSlotMap.has(sched.room_id)) roomSlotMap.set(sched.room_id, new Map());
			if (!roomScheduleSequence.has(sched.room_id)) roomScheduleSequence.set(sched.room_id, []);
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
			if (startIdx >= 0) {
				roomScheduleSequence.get(sched.room_id).push({ sched, startIdx });
			}

			for (const hostId of hostIds) {
				if (!personSlotMap.has(hostId)) personSlotMap.set(hostId, new Map());

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
			}
		}

		for (let i = 0; i < daySchedules.length; i++) {
			for (let j = i + 1; j < daySchedules.length; j++) {
				const a = daySchedules[i];
				const b = daySchedules[j];
				const aSlots = getSlotRange(a, dayTimeSlots);
				const bSlots = getSlotRange(b, dayTimeSlots);
				const overlaps = aSlots.some((slotId) => bSlots.includes(slotId));
				if (!overlaps) continue;
				const conflictTags = sharedTags(getScheduleConflictTags(a), getScheduleConflictTags(b));
				if (conflictTags.length) {
					const message = `Konflikt tagów (${conflictTags.join(', ')})`;
					pushIssue(result, {
						severity: SEVERITY.ERROR,
						code: 'tag-conflict',
						message,
						scheduleId: a.id
					});
					pushIssue(result, {
						severity: SEVERITY.ERROR,
						code: 'tag-conflict',
						message,
						scheduleId: b.id
					});
				}
			}
		}

		const coTagged = daySchedules.filter((schedule) => getScheduleCoTags(schedule).length);
		if (isPeopleMode) {
			for (const schedule of coTagged) {
				const missingTags = [];
				const scheduleSlots = getSlotRange(schedule, dayTimeSlots);
				for (const tag of getScheduleCoTags(schedule)) {
					const tagKey = tag.toLowerCase();
					const related = coTagged.filter(
						(other) =>
							other.id !== schedule.id &&
							getScheduleCoTags(other).some((otherTag) => otherTag.toLowerCase() === tagKey)
					);
					if (!related.length) continue;
					const hasSameSlotPartner = related.some((other) => {
						const otherSlots = getSlotRange(other, dayTimeSlots);
						return scheduleSlots.some((slotId) => otherSlots.includes(slotId));
					});
					if (!hasSameSlotPartner) missingTags.push(tag);
				}
				if (!missingTags.length) continue;
				pushIssue(result, {
					severity: SEVERITY.WARNING,
					code: 'co-schedule-split',
					message: `Powinny być w tym samym slocie (tag: ${missingTags.join(', ')})`,
					scheduleId: schedule.id
				});
			}
		} else {
			for (let i = 0; i < coTagged.length; i++) {
				for (let j = i + 1; j < coTagged.length; j++) {
					const a = coTagged[i];
					const b = coTagged[j];
					const tags = sharedTags(getScheduleCoTags(a), getScheduleCoTags(b));
					if (!tags.length) continue;
					const aSlots = getSlotRange(a, dayTimeSlots);
					const bSlots = getSlotRange(b, dayTimeSlots);
					if (aSlots.some((slotId) => bSlots.includes(slotId))) continue;
					const message = `Powinny być w tym samym slocie (tag: ${tags.join(', ')})`;
					pushIssue(result, {
						severity: SEVERITY.WARNING,
						code: 'co-schedule-split',
						message,
						scheduleId: a.id
					});
					pushIssue(result, {
						severity: SEVERITY.WARNING,
						code: 'co-schedule-split',
						message,
						scheduleId: b.id
					});
				}
			}
		}

		for (const [roomId, seq] of roomScheduleSequence) {
			const sorted = seq.sort((a, b) => a.startIdx - b.startIdx);
			for (let i = 1; i < sorted.length; i++) {
				const prev = sorted[i - 1];
				const curr = sorted[i];
				const prevEnd = prev.startIdx + prev.sched.slot_count;
				if (curr.startIdx <= prevEnd) continue;

				const roomName = rooms.find((r) => r.id === roomId)?.name || '?';
				const gapStart = dayTimeSlots[prevEnd]?.start_time;
				const gapEnd = dayTimeSlots[curr.startIdx]?.start_time;
				const message = `Luka w sali ${roomName}: ${formatTime(gapStart)}-${formatTime(gapEnd)}`;
				pushIssue(result, {
					severity: SEVERITY.WARNING,
					message,
					scheduleId: prev.sched.id
				});
				pushIssue(result, {
					severity: SEVERITY.WARNING,
					message,
					scheduleId: curr.sched.id
				});
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
			const priorityA = a.priority ?? issuePriority(a.code, a.severity);
			const priorityB = b.priority ?? issuePriority(b.code, b.severity);
			if (priorityA !== priorityB) return priorityA - priorityB;
			return String(a.message).localeCompare(String(b.message));
		});
	});

	const panelTimeSlots = $derived.by(() => {
		if (selectedUnscheduledEvent) return timeSlots;
		if (!selectedSchedule?.start_slot?.date) return [];
		const day = daySections.find((section) => section.date === selectedSchedule.start_slot.date);
		return day?.timeSlots ?? [];
	});

	const issueSummary = $derived.by(() => {
		const grouped = new Map();
		for (const issue of issues) {
			const key = `${issue.severity}|${issue.message}`;
			if (!grouped.has(key)) {
				grouped.set(key, {
					...issue,
					key,
					scheduleIds: issue.scheduleId ? [issue.scheduleId] : []
				});
				continue;
			}

			const summary = grouped.get(key);
			if (issue.scheduleId && !summary.scheduleIds.includes(issue.scheduleId)) {
				summary.scheduleIds = [...summary.scheduleIds, issue.scheduleId];
			}
		}
		return [...grouped.values()];
	});

	const errorCount = $derived(issueSummary.filter((i) => i.severity === SEVERITY.ERROR).length);
	const warningCount = $derived(issueSummary.filter((i) => i.severity === SEVERITY.WARNING).length);
	const infoCount = $derived(issueSummary.filter((i) => i.severity === SEVERITY.INFO).length);

	const visibleIssues = $derived(
		issueSummary.filter((issue) => {
			if (issue.severity === SEVERITY.ERROR) return showErrorIssues;
			if (issue.severity === SEVERITY.WARNING) return showWarningIssues;
			if (issue.severity === SEVERITY.INFO) return showInfoIssues;
			return true;
		})
	);

	const issueFocusActive = $derived(highlightedIssueScheduleIds.size > 0);

	function clearIssueFocus() {
		highlightedIssueScheduleIds = new Set();
		highlightedIssueKey = '';
		highlightedIssueSeverity = null;
		highlightedIssueRoomId = null;
		highlightedIssueSlotIds = new Set();
	}

	function dismissIssueFocusOnClick(event) {
		if (!issueFocusActive) return false;
		event?.stopPropagation?.();
		clearIssueFocus();
		return true;
	}

	function buildIssueFocusContext(scheduleIds) {
		const slotIds = new Set();
		let roomId = null;
		for (const scheduleId of scheduleIds) {
			const sched = schedules.find((entry) => entry.id === scheduleId);
			if (!sched) continue;
			roomId ??= sched.room_id;
			for (const slotId of getSlotRange(sched)) slotIds.add(slotId);
		}
		return { slotIds, roomId };
	}

	function scrollScheduleIntoView(element) {
		if (!element) return;
		const scrollEl = getDropTargetScrollEl();
		if (!scrollEl) {
			element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
			return;
		}

		const scrollRect = scrollEl.getBoundingClientRect();
		const elementRect = element.getBoundingClientRect();
		const top =
			elementRect.top - scrollRect.top + scrollEl.scrollTop - scrollEl.clientHeight / 2 + elementRect.height / 2;
		const left =
			elementRect.left - scrollRect.left + scrollEl.scrollLeft - scrollEl.clientWidth / 2 + elementRect.width / 2;

		scrollEl.scrollTo({
			top: Math.max(0, top),
			left: Math.max(0, left),
			behavior: 'smooth'
		});
	}

	function findScheduleElement(scheduleId) {
		return [...document.querySelectorAll('.sheet-event[data-schedule-id]')].find(
			(element) => element.getAttribute('data-schedule-id') === scheduleId
		);
	}

	async function highlightIssueSchedules(event, issue) {
		event.stopPropagation();
		const scheduleIds = issue.scheduleIds?.length
			? issue.scheduleIds
			: issue.scheduleId
				? [issue.scheduleId]
				: [];
		if (scheduleIds.length === 0) return;

		closeEventPanel();
		selectedSlot = null;
		selectedSchedule = null;
		highlightedIssueKey = issue.key ?? issueKey(issue);
		highlightedIssueSeverity = issue.severity ?? null;

		const focusContext = buildIssueFocusContext(scheduleIds);
		highlightedIssueRoomId = focusContext.roomId;
		highlightedIssueSlotIds = focusContext.slotIds;

		// Reset then re-apply so the pulse animation retriggers on repeated clicks.
		highlightedIssueScheduleIds = new Set();
		await tick();
		highlightedIssueScheduleIds = new Set(scheduleIds);
		await tick();

		const target = findScheduleElement(scheduleIds[0]);
		scrollScheduleIntoView(target);
		target?.focus({ preventScroll: true });
	}

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
		const startSlotId = getScheduleStartSlotId(schedule);
		const scheduleStart =
			slotIndex.get(startSlotId) ?? dayTimeSlots.findIndex((ts) => ts.id === startSlotId);
		if (scheduleStart < 0) return false;
		const scheduleEnd = scheduleStart + schedule.slot_count - 1;
		const targetEnd = startRow + slotCount - 1;
		return !(scheduleEnd < startRow || scheduleStart > targetEnd);
	}

	function schedulesShareHost(schedule, hostIds) {
		return schedule.hosts?.some((host) => hostIds.has(host.id));
	}

	function buildPreviewSchedule(hostIds, roomId, startTimeSlotId, slotCount, event) {
		const firstHostId = [...hostIds][0] ?? event?.person?.id ?? event?.id;
		const person = event?.person ?? people.find((entry) => entry.id === firstHostId) ?? null;
		const title = event?.title ?? person?.display_name ?? 'Podgląd';
		return {
			id: PREVIEW_SCHEDULE_ID,
			person_id: person?.id ?? firstHostId,
			room_id: roomId,
			time_slot_id: startTimeSlotId,
			start_time_slot_id: startTimeSlotId,
			slot_count: slotCount,
			person,
			event: {
				...(event || {}),
				id: event?.id ?? person?.id ?? PREVIEW_SCHEDULE_ID,
				title,
				conflict_tags: event?.conflict_tags ?? person?.conflict_tags ?? [],
				co_schedule_tags: event?.co_schedule_tags ?? person?.co_schedule_tags ?? []
			},
			hosts: [...hostIds].map((hostId) => {
				const host = people.find((entry) => entry.id === hostId);
				return { id: hostId, display_name: host?.display_name ?? title };
			}),
			host_name: person?.display_name ?? title
		};
	}

	function evaluateScheduleAt(
		hostIds,
		roomId,
		startRow,
		slotCount,
		day,
		daySchedules,
		ignoredIds,
		event = null
	) {
		const slotBlock = day.timeSlots.slice(startRow, startRow + slotCount);
		const slotIds = slotBlock.map((slot) => slot.id);

		if (slotBlock.length < slotCount) {
			return appearanceFromIssues(
				[{ severity: SEVERITY.ERROR, message: 'Brak wystarczającej liczby terminów tego dnia' }],
				1
			);
		}

		let worstTier = 1;
		for (const hostId of hostIds) {
			for (const slotId of slotIds) {
				worstTier = Math.max(worstTier, getAvailabilityTier(hostId, slotId));
			}
		}

		const preview = buildPreviewSchedule(hostIds, roomId, slotBlock[0].id, slotCount, event);
		const hypotheticalDaySchedules = [
			...daySchedules.filter((schedule) => !ignoredIds.has(schedule.id)),
			preview
		];
		const hypotheticalIssues = [];
		collectIssuesForDay(hypotheticalDaySchedules, day.timeSlots, hypotheticalIssues);
		const previewIssues = dedupeIssues(hypotheticalIssues).filter(
			(issue) => issue.scheduleId === PREVIEW_SCHEDULE_ID
		);

		return appearanceFromIssues(previewIssues, worstTier, { useAvailabilityFallback: true });
	}

	function getScheduleStartRow(schedule, day) {
		const slotIndex = hintIndexes.slotIndexByDate.get(day.date) ?? new Map();
		const startSlotId = getScheduleStartSlotId(schedule);
		return slotIndex.get(startSlotId) ?? day.timeSlots.findIndex((slot) => slot.id === startSlotId);
	}

	function getSwapPreviewAppearance(item, existing, day, daySchedules) {
		const dragged = item.schedule;
		const sourceDay = daySections.find((section) => section.date === dragged.start_slot?.date);
		const sourceDaySchedules = sourceDay ? (hintIndexes.daySchedules.get(sourceDay.date) ?? []) : [];
		const bStartRow = getScheduleStartRow(existing, day);
		const aStartRow = sourceDay ? getScheduleStartRow(dragged, sourceDay) : -1;
		if (!sourceDay || aStartRow < 0 || bStartRow < 0) {
			return appearanceFromIssues(
				[{ severity: SEVERITY.ERROR, message: 'Nie można ocenić obu stron zamiany' }],
				1
			);
		}

		const ignoredIds = new Set([item.id, existing.id]);
		const aHosts = new Set(dragged.hosts?.map((host) => host.id) ?? []);
		const bHosts = new Set(existing.hosts?.map((host) => host.id) ?? []);

		// Each event keeps its own duration at the swapped start slot, so the
		// dragged event is evaluated with its own slot_count (not the slot it is
		// landing in) and likewise for the existing event.
		const aAppearance = evaluateScheduleAt(
			aHosts,
			existing.room_id,
			bStartRow,
			dragged.slot_count,
			day,
			daySchedules,
			ignoredIds,
			dragged.event
		);
		const bAppearance = evaluateScheduleAt(
			bHosts,
			dragged.room_id,
			aStartRow,
			existing.slot_count,
			sourceDay,
			sourceDaySchedules,
			ignoredIds,
			existing.event
		);

		return mergePlacementHint(aAppearance, bAppearance);
	}

	function getDirectDropPlanAppearance(item, target) {
		const plan = buildDirectDropPlan(item, target);
		if (!plan) return null;

		const locked = findLockedSchedule(plan.moves.map((move) => move.schedule));
		if (locked) return lockedMoveAppearance(locked);

		const ignoredIds = new Set(plan.moves.map((move) => move.scheduleId));
		let result = null;

		for (const move of plan.moves) {
			const hostIds = new Set(move.schedule.hosts?.map((host) => host.id) ?? []);
			const daySchedules = hintIndexes.daySchedules.get(move.day.date) ?? [];
			const appearance = evaluateScheduleAt(
				hostIds,
				move.roomId,
				move.rowIdx,
				move.schedule.slot_count,
				move.day,
				daySchedules,
				ignoredIds,
				move.schedule.event
			);
			result = mergePlacementHint(result, appearance);
		}

		return result;
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
			ignoredIds,
			item.schedule.event
		);
	}

	function computePlacementHintsForItem(item) {
		const slotCount = item.schedule.slot_count;
		const rawCells = new Map();

		for (let dayIdx = 0; dayIdx < daySections.length; dayIdx++) {
			const day = daySections[dayIdx];
			const daySchedules = hintIndexes.daySchedules.get(day.date) ?? [];

			for (let colIdx = 0; colIdx < day.roomColumnItems.length; colIdx++) {
				const roomId = day.roomColumnItems[colIdx].room.id;
				const maxStartRow = Math.max(0, day.timeSlots.length - slotCount);

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

		return { cells, swaps: new Map() };
	}

	function rectCenter(rect) {
		return {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2
		};
	}

	function isVisibleRect(rect) {
		return (
			rect.width > 0 &&
			rect.height > 0 &&
			rect.bottom >= 0 &&
			rect.right >= 0 &&
			rect.top <= window.innerHeight &&
			rect.left <= window.innerWidth
		);
	}

	function getScheduleDropTarget(schedule) {
		const startSlotId = getScheduleStartSlotId(schedule);
		const slot = schedule.start_slot ?? hintIndexes.slotById.get(startSlotId);
		if (!slot) return null;
		const dayIdx = daySections.findIndex((day) => day.date === slot.date);
		if (dayIdx < 0) return null;
		const day = daySections[dayIdx];
		const colIdx = day.roomColumnItems.findIndex((col) => col.room.id === schedule.room_id);
		if (colIdx < 0) return null;
		const slotIndex = hintIndexes.slotIndexByDate.get(slot.date) ?? new Map();
		const rowIdx =
			slotIndex.get(startSlotId) ?? day.timeSlots.findIndex((entry) => entry.id === startSlotId);
		if (rowIdx < 0) return null;
		return {
			dayIdx,
			colIdx,
			rowIdx,
			roomId: schedule.room_id,
			startTimeSlotId: startSlotId
		};
	}

	function normalizeSwapAppearance(appearance) {
		if (appearance?.kind === 'info') {
			return {
				...OK_TILE_COLORS,
				kind: 'ok',
				messages: appearance.messages || []
			};
		}
		return appearance;
	}

	function computeSwapHintForSchedule(item, targetSchedule) {
		if (targetSchedule?.locked) return lockedMoveAppearance(targetSchedule);
		const target = getScheduleDropTarget(targetSchedule);
		if (!target) return PENDING_SWAP_COLORS;
		const day = daySections[target.dayIdx];
		const daySchedules = hintIndexes.daySchedules.get(day.date) ?? [];
		if (item.isUnscheduled) {
			return normalizeSwapAppearance(
				getFastPlacementAppearance(item, target, day, daySchedules, targetSchedule)
			);
		}
		return normalizeSwapAppearance(
			getDirectDropPlanAppearance(item, target) ??
				getSwapPreviewAppearance(item, targetSchedule, day, daySchedules)
		);
	}

	function collectSwapTargetSchedules(item) {
		return schedules.filter((schedule) => schedule.id !== item.id);
	}

	function collectVisibleSwapTargets(item) {
		const sourceEl = document.querySelector(`[data-schedule-id="${item.id}"]`);
		const sourceRect = sourceEl?.getBoundingClientRect();
		const sourceCenter = sourceRect && isVisibleRect(sourceRect) ? rectCenter(sourceRect) : null;
		const fallbackCenter = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
		const center = sourceCenter ?? fallbackCenter;
		const seen = new Set();
		return [...document.querySelectorAll('.sheet-event[data-schedule-id]')]
			.map((el) => {
				const id = el.getAttribute('data-schedule-id');
				if (!id || id === item.id || seen.has(id)) return null;
				seen.add(id);
				const schedule = schedules.find((entry) => entry.id === id);
				if (!schedule) return null;
				const rect = el.getBoundingClientRect();
				if (!isVisibleRect(rect)) return null;
				const targetCenter = rectCenter(rect);
				return {
					id,
					schedule,
					distance: Math.hypot(targetCenter.x - center.x, targetCenter.y - center.y)
				};
			})
			.filter(Boolean)
			.sort((a, b) => a.distance - b.distance);
	}

	function cancelProgressiveSwapWork() {
		if (progressiveSwapFrame !== null) {
			cancelAnimationFrame(progressiveSwapFrame);
			progressiveSwapFrame = null;
		}
		if (progressiveSwapScrollFrame !== null) {
			cancelAnimationFrame(progressiveSwapScrollFrame);
			progressiveSwapScrollFrame = null;
		}
		progressiveSwapItem = null;
		progressiveSwapQueue = [];
		progressiveQueuedSwapIds = new Set();
		progressiveComputedSwapIds = new Set();
	}

	function runProgressiveSwapBatch(item, token) {
		if (token !== hintComputeToken || item !== progressiveSwapItem) return;
		const nextSwaps = new Map(placementHints.swaps);
		const batchSize = 4;
		let processed = 0;

		while (progressiveSwapQueue.length > 0 && processed < batchSize) {
			const target = progressiveSwapQueue.shift();
			progressiveQueuedSwapIds.delete(target.id);
			if (progressiveComputedSwapIds.has(target.id)) continue;
			nextSwaps.set(target.id, computeSwapHintForSchedule(item, target.schedule));
			progressiveComputedSwapIds.add(target.id);
			processed++;
		}

		if (processed > 0) {
			placementHints = { ...placementHints, swaps: nextSwaps };
		}

		if (progressiveSwapQueue.length > 0) {
			progressiveSwapFrame = requestAnimationFrame(() => runProgressiveSwapBatch(item, token));
		} else {
			progressiveSwapFrame = null;
		}
	}

	function queueVisibleSwapTargets(item, token) {
		if (token !== hintComputeToken || item !== progressiveSwapItem) return;
		let queuedAny = false;

		for (const target of collectVisibleSwapTargets(item)) {
			if (progressiveComputedSwapIds.has(target.id) || progressiveQueuedSwapIds.has(target.id)) continue;
			progressiveSwapQueue.push(target);
			progressiveQueuedSwapIds.add(target.id);
			queuedAny = true;
		}

		if (queuedAny && progressiveSwapFrame === null) {
			progressiveSwapFrame = requestAnimationFrame(() => runProgressiveSwapBatch(item, token));
		}
	}

	function scheduleVisibleSwapTargetRefresh() {
		if (!progressiveSwapItem || progressiveSwapScrollFrame !== null) return;
		const item = progressiveSwapItem;
		const token = hintComputeToken;
		progressiveSwapScrollFrame = requestAnimationFrame(() => {
			progressiveSwapScrollFrame = null;
			queueVisibleSwapTargets(item, token);
		});
	}

	function startProgressiveSwapHints(item, token) {
		cancelProgressiveSwapWork();
		progressiveSwapItem = item;

		const targets = collectSwapTargetSchedules(item);
		if (targets.length === 0) {
			progressiveSwapItem = null;
			return;
		}
		const pendingSwaps = new Map(placementHints.swaps);
		for (const target of targets) pendingSwaps.set(target.id, PENDING_SWAP_COLORS);
		placementHints = { ...placementHints, swaps: pendingSwaps };

		queueVisibleSwapTargets(item, token);
	}

	function computeAndApplyHints(item) {
		hintComputeToken++;
		const result = computePlacementHintsForItem(item);
		placementHints = result;
		startProgressiveSwapHints(item, hintComputeToken);
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
		scheduleVisibleSwapTargetRefresh();
		if (!dragState?.moved || !pendingPreviewCoords) return;
		scheduleDropPreview(pendingPreviewCoords.clientX, pendingPreviewCoords.clientY);
	}

	$effect(() => {
		const scrollEl = sheetScrollEl;
		const shouldRefreshSelectedHints =
			Boolean(selectedSchedule || selectedUnscheduledEvent) && !dragState?.moved;
		if (!scrollEl || !shouldRefreshSelectedHints) return;

		scrollEl.addEventListener('scroll', scheduleVisibleSwapTargetRefresh, { passive: true });
		return () => scrollEl.removeEventListener('scroll', scheduleVisibleSwapTargetRefresh);
	});

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
		hintComputeToken++;
		cancelProgressiveSwapWork();
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
		const [roomsData, slotsData, schedulesData, unscheduledData, availData, peopleData, hoursData, undoData] =
			await Promise.all([
				getRooms(convention.id),
				getTimeSlots(convention.id),
				isPeopleMode ? getPeopleSchedules(convention.id) : getSchedules(convention.id),
				isPeopleMode ? Promise.resolve([]) : getUnscheduledEvents(convention.id),
				getAvailability(convention.id),
				getPeople(convention.id),
				getPersonHours(convention.id),
				getUndoHistory(convention.id)
			]);
		rooms = roomsData;
		timeSlots = slotsData;
		schedules = schedulesData;
		unscheduled = unscheduledData;
		availability = availData;
		people = peopleData;
		personHours = hoursData;
		undoHistory = undoData;
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

		if (highlightedIssueScheduleIds.size > 0) {
			const existingIds = new Set(schedules.map((schedule) => schedule.id));
			const remainingIds = [...highlightedIssueScheduleIds].filter((id) => existingIds.has(id));
			if (remainingIds.length === 0) {
				clearIssueFocus();
			} else {
				highlightedIssueScheduleIds = new Set(remainingIds);
				const focusContext = buildIssueFocusContext(remainingIds);
				highlightedIssueRoomId = focusContext.roomId;
				highlightedIssueSlotIds = focusContext.slotIds;
			}
		}

		if (
			chainSwap.sourceScheduleId &&
			!schedules.some((schedule) => schedule.id === chainSwap.sourceScheduleId)
		) {
			resetChainSwap();
		}
	}

	function openEventPanel(schedule, anchorEl) {
		clearAllHighlights();
		selectedUnscheduledEvent = null;
		selectedSchedule = schedule;
		panelAnchorRect = anchorEl.getBoundingClientRect();
	}

	function openUnscheduledPanel(event, anchorEl) {
		clearAllHighlights();
		selectedSchedule = null;
		selectedUnscheduledEvent = event;
		panelAnchorRect = anchorEl.getBoundingClientRect();
	}

	function closeEventPanel(options = {}) {
		if (options.clearHints !== false) clearPlacementHints();
		selectedSchedule = null;
		selectedUnscheduledEvent = null;
		panelAnchorRect = null;
	}

	function clearPlacementHints() {
		hintComputeToken++;
		cancelProgressiveSwapWork();
		placementHints = { cells: new Map(), swaps: new Map() };
	}

	function clearAllHighlights() {
		clearPlacementHints();
		selectedSlot = null;
		clearIssueFocus();
	}

	// Drops the "check availability" selection: clears the highlighted tile, the
	// placement hints painted across the grid, and any open detail panel.
	function clearSelectionHighlight() {
		clearAllHighlights();
		closeEventPanel({ clearHints: false });
	}

	function handleOutsideSelectionClick(event) {
		// A click that ends a drag is consumed by blockNextClick; don't treat it as
		// an outside click that cancels the selection.
		if (blockNextClick || dragState?.moved) {
			blockNextClick = false;
			return;
		}
		// Clicks on a tile/sidebar item are handled by their own click handlers
		// (which stop propagation); panel clicks must not dismiss the panel.
		if (event.target.closest?.('.sheet-event, .sheet-sidebar-item, .event-panel')) return;
		clearSelectionHighlight();
	}

	// While a person/event is selected for availability checking, a click anywhere
	// else cancels it. The tile/sidebar click handlers call stopPropagation, so
	// this only ever fires for clicks outside the selected item.
	$effect(() => {
		if (!selectedSchedule && !selectedUnscheduledEvent) return;
		window.addEventListener('click', handleOutsideSelectionClick);
		return () => window.removeEventListener('click', handleOutsideSelectionClick);
	});

	function handleIssueFocusOutsideClick(event) {
		if (!issueFocusActive) return;
		if (blockNextClick || dragState?.moved) {
			blockNextClick = false;
			return;
		}
		// Interactive targets handle dismiss themselves and stop propagation.
		if (
			event.target.closest?.(
				'.sheet-issue, .sheet-event, .sheet-sidebar-item, .sheet-row-label, .sheet-col-header'
			)
		) {
			return;
		}
		clearIssueFocus();
	}

	$effect(() => {
		if (!issueFocusActive) return;
		window.addEventListener('click', handleIssueFocusOutsideClick);
		return () => window.removeEventListener('click', handleIssueFocusOutsideClick);
	});

	function resetChainSwap() {
		chainSwap = {
			mode: 'idle',
			sourceScheduleId: null,
			targetScheduleId: null,
			options: [],
			previewOption: null,
			computing: false,
			applying: false,
			timedOut: false,
			error: ''
		};
	}

	function retryChainSwapSelection() {
		chainSwap = {
			...chainSwap,
			mode: 'selecting',
			targetScheduleId: null,
			options: [],
			previewOption: null,
			computing: false,
			error: ''
		};
	}

	function startChainSwapSelection(schedule) {
		if (!schedule) return;
		if (schedule.locked) {
			toast.error('Pozycja zablokowana', {
				description: lockedMoveMessage(schedule)
			});
			return;
		}
		clearActiveDragState();
		closeEventPanel();
		chainSwap = {
			mode: 'selecting',
			sourceScheduleId: schedule.id,
			targetScheduleId: null,
			options: [],
			previewOption: null,
			computing: false,
			applying: false,
			timedOut: false,
			error: ''
		};
	}

	function previewChainSwapOption(option) {
		if (!option) return;
		chainSwap = { ...chainSwap, mode: 'preview', previewOption: option };
	}

	function cancelChainSwapPreview() {
		chainSwap = { ...chainSwap, mode: 'results', previewOption: null };
	}

	async function computeChainSwapForTarget(targetSchedule) {
		const sourceSchedule = schedules.find((schedule) => schedule.id === chainSwap.sourceScheduleId);
		if (!sourceSchedule || !targetSchedule || sourceSchedule.id === targetSchedule.id) return;

		chainSwap = {
			...chainSwap,
			mode: 'planning',
			targetScheduleId: targetSchedule.id,
			options: [],
			computing: true,
			error: ''
		};
		await flushUi();

		try {
			const { options, timedOut, sourceFits, lockedSchedule } = findChainSwapOptions(
				sourceSchedule,
				targetSchedule
			);
			let error = '';
			if (lockedSchedule) {
				error = `${lockedMoveMessage(lockedSchedule)} Ta sekwencja wymagałaby ruszenia zablokowanej atrakcji, więc nie można jej wykonać.`;
			} else if (!sourceFits) {
				error =
					'Ta atrakcja nie może stać w wybranym miejscu (sala lub dostępność prowadzącego). Żadna sekwencja nie pomoże.';
			} else if (options.length === 0) {
				error = timedOut
					? 'Przerwano szukanie (limit czasu) — nie znaleziono poprawnej sekwencji ruchów. Spróbuj bliższego miejsca.'
					: 'Nie znaleziono poprawnej sekwencji ruchów dla tego miejsca.';
			}
			chainSwap = {
				...chainSwap,
				mode: 'results',
				options,
				computing: false,
				timedOut,
				error
			};
		} catch (error) {
			chainSwap = {
				...chainSwap,
				mode: 'results',
				options: [],
				computing: false,
				error: error.message
			};
		}
	}

	async function applyChainSwapOption(option) {
		if (!option || chainSwap.applying) return;
		const lockedMove = option.moves
			.map((move) => schedules.find((schedule) => schedule.id === move.scheduleId))
			.find((schedule) => schedule?.locked);
		if (lockedMove) {
			toast.error('Nie można zastosować zamiany', {
				description: lockedMoveMessage(lockedMove)
			});
			chainSwap = {
				...chainSwap,
				mode: 'results',
				previewOption: null,
				error: `${lockedMoveMessage(lockedMove)} Ta sekwencja wymagałaby ruszenia zablokowanej atrakcji.`
			};
			return;
		}
		chainSwap = { ...chainSwap, applying: true };
		try {
			if (isPeopleMode) {
				await movePeopleSchedules(
					option.moves.map((move) => ({
						scheduleId: move.scheduleId,
						room_id: move.to.room_id,
						time_slot_id: move.to.start_time_slot_id
					}))
				);
			} else {
				for (const move of option.moves) {
					await updateSchedule(move.scheduleId, {
						room_id: move.to.room_id,
						start_time_slot_id: move.to.start_time_slot_id
					});
				}
			}
			toast.success('Zastosowano sekwencję zamian', {
				description: `${option.moves.length} ruchów`
			});
			resetChainSwap();
			await loadSchedule();
		} catch (error) {
			chainSwap = { ...chainSwap, applying: false };
			toast.error('Błąd zamiany', { description: error.message });
		}
	}

	function handleUnscheduledClick(event, unscheduledEvent, anchorEl) {
		if (blockNextClick || dragState?.moved) {
			blockNextClick = false;
			return;
		}
		event.stopPropagation();
		if (dismissIssueFocusOnClick(event)) return;
		selectedSchedule = null;
		selectedUnscheduledEvent = unscheduledEvent;
		computeAndApplyHints(makeUnscheduledDragItem(unscheduledEvent));
	}

	function handleUnscheduledDoubleClick(event, unscheduledEvent, anchorEl) {
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
		if (chainSwap.mode === 'selecting') {
			if (schedule.id === chainSwap.sourceScheduleId) {
				toast.error('Wybierz inny wpis jako docelowe miejsce');
				return;
			}
			computeChainSwapForTarget(schedule);
			return;
		}
		// While planning / previewing chain swaps the grid is read-only.
		if (chainSwap.mode !== 'idle') return;
		if (dismissIssueFocusOnClick(event)) return;
		selectedSchedule = schedule;
		selectedUnscheduledEvent = null;
		computeAndApplyHints({ id: schedule.id, schedule });
	}

	function handleEventDoubleClick(event, schedule, anchorEl) {
		if (blockNextClick || dragState?.moved) {
			blockNextClick = false;
			return;
		}
		event.stopPropagation();
		if (chainSwap.mode !== 'idle') return;
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

	function findOccupyingSchedules(roomId, startRowIdx, slotCount, daySchedules, dayTimeSlots, excludeId) {
		const targetEnd = startRowIdx + slotCount - 1;
		const slotIndex = hintIndexes.slotIndexByDate.get(dayTimeSlots[0]?.date) ?? new Map();
		return daySchedules
			.map((schedule) => ({
				schedule,
				startIdx:
					slotIndex.get(getScheduleStartSlotId(schedule)) ??
					dayTimeSlots.findIndex((ts) => ts.id === getScheduleStartSlotId(schedule))
			}))
			.filter(({ schedule, startIdx }) => {
				if (schedule.id === excludeId || schedule.room_id !== roomId || startIdx < 0) return false;
				const endIdx = startIdx + schedule.slot_count - 1;
				return !(endIdx < startRowIdx || startIdx > targetEnd);
			})
			.sort((a, b) => a.startIdx - b.startIdx)
			.map(({ schedule }) => schedule);
	}

	function findOccupyingSchedule(roomId, startRowIdx, slotCount, daySchedules, dayTimeSlots, excludeId) {
		return findOccupyingSchedules(
			roomId,
			startRowIdx,
			slotCount,
			daySchedules,
			dayTimeSlots,
			excludeId
		)[0];
	}

	async function commitDrop(item, targetDayIdx, target) {
		if (!target?.startTimeSlotId) return;

		const schedule = item.schedule;
		const plan = buildDirectDropPlan(item, target);
		const commitTarget = plan?.target ?? target;
		const day = daySections[commitTarget.dayIdx ?? targetDayIdx];
		const daySchedules = hintIndexes.daySchedules.get(day.date) ?? [];

		if (item.isUnscheduled) {
			if (isPeopleMode) {
				await createPeopleSchedule({
					person_id: item.personId,
					room_id: commitTarget.roomId,
					time_slot_id: commitTarget.startTimeSlotId
				});
			} else {
				const existing = findOccupyingSchedules(
					commitTarget.roomId,
					commitTarget.rowIdx,
					schedule.slot_count,
					daySchedules,
					day.timeSlots,
					null
				);

				for (const schedule of existing) {
					await deleteSchedule(schedule.id);
				}

				await createSchedule({
					event_id: item.eventId,
					room_id: commitTarget.roomId,
					start_time_slot_id: commitTarget.startTimeSlotId,
					slot_count: schedule.slot_count
				});
			}
			return;
		}

		const samePlace =
			schedule.room_id === commitTarget.roomId &&
			getScheduleStartSlotId(schedule) === commitTarget.startTimeSlotId;
		if (samePlace) return;

		const dropAppearance = getDropPreviewAppearance(item, commitTarget);
		if (dropAppearance.kind === 'error') {
			toast.error('Nie można przenieść', {
				description: dropAppearance.messages?.[0] ?? 'To miejsce łamie wymagania grafiku'
			});
			return;
		}

		if (plan) {
			if (isPeopleMode) {
				// People schedules live in a separate table and reject moving onto an
				// occupied cell, so a swap (dragged item + one displaced item) has to be
				// applied atomically; a plain move targets an empty cell.
				const [primary, ...displaced] = plan.moves;
				if (displaced.length === 1) {
					await swapPeopleSchedules(primary.scheduleId, displaced[0].scheduleId);
				} else {
					await updatePeopleSchedule(primary.scheduleId, {
						room_id: primary.roomId,
						time_slot_id: primary.startTimeSlotId
					});
				}
				return;
			}
			for (const move of plan.moves) {
				await updateSchedule(move.scheduleId, {
					room_id: move.roomId,
					start_time_slot_id: move.startTimeSlotId
				});
			}
			return;
		}

		if (isPeopleMode) {
			await updatePeopleSchedule(item.id, {
				room_id: commitTarget.roomId,
				time_slot_id: commitTarget.startTimeSlotId
			});
		} else {
			await updateSchedule(item.id, {
				room_id: commitTarget.roomId,
				start_time_slot_id: commitTarget.startTimeSlotId
			});
		}
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
		if (chainSwap.mode !== 'idle') return;
		beginDrag(event, item);
	}

	function startEventDrag(event, item, dayIdx, colIdx) {
		if (chainSwap.mode !== 'idle') return;
		if (item.schedule.locked) {
			toast.error('Pozycja zablokowana', {
				description: lockedMoveMessage(item.schedule)
			});
			return;
		}
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
			if (isPeopleMode) {
				await deletePeopleSchedule(scheduleId);
			} else {
				await deleteSchedule(scheduleId);
			}
			toast.success('Usunięto z grafiku');
			await loadSchedule();
		} catch (error) {
			toast.error('Błąd usuwania', { description: error.message });
		}
	}

	async function handleAutoScheduleAll() {
		const total = autoSchedulableCount;
		if (total === 0) return;

		autoScheduling = true;
		autoScheduleProgress = { current: 0, total, phase: 'Przeliczam grafik…' };
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

			toast.success('Grafik ułożony', {
				description: `${result.successes.length} zaplanowano, ${result.errors.length} nie udało się zaplanować`
			});
		} catch (error) {
			toast.error('Nie udało się ułożyć grafiku', { description: error.message });
		} finally {
			autoScheduling = false;
			autoScheduleProgress = { current: 0, total: 0, phase: '' };
		}
	}

	async function handleClearSchedule() {
		if (!convention || schedules.length === 0) return;
		if (
			!confirm(
				`Usunąć wszystkie ${schedules.length} ${isPeopleMode ? 'wpisy osób' : 'atrakcje'} z grafiku?`
			)
		) {
			return;
		}
		try {
			const { removed } = await clearAllSchedules(convention.id);
			closeEventPanel();
			toast.success('Grafik wyczyszczony', {
				description: `${removed} wpisów usunięto z grafiku`
			});
			await loadSchedule();
		} catch (error) {
			toast.error('Błąd czyszczenia grafiku', { description: error.message });
		}
	}

	async function handleUndo(count = 1) {
		if (!convention || undoHistory.length === 0) return;
		try {
			const result = await undoLastActions(convention.id, count);
			toast.success('Cofnięto zmiany', { description: `${result.undone} akcji` });
			closeEventPanel();
			await loadSchedule();
		} catch (error) {
			toast.error('Nie udało się cofnąć', { description: error.message });
		}
	}
</script>

<svelte:window onkeydown={handleGridKeydown} />

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
					{isPeopleMode ? 'Grafik osób' : 'Grafik atrakcji'} · {daySections.length} {daySections.length === 1 ? 'dzień' : 'dni'} · {schedules.length} {isPeopleMode ? 'wpisów' : 'atrakcji w planie'} · {isPeopleMode ? `${people.length} osób` : `${unscheduled.length} do zaplanowania`}
				</span>
			</div>
			<div class="sheet-toolbar-right">
				<button
					class="sheet-btn"
					onclick={() => handleUndo(1)}
					disabled={autoScheduling || undoHistory.length === 0}
					title={undoHistory[0]?.label || 'Brak akcji do cofnięcia'}
				>
					Cofnij
				</button>
				<button
					class="sheet-btn"
					onclick={handleClearSchedule}
					disabled={autoScheduling || schedules.length === 0}
				>
					Wyczyść grafik
				</button>
				<button class="sheet-btn sheet-btn--primary" onclick={handleAutoScheduleAll} disabled={autoScheduling || autoSchedulableCount === 0}>
					{autoScheduling ? 'Układam…' : 'Ułóż automatycznie'}
				</button>
			</div>
		</header>

		{#if issueSummary.length > 0}
			<div class="sheet-issues">
				<div class="sheet-issues-bar">
					{#if errorCount > 0}
						<button
							type="button"
							class="badge badge--toggle badge--error"
							class:badge--off={!showErrorIssues}
							onclick={() => (showErrorIssues = !showErrorIssues)}
							aria-pressed={showErrorIssues}
							title={showErrorIssues ? 'Ukryj błędy' : 'Pokaż błędy'}
						>
							{errorCount} błędów
						</button>
					{/if}
					{#if warningCount > 0}
						<button
							type="button"
							class="badge badge--toggle badge--warning"
							class:badge--off={!showWarningIssues}
							onclick={() => (showWarningIssues = !showWarningIssues)}
							aria-pressed={showWarningIssues}
							title={showWarningIssues ? 'Ukryj ostrzeżenia' : 'Pokaż ostrzeżenia'}
						>
							{warningCount} ostrzeżeń
						</button>
					{/if}
					{#if infoCount > 0}
						<button
							type="button"
							class="badge badge--toggle badge--info"
							class:badge--off={!showInfoIssues}
							onclick={() => (showInfoIssues = !showInfoIssues)}
							aria-pressed={showInfoIssues}
							title={showInfoIssues ? 'Ukryj informacje' : 'Pokaż informacje'}
						>
							{infoCount} informacji
						</button>
					{/if}
					{#if showIssuesPanel}
						{#each visibleIssues as issue}
							<button
								type="button"
								class="sheet-issue sheet-issue--{issue.severity}"
								class:sheet-issue--clickable={issue.scheduleIds?.length > 0}
								class:sheet-issue--active={highlightedIssueKey === issue.key}
								class:sheet-issue--active-error={highlightedIssueKey === issue.key &&
									issue.severity === 'error'}
								class:sheet-issue--active-warning={highlightedIssueKey === issue.key &&
									issue.severity === 'warning'}
								class:sheet-issue--active-info={highlightedIssueKey === issue.key &&
									issue.severity === 'info'}
								disabled={!issue.scheduleIds?.length}
								title={issue.scheduleIds?.length
									? 'Kliknij, aby podświetlić wpis w grafiku'
									: undefined}
								onclick={(event) => highlightIssueSchedules(event, issue)}
							>
								<span>{issue.severity === 'error' ? '✕' : issue.severity === 'warning' ? '⚠' : 'ℹ'}</span>
								<span>{issue.message}</span>
							</button>
						{/each}
					{/if}
					<button
						class="sheet-issues-toggle"
						onclick={() => (showIssuesPanel = !showIssuesPanel)}
						aria-expanded={showIssuesPanel}
						title={showIssuesPanel ? 'Zwiń listę' : 'Rozwiń listę'}
					>
						{showIssuesPanel ? '▼' : '▶'}
					</button>
				</div>
			</div>
		{/if}

		{#if chainSwap.mode === 'selecting' && chainSwapSource}
			<div class="chain-swap-banner">
				<div>
					<strong>Zamiana miejsc:</strong>
					<span> „{chainSwapSource.event.title}" jest zaznaczone. Kliknij wpis, na którego miejsce chcesz je przenieść.</span>
				</div>
				<button type="button" class="chain-swap-banner-btn" onclick={resetChainSwap}>Anuluj</button>
			</div>
		{:else if chainSwap.computing && chainSwapSource && chainSwapTarget}
			<div class="chain-swap-banner">
				<div>
					<strong>Szukam sposobu na zamianę…</strong>
					<span> „{chainSwapSource.event.title}" → miejsce „{chainSwapTarget.event.title}"</span>
				</div>
			</div>
		{/if}

		{#if isPeopleMode && selectedSlot?.slot?.id}
			<div class="highlight-banner">
				<div>
					<strong>Podświetlanie dostępności:</strong>
					<span>
						{formatTime(selectedSlot.slot.start_time)}
						{#if selectedHighlightRoom}
							· {selectedHighlightRoom.name}
						{:else}
							· najlepsze stanowisko (kliknij stanowisko, aby zawęzić)
						{/if}
					</span>
				</div>
				<button
					type="button"
					class="chain-swap-banner-btn"
					onclick={() => (selectedSlot = null)}
				>
					Wyłącz
				</button>
			</div>
		{/if}

		<div class="sheet-body">
			<div class="sheet-scroll" bind:this={sheetScrollEl}>
				{#if daySections.length === 0}
					<div class="sheet-empty">Brak terminów w grafiku</div>
				{:else}
					{#each daySections as day, dayIdx (day.date)}
						<section class="sheet-day-section">
							<h2 class="sheet-day-header">{formatDate(day.date)}</h2>
							<div
								class="sheet-grid"
								style="
									--time-w: {TIME_COL_WIDTH}px;
									--room-w: {roomColumnWidth}px;
									--slot-h: {SLOT_HEIGHT}px;
									grid-template-columns: var(--time-w) repeat({rooms.length}, var(--room-w));
									grid-template-rows: minmax(48px, auto) repeat({day.timeSlots.length}, var(--slot-h));
								"
							>
								<div class="sheet-corner"></div>

								{#each rooms as room, idx}
									{@const roomClickable = isPeopleMode && !!selectedSlot?.slot?.id}
									<button
										type="button"
										class="sheet-col-header"
										class:sheet-col-header--clickable={roomClickable}
										class:sheet-col-header--selected={selectedSlot?.roomId === room.id}
										class:sheet-col-header--issue-focus={issueFocusActive &&
											highlightedIssueRoomId === room.id}
										class:sheet-col-header--issue-focus-error={issueFocusActive &&
											highlightedIssueRoomId === room.id &&
											highlightedIssueSeverity === 'error'}
										class:sheet-col-header--issue-focus-warning={issueFocusActive &&
											highlightedIssueRoomId === room.id &&
											highlightedIssueSeverity === 'warning'}
										class:sheet-col-header--issue-focus-info={issueFocusActive &&
											highlightedIssueRoomId === room.id &&
											highlightedIssueSeverity === 'info'}
										style="grid-column: {idx + 2}; grid-row: 1"
										disabled={!roomClickable}
										title={roomClickable
											? selectedSlot?.roomId === room.id
												? 'Kliknij ponownie, aby pokazać najlepsze stanowisko'
												: 'Kliknij, aby podświetlić dostępność dla tego stanowiska'
											: undefined}
										onclick={(event) => handleRoomHighlightClick(room, event)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												handleRoomHighlightClick(room, e);
											}
										}}
									>
										<span class="sheet-col-header-name">{formatRoomHeaderName(room)}</span>
										<div class="sheet-col-header-tags">
											{#each getRoomHeaderTags(room) as tag (tag)}
												<span class="sheet-col-header-tag">{formatRoomTagLabel(tag)}</span>
											{:else}
												<span class="sheet-col-header-tag sheet-col-header-tag--empty">Brak tagów</span>
											{/each}
										</div>
									</button>
								{/each}

								{#each day.timeSlots as slot, rowIdx}
									<button
										type="button"
										class="sheet-row-label {isPeopleMode ? '' : `sheet-row-label--tier${slotHypeTier(slot)}`}"
										class:sheet-row-label--hour={isHourStart(slot.start_time)}
										class:sheet-row-label--selected={selectedSlot?.slot?.id === slot.id}
										class:sheet-row-label--issue-focus={issueFocusActive &&
											highlightedIssueSlotIds.has(slot.id)}
										class:sheet-row-label--issue-focus-error={issueFocusActive &&
											highlightedIssueSlotIds.has(slot.id) &&
											highlightedIssueSeverity === 'error'}
										class:sheet-row-label--issue-focus-warning={issueFocusActive &&
											highlightedIssueSlotIds.has(slot.id) &&
											highlightedIssueSeverity === 'warning'}
										class:sheet-row-label--issue-focus-info={issueFocusActive &&
											highlightedIssueSlotIds.has(slot.id) &&
											highlightedIssueSeverity === 'info'}
										style="grid-column: 1; grid-row: {rowIdx + 2}"
										title={isPeopleMode
											? selectedSlot?.slot?.id === slot.id
												? 'Kliknij ponownie, aby wyłączyć podświetlanie'
												: 'Kliknij, aby podświetlić dostępność w tej godzinie'
											: `Popularność slotu: T${slotHypeTier(slot)}`}
										disabled={!isPeopleMode}
										onclick={(event) => handleSlotClick(slot, event)}
									>
										{formatTime(slot.start_time)}
									</button>

									{#each rooms as _room, colIdx}
										{@const issueCellFocused =
											issueFocusActive &&
											highlightedIssueRoomId === rooms[colIdx].id &&
											highlightedIssueSlotIds.has(slot.id)}
										{@const cellHint = getCellHintData(dayIdx, colIdx, rowIdx)}
										<div
											class="sheet-cell"
											class:sheet-cell--hour={isHourStart(slot.start_time)}
											class:sheet-cell--issue-focus={issueCellFocused}
											class:sheet-cell--issue-focus-error={issueCellFocused &&
												highlightedIssueSeverity === 'error'}
											class:sheet-cell--issue-focus-warning={issueCellFocused &&
												highlightedIssueSeverity === 'warning'}
											class:sheet-cell--issue-focus-info={issueCellFocused &&
												highlightedIssueSeverity === 'info'}
											class:sheet-cell--hint={cellHint}
											class:sheet-cell--hint-error={cellHint?.kind === 'error'}
											class:sheet-cell--hint-warning={cellHint?.kind === 'warning'}
											class:sheet-cell--hint-info={cellHint?.kind === 'info'}
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
												class:sheet-drop-preview--info={dropPreview.appearance.kind === 'info'}
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
										{#if chainPreviewActive}
											{#each chainPreviewGhostsByCol.get(`${dayIdx}-${colIdx}`) ?? [] as ghost}
												<div
													class="chain-preview-ghost"
													style="
														top: {ghost.rowIdx * SLOT_HEIGHT + 1}px;
														height: {getSlotTileHeight(ghost.slotCount)}px;
													"
													title="{ghost.title} — z {ghost.fromLabel}"
												>
													<span class="chain-preview-ghost-order">{ghost.order}</span>
													<span class="chain-preview-ghost-title">{ghost.title}</span>
													<span class="chain-preview-ghost-from">z: {ghost.fromLabel}</span>
												</div>
											{/each}
										{/if}
										{#each col.items as item (item.id)}
											{@const appearance = getTileAppearance(item.id)}
											{@const swapHint =
												activeHintItem && activeHintItem.id !== item.id
													? placementHints.swaps.get(item.id)
													: null}
											{@const edgeAppearance = swapHint ?? appearance}
											{@const showDragEdge = Boolean(swapHint && activeDropEdgeIds.has(item.id))}
											<div
												class="sheet-event"
												class:sheet-event--error={appearance.kind === 'error'}
												class:sheet-event--warning={appearance.kind === 'warning'}
												class:sheet-event--info={appearance.kind === 'info'}
												class:sheet-event--selected={selectedSchedule?.id === item.id}
												class:sheet-event--issue-dimmed={issueFocusActive &&
													!highlightedIssueScheduleIds.has(item.id)}
												class:sheet-event--issue-focus={highlightedIssueScheduleIds.has(item.id)}
												class:sheet-event--issue-focus-error={highlightedIssueScheduleIds.has(item.id) &&
													highlightedIssueSeverity === 'error'}
												class:sheet-event--issue-focus-warning={highlightedIssueScheduleIds.has(
													item.id
												) && highlightedIssueSeverity === 'warning'}
												class:sheet-event--issue-focus-info={highlightedIssueScheduleIds.has(item.id) &&
													highlightedIssueSeverity === 'info'}
												class:sheet-event--locked={item.schedule.locked}
												class:sheet-event--chain-source={chainSwap.sourceScheduleId === item.id}
												class:sheet-event--chain-target={chainSwap.targetScheduleId === item.id}
												class:sheet-event--chain-selectable={chainSwap.mode === 'selecting' &&
													chainSwap.sourceScheduleId !== item.id}
												class:sheet-event--chain-moving={chainPreviewActive &&
													chainPreviewMovingIds.has(item.id)}
												class:sheet-event--chain-dimmed={chainPreviewActive &&
													!chainPreviewMovingIds.has(item.id)}
												class:sheet-event--dragging={dragState?.item?.id === item.id && dragState?.moved}
												class:sheet-event--search-match={searchMatchScheduleIds?.has(item.id)}
												class:sheet-event--search-dimmed={searchMatchScheduleIds &&
													!searchMatchScheduleIds.has(item.id)}
												class:sheet-event--drop-candidate={Boolean(swapHint)}
												class:sheet-event--drag-edge={showDragEdge}
												class:sheet-event--drag-edge-error={showDragEdge && edgeAppearance.kind === 'error'}
												class:sheet-event--drag-edge-warning={showDragEdge && edgeAppearance.kind === 'warning'}
												class:sheet-event--drag-edge-info={showDragEdge && edgeAppearance.kind === 'info'}
												class:sheet-event--drag-edge-ok={showDragEdge && edgeAppearance.kind === 'ok'}
												class:sheet-event--drop-candidate-pending={swapHint?.kind === 'pending'}
												style="
													top: {item.rowIdx * SLOT_HEIGHT + 1}px;
													height: {getSlotTileHeight(item.schedule.slot_count)}px;
													max-height: {getSlotTileHeight(item.schedule.slot_count)}px;
													--title-lines: {getMaxTitleLines(item.schedule.slot_count)};
													--ev-bg: {appearance.bg};
													--ev-border: {appearance.border};
													--ev-text: {appearance.text};
													--ev-edge: {edgeAppearance.border};
													--ev-edge-bg: {edgeAppearance.bg};
												"
												title="{showDragEdge && swapHint?.messages?.length
													? swapHint.messages.join(' · ')
													: appearance.messages.length
														? appearance.messages.join(' · ')
														: `${item.schedule.event.title} — ${hostLabel(item.schedule)}`}"
												onpointerdown={(event) => startEventDrag(event, item, dayIdx, colIdx)}
												onclick={(event) => handleEventClick(event, item.schedule, event.currentTarget)}
												ondblclick={(event) => handleEventDoubleClick(event, item.schedule, event.currentTarget)}
												onkeydown={(event) => {
													if (event.key === 'Enter') handleEventDoubleClick(event, item.schedule, event.currentTarget);
													if (event.key === ' ') handleEventClick(event, item.schedule, event.currentTarget);
												}}
												oncontextmenu={(e) => {
													e.preventDefault();
													handleDeleteSchedule(item.id);
												}}
												role="button"
												tabindex="0"
												data-schedule-id={item.id}
											>
												<div class="sheet-event-meta">
													<span class="sheet-event-time">
														{formatTime(item.schedule.start_slot?.start_time)}–{getEndTime(item.schedule)}
													</span>
													{#if item.schedule.locked}
														<span class="sheet-event-meta-icon sheet-event-meta-icon--locked" aria-label="Zablokowana pozycja">
															<Lock size={12} strokeWidth={2.4} />
														</span>
													{/if}
													{#if !isPeopleMode}
														<span class="sheet-event-host">{hostLabel(item.schedule)}</span>
													{/if}
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
													{:else if appearance.kind === 'info'}
														<span class="sheet-event-meta-icon sheet-event-meta-icon--info" aria-label="Informacja">
															ℹ
														</span>
													{/if}
												</div>
												<div class="sheet-event-title"><span>{item.schedule.event.title}</span></div>
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
					<span>{isPeopleMode ? 'Osoby' : 'Do zaplanowania'}</span>
					<div class="sheet-sidebar-header-actions">
						{#if !isPeopleMode}
						<button
							type="button"
							class="sheet-sidebar-sort"
							class:sheet-sidebar-sort--active={unscheduledSort !== 'none'}
							title={unscheduledSortTitle}
							onclick={cycleUnscheduledSort}
						>
							<ArrowUpDown size={13} />
							{#if unscheduledSort === 'asc'}
								<span>T↑</span>
							{:else if unscheduledSort === 'desc'}
								<span>T↓</span>
							{/if}
						</button>
						{/if}
						<span class="sheet-sidebar-count">
							{displayedUnscheduled.length}{sidebarSearchTerm ? ` / ${sidebarTotalCount}` : ''}
						</span>
					</div>
				</div>
				<div class="sheet-sidebar-search">
					<Search size={14} strokeWidth={2.25} aria-hidden="true" />
					<label class="sr-only" for="schedule-sidebar-search">
						{isPeopleMode ? 'Szukaj osob' : 'Szukaj atrakcji'}
					</label>
					<input
						id="schedule-sidebar-search"
						class="sheet-sidebar-search-input"
						type="search"
						placeholder={isPeopleMode ? 'Szukaj osob...' : 'Szukaj atrakcji...'}
						bind:value={sidebarSearch}
						autocomplete="off"
					/>
					{#if sidebarSearch}
						<button
							type="button"
							class="sheet-sidebar-search-clear"
							aria-label="Wyczysc wyszukiwanie"
							onclick={() => (sidebarSearch = '')}
						>
							<X size={13} strokeWidth={2.5} aria-hidden="true" />
						</button>
					{/if}
				</div>
				<div class="sheet-sidebar-list">
					{#each displayedUnscheduled as event}
						{@const dragItem = makeUnscheduledDragItem(event)}
						{@const selectedFit = selectedSlotFits.get(event.id) ?? null}
						<div
							class="sheet-sidebar-item"
							class:sheet-sidebar-item--dragging={dragState?.item?.id === dragItem.id && dragState?.moved}
							class:sheet-sidebar-item--slot-ok={selectedFit?.tier === 1}
							class:sheet-sidebar-item--slot-warn={selectedFit?.appearance?.kind === 'warning'}
							class:sheet-sidebar-item--slot-info={selectedFit?.appearance?.kind === 'info'}
							class:sheet-sidebar-item--slot-no={selectedFit?.tier === 3}
							title={selectedFit
								? `${selectedFit.room?.name ?? 'Stanowisko'}: ${selectedFit.appearance.messages?.[0] ?? 'OK'}`
								: ''}
							onpointerdown={(e) => startUnscheduledDrag(e, dragItem)}
							onclick={(e) => handleUnscheduledClick(e, event, e.currentTarget)}
							ondblclick={(e) => handleUnscheduledDoubleClick(e, event, e.currentTarget)}
							onkeydown={(e) => {
								if (e.key === 'Enter') handleUnscheduledDoubleClick(e, event, e.currentTarget);
								if (e.key === ' ') handleUnscheduledClick(e, event, e.currentTarget);
							}}
							role="button"
							tabindex="0"
						>
							<span class="sheet-sidebar-item-title">{event.title}</span>
							<span class="sheet-sidebar-item-meta">
								{#if isPeopleMode}
									{event.hours?.total_hours ?? 0} h · {event.hours?.schedule_count ?? 0} slotów
									{#if event.hours?.min_blocks != null || event.hours?.max_blocks != null}
										· cel {event.hours?.min_blocks ?? '—'}–{event.hours?.max_blocks ?? '—'}
									{/if}
								{:else}
									{hostLabel(event)} · {event.duration_minutes} min · T{event.tier ?? 2}
									{#if event.auto_schedule === 0}
										· ręcznie
									{/if}
								{/if}
							</span>
						</div>
					{/each}
					{#if displayedUnscheduled.length === 0}
						<div class="sheet-sidebar-empty">
							{sidebarSearchTerm
								? 'Brak wynikow'
								: isPeopleMode
									? 'Brak osob'
									: 'Wszystko zaplanowane'}
						</div>
					{/if}
				</div>
			</aside>
		</div>

		<footer class="sheet-footer">
			<div class="sheet-legend">
				<span class="sheet-legend-chip" style="background:{OK_TILE_COLORS.bg}; border-color:{OK_TILE_COLORS.border}; color:{OK_TILE_COLORS.text}">
					{OK_TILE_COLORS.label}
				</span>
				<span class="sheet-legend-divider">·</span>
				<span>Podgląd przeciągania:</span>
				{#each Object.entries(TIER_COLORS) as [_tier, style]}
					<span class="sheet-legend-chip" style="background:{style.bg}; border-color:{style.border}; color:{style.text}">
						{style.label}
					</span>
				{/each}
				<span class="sheet-legend-divider">·</span>
				<span class="sheet-legend-chip" style="background:{ISSUE_COLORS.warning.bg}; border-color:{ISSUE_COLORS.warning.border}; color:{ISSUE_COLORS.warning.text}">
					<TriangleAlert size={10} strokeWidth={2.5} /> Ostrzeżenie
				</span>
				<span class="sheet-legend-chip" style="background:{ISSUE_COLORS.info.bg}; border-color:{ISSUE_COLORS.info.border}; color:{ISSUE_COLORS.info.text}">
					ℹ Info
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

		{#if chainSwap.computing}
			<div class="chain-swap-modal-backdrop" role="presentation">
				<div class="chain-swap-spinner-card" role="status" aria-live="polite">
					<div class="chain-swap-spinner" aria-hidden="true"></div>
					<p>Szukam możliwych sekwencji ruchów…</p>
				</div>
			</div>
		{/if}

		{#if chainSwap.mode === 'results'}
			<div class="chain-swap-modal-backdrop" role="presentation">
				<div class="chain-swap-modal" role="dialog" aria-label="Opcje zamiany łańcuchowej">
					<header class="chain-swap-modal-header">
						<div>
							<h2>Opcje zamiany</h2>
							{#if chainSwapSource && chainSwapTarget}
								<p>
									„{chainSwapSource.event.title}" → miejsce „{chainSwapTarget.event.title}"
								</p>
							{/if}
						</div>
						<button type="button" class="chain-swap-icon-btn" onclick={resetChainSwap}>×</button>
					</header>

					<div class="chain-swap-modal-body">
						{#if chainSwap.error}
							<div class="chain-swap-empty">{chainSwap.error}</div>
						{:else}
							<p class="chain-swap-help">
								Pierwsze opcje nie dodają ostrzeżeń. Opcje z ostrzeżeniami pokazuję tylko wtedy, gdy nie ma czystej sekwencji.
							</p>
							<div class="chain-swap-options">
								{#each chainSwap.options as option, idx (option.id)}
									<section class="chain-swap-option">
										<div class="chain-swap-option-head">
											<div>
												<h3>Opcja {idx + 1}: {option.moves.length} ruchów</h3>
												<p>
													{#if option.warnings.length === 0}
														Bez nowych ostrzeżeń
													{:else}
														{option.warnings.length} ostrzeżeń
													{/if}
												</p>
											</div>
											<button
												type="button"
												class="chain-swap-apply"
												onclick={() => previewChainSwapOption(option)}
											>
												Podgląd
											</button>
										</div>

										<ol class="chain-swap-moves">
											{#each option.moves as move}
												<li>
													<strong>{move.title}</strong>
													<span>{formatPlacement(move.from)} → {formatPlacement(move.to)}</span>
												</li>
											{/each}
										</ol>

										{#if option.warnings.length > 0}
											<div class="chain-swap-warnings">
												{#each option.warnings as warning}
													<span>{warning.message}</span>
												{/each}
											</div>
										{/if}
									</section>
								{/each}
							</div>
						{/if}
					</div>

					<footer class="chain-swap-modal-footer">
						<button type="button" class="chain-swap-secondary" onclick={resetChainSwap}>Zamknij</button>
						{#if chainSwap.options.length === 0 && chainSwap.sourceScheduleId}
							<button
								type="button"
								class="chain-swap-secondary"
								onclick={retryChainSwapSelection}
							>
								Wybierz inny wpis
							</button>
						{/if}
					</footer>
				</div>
			</div>
		{/if}

		{#if chainPreviewActive}
			<div class="chain-preview-bar" role="dialog" aria-label="Potwierdź zamianę">
				<div class="chain-preview-bar-text">
					<strong>Podgląd zamiany</strong>
					<span>
						{chainSwap.previewOption.moves.length} ruchów{chainSwap.previewOption.warnings.length > 0
							? ` · ${chainSwap.previewOption.warnings.length} ostrzeżeń`
							: ' · bez ostrzeżeń'}
					</span>
				</div>
				<div class="chain-preview-bar-actions">
					<button
						type="button"
						class="chain-preview-reject"
						disabled={chainSwap.applying}
						onclick={cancelChainSwapPreview}
					>
						Odrzuć
					</button>
					<button
						type="button"
						class="chain-preview-accept"
						disabled={chainSwap.applying}
						onclick={() => applyChainSwapOption(chainSwap.previewOption)}
					>
						{chainSwap.applying ? 'Stosuję…' : 'Akceptuj'}
					</button>
				</div>
			</div>
		{/if}

		<ScheduleEventPanel
			schedule={selectedSchedule}
			unscheduledEvent={selectedUnscheduledEvent}
			anchorRect={panelAnchorRect}
			{convention}
			mode={isPeopleMode ? 'people' : 'events'}
			{rooms}
			timeSlots={panelTimeSlots}
			issues={issues}
			onclose={closeEventPanel}
			onsaved={handlePanelSaved}
			onstartswap={startChainSwapSelection}
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

	.badge--toggle {
		border: 1px solid transparent;
		cursor: pointer;
		font-family: inherit;
		transition: opacity 0.15s ease;
	}

	.badge--toggle:hover {
		filter: brightness(0.97);
	}

	.badge--toggle.badge--off {
		opacity: 0.45;
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

	.badge--info {
		background: #e8f0fe;
		border: 1px solid #1a73e8;
		color: #1967d2;
	}

	.sheet-issue {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 4px;
		appearance: none;
		font: inherit;
		font-size: 12px;
		line-height: 1.3;
		max-width: 100%;
		text-align: left;
	}

	.sheet-issue--clickable {
		cursor: pointer;
	}

	.sheet-issue--clickable:hover {
		filter: brightness(0.97);
	}

	.sheet-issue:disabled {
		cursor: default;
	}

	.sheet-issue--active {
		outline: 2px solid #1a73e8;
		outline-offset: 1px;
	}

	.sheet-issue--active-error {
		outline: 3px solid #ea4335;
		outline-offset: 1px;
		box-shadow: 0 0 0 4px rgba(234, 67, 53, 0.22);
		font-weight: 700;
	}

	.sheet-issue--active-warning {
		outline: 3px solid #f9ab00;
		outline-offset: 1px;
		box-shadow: 0 0 0 4px rgba(249, 171, 0, 0.2);
		font-weight: 700;
	}

	.sheet-issue--active-info {
		outline: 3px solid #1a73e8;
		outline-offset: 1px;
		box-shadow: 0 0 0 4px rgba(26, 115, 232, 0.2);
		font-weight: 700;
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

	.sheet-issue--info {
		background: #e8f0fe;
		border: 1px solid #1a73e8;
		color: #1967d2;
	}

	.chain-swap-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 0.75rem;
		background: #e8f0fe;
		border-bottom: 1px solid #1a73e8;
		color: #174ea6;
		font-size: 12px;
		flex-shrink: 0;
	}

	.chain-swap-banner strong {
		font-weight: 700;
	}

	.highlight-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 0.75rem;
		background: #e8f0fe;
		border-bottom: 1px solid #1a73e8;
		color: #174ea6;
		font-size: 12px;
		flex-shrink: 0;
	}

	.highlight-banner strong {
		font-weight: 700;
	}

	.chain-swap-banner-btn,
	.chain-swap-secondary,
	.chain-swap-apply,
	.chain-swap-icon-btn {
		border: 1px solid #dadce0;
		border-radius: 4px;
		background: #fff;
		font: inherit;
		cursor: pointer;
	}

	.chain-swap-banner-btn {
		padding: 0.25rem 0.625rem;
		color: #174ea6;
		flex-shrink: 0;
	}

	.chain-swap-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 130;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		background: rgba(32, 33, 36, 0.38);
	}

	.chain-swap-spinner-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 1.75rem 2.25rem;
		background: #fff;
		border: 1px solid #dadce0;
		border-radius: 10px;
		box-shadow: 0 12px 32px rgba(32, 33, 36, 0.28);
		color: #3c4043;
		font-size: 13px;
	}

	.chain-swap-spinner {
		width: 2.25rem;
		height: 2.25rem;
		border: 3px solid #e8eaed;
		border-top-color: #1a73e8;
		border-radius: 50%;
		animation: chain-swap-spin 0.8s linear infinite;
	}

	@keyframes chain-swap-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.chain-swap-modal {
		width: min(760px, 100%);
		max-height: min(720px, 90vh);
		display: flex;
		flex-direction: column;
		background: #fff;
		border: 1px solid #dadce0;
		border-radius: 10px;
		box-shadow: 0 12px 32px rgba(32, 33, 36, 0.28);
		color: #202124;
		overflow: hidden;
	}

	.chain-swap-modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-bottom: 1px solid #e8eaed;
		background: #f8f9fa;
	}

	.chain-swap-modal-header h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}

	.chain-swap-modal-header p,
	.chain-swap-help,
	.chain-swap-option-head p {
		margin: 0.25rem 0 0;
		color: #5f6368;
		font-size: 12px;
	}

	.chain-swap-icon-btn {
		width: 1.75rem;
		height: 1.75rem;
		font-size: 18px;
		line-height: 1;
		color: #5f6368;
	}

	.chain-swap-modal-body {
		padding: 1rem;
		overflow-y: auto;
	}

	.chain-swap-empty {
		padding: 1rem;
		border: 1px solid #f5c2c0;
		border-radius: 6px;
		background: #fce8e6;
		color: #c5221f;
		font-size: 13px;
	}

	.chain-swap-options {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.chain-swap-option {
		border: 1px solid #dadce0;
		border-radius: 8px;
		overflow: hidden;
	}

	.chain-swap-option-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem;
		background: #f8f9fa;
		border-bottom: 1px solid #e8eaed;
	}

	.chain-swap-option-head h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}

	.chain-swap-apply {
		padding: 0.375rem 0.75rem;
		background: #1a73e8;
		border-color: #1a73e8;
		color: #fff;
		flex-shrink: 0;
	}

	.chain-swap-apply:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.chain-swap-moves {
		margin: 0;
		padding: 0.75rem 0.75rem 0.75rem 1.75rem;
	}

	.chain-swap-moves li + li {
		margin-top: 0.5rem;
	}

	.chain-swap-moves strong,
	.chain-swap-moves span {
		display: block;
	}

	.chain-swap-moves strong {
		font-size: 12px;
	}

	.chain-swap-moves span {
		margin-top: 0.125rem;
		color: #5f6368;
		font-size: 12px;
	}

	.chain-swap-warnings {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0 0.75rem 0.75rem;
		color: #b06000;
		font-size: 11px;
	}

	.chain-swap-modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid #e8eaed;
		background: #f8f9fa;
	}

	.chain-swap-secondary {
		padding: 0.375rem 0.75rem;
		color: #3c4043;
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
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.125rem;
		padding: 0.25rem 0.5rem;
		background: #f8f9fa;
		appearance: none;
		border: 0;
		border-right: 1px solid #dadce0;
		border-bottom: 1px solid #dadce0;
		color: #3c4043;
		font: inherit;
		text-align: center;
		overflow: hidden;
	}

	.sheet-col-header:disabled {
		color: #3c4043;
	}

	.sheet-col-header--clickable {
		cursor: pointer;
	}

	.sheet-col-header--clickable:hover {
		background: #eef3fd;
	}

	.sheet-col-header--selected {
		background: #e8f0fe;
		color: #174ea6;
		box-shadow: inset 0 -3px 0 #1a73e8;
	}

	.sheet-col-header--selected .sheet-col-header-name {
		font-weight: 700;
	}

	.sheet-col-header--issue-focus {
		font-weight: 700;
	}

	.sheet-col-header--issue-focus-error {
		background: #fce8e6;
		box-shadow: inset 0 -4px 0 #ea4335;
		color: #c5221f;
	}

	.sheet-col-header--issue-focus-warning {
		background: #fef7e0;
		box-shadow: inset 0 -4px 0 #f9ab00;
		color: #b06000;
	}

	.sheet-col-header--issue-focus-info {
		background: #e8f0fe;
		box-shadow: inset 0 -4px 0 #1a73e8;
		color: #1967d2;
	}

	.sheet-col-header-name {
		max-width: 100%;
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sheet-col-header-tags {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.125rem 0.25rem;
		max-width: 100%;
		overflow: visible;
	}

	.sheet-col-header-tag {
		font-size: 10px;
		font-weight: 400;
		line-height: 1.2;
		color: #5f6368;
		white-space: normal;
		text-align: center;
	}

	.sheet-col-header-tag--empty {
		font-style: italic;
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
		appearance: none;
		cursor: pointer;
	}

	.sheet-row-label:disabled {
		cursor: default;
	}

	.sheet-row-label--hour {
		color: #3c4043;
		font-weight: 500;
		font-size: 12px;
	}

	/* Tint the timeline rail lightly with the hype-tier colors so prime/quiet
	   hours are recognizable at a glance (T1 green, T2 amber, T3 red). */
	.sheet-row-label--tier1 {
		background: color-mix(in srgb, #e6f4ea 60%, #f8f9fa);
		box-shadow: inset 3px 0 0 color-mix(in srgb, #34a853 55%, transparent);
	}

	.sheet-row-label--tier2 {
		background: color-mix(in srgb, #fef7e0 55%, #f8f9fa);
		box-shadow: inset 3px 0 0 color-mix(in srgb, #fbbc04 50%, transparent);
	}

	.sheet-row-label--tier3 {
		background: color-mix(in srgb, #fce8e6 60%, #f8f9fa);
		box-shadow: inset 3px 0 0 color-mix(in srgb, #ea4335 50%, transparent);
	}

	.sheet-row-label--selected {
		color: #174ea6;
		font-weight: 700;
		background: #e8f0fe;
		box-shadow: inset 3px 0 0 #1a73e8;
	}

	.sheet-row-label--issue-focus {
		font-weight: 700;
	}

	.sheet-row-label--issue-focus-error {
		background: #fce8e6;
		color: #c5221f;
		box-shadow: inset 4px 0 0 #ea4335;
	}

	.sheet-row-label--issue-focus-warning {
		background: #fef7e0;
		color: #b06000;
		box-shadow: inset 4px 0 0 #f9ab00;
	}

	.sheet-row-label--issue-focus-info {
		background: #e8f0fe;
		color: #1967d2;
		box-shadow: inset 4px 0 0 #1a73e8;
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

	.sheet-cell--issue-focus {
		background: color-mix(in srgb, var(--issue-focus-cell, #e8f0fe) 74%, #fff);
		box-shadow: inset 0 0 0 2px var(--issue-focus-border, #1a73e8);
		z-index: 2;
	}

	.sheet-cell--issue-focus-error {
		--issue-focus-cell: #fce8e6;
		--issue-focus-border: #ea4335;
	}

	.sheet-cell--issue-focus-warning {
		--issue-focus-cell: #fef7e0;
		--issue-focus-border: #f9ab00;
	}

	.sheet-cell--issue-focus-info {
		--issue-focus-cell: #e8f0fe;
		--issue-focus-border: #1a73e8;
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
		border: 3px solid color-mix(in srgb, var(--cell-hint-border, #34a853) 78%, transparent);
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

	.sheet-cell--hint-info {
		background: color-mix(in srgb, #e8f0fe 68%, #fff);
		--cell-hint-border: #1a73e8;
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
		left: 1px;
		right: 1px;
		border: 4px dashed var(--drop-border, #34a853);
		border-radius: 4px;
		background: color-mix(in srgb, var(--drop-bg, #e6f4ea) 82%, transparent);
		pointer-events: none;
		z-index: 35;
		box-sizing: border-box;
		box-shadow:
			inset 0 0 0 2px color-mix(in srgb, var(--drop-border, #34a853) 38%, transparent),
			0 0 0 2px rgba(255, 255, 255, 0.72),
			0 4px 14px color-mix(in srgb, var(--drop-border, #34a853) 26%, transparent);
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

	.sheet-drop-preview--info {
		background: color-mix(in srgb, #e8f0fe 88%, transparent);
		border-color: #1a73e8;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, #1a73e8 35%, transparent);
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

	.sheet-event--info {
		border-width: 2px;
		box-shadow: inset 0 0 0 1px rgba(26, 115, 232, 0.14);
	}

	.sheet-event--locked {
		cursor: not-allowed;
		box-shadow:
			inset 0 0 0 1px rgba(251, 188, 4, 0.2),
			0 0 0 1px rgba(251, 188, 4, 0.36);
	}

	.sheet-event--selected {
		outline: 2px solid #1a73e8;
		outline-offset: 1px;
		z-index: 25;
	}

	.sheet-event--issue-dimmed {
		opacity: 0.16;
		filter: grayscale(0.7);
	}

	.sheet-event--issue-focus {
		z-index: 36;
		animation: issue-focus-pulse 1.15s ease-out;
	}

	.sheet-event--issue-focus-error {
		outline: 4px solid #ea4335;
		outline-offset: 2px;
		box-shadow:
			0 0 0 7px rgba(234, 67, 53, 0.24),
			0 10px 30px rgba(234, 67, 53, 0.34);
		transform: scale(1.03);
	}

	.sheet-event--issue-focus-warning {
		outline: 4px solid #f9ab00;
		outline-offset: 2px;
		box-shadow:
			0 0 0 7px rgba(249, 171, 0, 0.22),
			0 10px 30px rgba(249, 171, 0, 0.28);
		transform: scale(1.03);
	}

	.sheet-event--issue-focus-info {
		outline: 4px solid #1a73e8;
		outline-offset: 2px;
		box-shadow:
			0 0 0 7px rgba(26, 115, 232, 0.2),
			0 10px 30px rgba(26, 115, 232, 0.26);
		transform: scale(1.03);
	}

	@keyframes issue-focus-pulse {
		0% {
			transform: scale(1.08);
		}
		45% {
			transform: scale(1.05);
		}
		100% {
			transform: scale(1.03);
		}
	}

	.sheet-event--chain-source {
		outline: 3px solid #1a73e8;
		outline-offset: 2px;
		box-shadow:
			0 0 0 4px rgba(26, 115, 232, 0.18),
			0 2px 10px rgba(26, 115, 232, 0.24);
		z-index: 28;
	}

	.sheet-event--chain-target {
		outline: 3px solid #9334e6;
		outline-offset: 2px;
		box-shadow:
			0 0 0 4px rgba(147, 52, 230, 0.16),
			0 2px 10px rgba(147, 52, 230, 0.22);
		z-index: 27;
	}

	.sheet-event--chain-selectable {
		cursor: pointer;
	}

	.sheet-event--chain-selectable:hover {
		outline: 2px dashed #1a73e8;
		outline-offset: 2px;
	}

	/* Preview mode: dim untouched events, spotlight the moving ones. */
	.sheet-event--chain-dimmed {
		opacity: 0.28;
		filter: grayscale(0.5);
	}

	/* Search: spotlight matching tiles, fade out the rest. */
	.sheet-event--search-dimmed {
		opacity: 0.22;
		filter: grayscale(0.55);
	}

	.sheet-event--search-match {
		outline: 2px solid #1a73e8;
		outline-offset: 1px;
		box-shadow: 0 2px 10px rgba(26, 115, 232, 0.35);
		z-index: 24;
	}

	.sheet-event--chain-moving {
		outline: 2px dashed #1a73e8;
		outline-offset: 1px;
		opacity: 0.55;
		z-index: 26;
	}

	.chain-preview-ghost {
		position: absolute;
		left: 2px;
		right: 2px;
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		padding: 0.25rem 0.375rem;
		border: 2px solid #1a73e8;
		border-radius: 3px;
		background: color-mix(in srgb, #e8f0fe 92%, transparent);
		box-shadow: 0 2px 8px rgba(26, 115, 232, 0.28);
		overflow: hidden;
		z-index: 32;
		box-sizing: border-box;
		pointer-events: none;
	}

	.chain-preview-ghost-order {
		position: absolute;
		top: 2px;
		right: 2px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		border-radius: 999px;
		background: #1a73e8;
		color: #fff;
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
	}

	.chain-preview-ghost-title {
		font-size: 11px;
		font-weight: 600;
		color: #174ea6;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding-right: 18px;
	}

	.chain-preview-ghost-from {
		font-size: 10px;
		color: #5f6368;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chain-preview-bar {
		position: fixed;
		bottom: 1.25rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 135;
		display: flex;
		align-items: center;
		gap: 1.25rem;
		padding: 0.75rem 1rem 0.75rem 1.25rem;
		background: #fff;
		border: 1px solid #dadce0;
		border-radius: 999px;
		box-shadow: 0 8px 28px rgba(32, 33, 36, 0.32);
	}

	.chain-preview-bar-text {
		display: flex;
		flex-direction: column;
		line-height: 1.25;
	}

	.chain-preview-bar-text strong {
		font-size: 13px;
		color: #202124;
	}

	.chain-preview-bar-text span {
		font-size: 12px;
		color: #5f6368;
	}

	.chain-preview-bar-actions {
		display: flex;
		gap: 0.5rem;
	}

	.chain-preview-reject,
	.chain-preview-accept {
		padding: 0.5rem 1.25rem;
		border-radius: 999px;
		border: 1px solid #dadce0;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.chain-preview-reject {
		background: #fff;
		color: #c5221f;
		border-color: #f5c2c0;
	}

	.chain-preview-reject:hover {
		background: #fce8e6;
	}

	.chain-preview-accept {
		background: #1a73e8;
		border-color: #1a73e8;
		color: #fff;
	}

	.chain-preview-accept:hover {
		background: #1765cc;
	}

	.chain-preview-reject:disabled,
	.chain-preview-accept:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.sheet-event--dragging {
		opacity: 0.45;
		cursor: grabbing;
		z-index: 30;
	}

	.sheet-event--drop-candidate:not(.sheet-event--drag-edge) {
		background:
			linear-gradient(
				color-mix(in srgb, var(--ev-edge-bg, #e6f4ea) 74%, transparent),
				color-mix(in srgb, var(--ev-edge-bg, #e6f4ea) 74%, transparent)
			),
			var(--ev-bg);
		border-width: 2px;
		border-color: var(--ev-edge, var(--ev-border));
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--ev-edge, var(--ev-border)) 20%, transparent),
			0 0 0 1px color-mix(in srgb, var(--ev-edge, var(--ev-border)) 34%, transparent);
	}

	.sheet-event--drop-candidate-pending:not(.sheet-event--drag-edge) {
		background: #f1f3f4;
		border-color: #9aa0a6;
		color: #5f6368;
		box-shadow: inset 0 0 0 1px rgba(95, 99, 104, 0.2);
	}

	.sheet-event--drag-edge {
		border-width: 4px;
		border-color: var(--ev-edge, var(--ev-border));
		outline: 2px solid var(--ev-edge, var(--ev-border));
		outline-offset: 1px;
		box-shadow:
			inset 0 0 0 2px color-mix(in srgb, var(--ev-edge, var(--ev-border)) 24%, transparent),
			0 0 0 3px rgba(255, 255, 255, 0.78),
			0 5px 16px color-mix(in srgb, var(--ev-edge, var(--ev-border)) 34%, transparent);
		z-index: 36;
	}

	.sheet-event--drag-edge-ok {
		--ev-edge: #34a853;
	}

	.sheet-event--drag-edge-warning {
		--ev-edge: #f9ab00;
	}

	.sheet-event--drag-edge-info {
		--ev-edge: #1a73e8;
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

	.sheet-event-meta-icon--info {
		color: #1a73e8;
		font-size: 12px;
		font-weight: 700;
		line-height: 1;
	}

	.sheet-event-meta-icon--locked {
		color: #b06000;
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

	.sheet-event.sheet-event--drag-edge,
	.sheet-event.sheet-event--drag-edge:hover {
		z-index: 36;
	}

	.sheet-event:active {
		cursor: grabbing;
		z-index: 30;
	}

	.sheet-event-title {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		align-items: center;
		overflow: hidden;
	}

	.sheet-event-title span {
		font-size: 12px;
		font-weight: 500;
		color: #202124;
		line-height: 1.35;
		word-break: break-word;
		overflow-wrap: break-word;
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

	.sheet-sidebar-header-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.sheet-sidebar-sort {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.125rem 0.375rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		background: #fff;
		font-size: 10px;
		color: #5f6368;
		cursor: pointer;
		line-height: 1;
	}

	.sheet-sidebar-sort:hover {
		background: #f1f3f4;
		color: #202124;
	}

	.sheet-sidebar-sort--active {
		border-color: #1a73e8;
		color: #1a73e8;
		background: #e8f0fe;
	}

	.sheet-sidebar-count {
		background: #e8eaed;
		color: #3c4043;
		padding: 0.125rem 0.375rem;
		border-radius: 999px;
		font-size: 11px;
	}

	.sheet-sidebar-search {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.625rem;
		border-bottom: 1px solid #dadce0;
		background: #fff;
		color: #5f6368;
		flex-shrink: 0;
	}

	.sheet-sidebar-search-input {
		min-width: 0;
		flex: 1;
		height: 1.875rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		background: #fff;
		padding: 0 0.5rem;
		font: inherit;
		font-size: 12px;
		color: #202124;
		outline: none;
	}

	.sheet-sidebar-search-input:focus {
		border-color: #1a73e8;
		box-shadow: 0 0 0 1px #1a73e8;
	}

	.sheet-sidebar-search-clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: 1px solid transparent;
		border-radius: 4px;
		background: transparent;
		color: #5f6368;
		cursor: pointer;
		flex-shrink: 0;
	}

	.sheet-sidebar-search-clear:hover {
		background: #f1f3f4;
		color: #202124;
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
		border: 2px solid #dadce0;
		border-radius: 4px;
		cursor: grab;
		text-align: left;
		transition: background 0.1s, border-color 0.1s;
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

	.sheet-sidebar-item--slot-ok {
		background: #e6f4ea;
		border-color: #34a853;
	}

	.sheet-sidebar-item--slot-warn {
		background: #fef7e0;
		border-color: #fbbc04;
	}

	.sheet-sidebar-item--slot-info {
		background: #e8f0fe;
		border-color: #1a73e8;
	}

	.sheet-sidebar-item--slot-no {
		background: #fce8e6;
		border-color: #ea4335;
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
