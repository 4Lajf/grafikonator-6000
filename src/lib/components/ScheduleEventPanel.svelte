<script>
	import {
		getPersonAvailabilityGrid,
		updateSchedule,
		updatePeopleSchedule,
		createSchedule,
		createPeopleSchedule,
		setAvailability,
		validateScheduleMove,
		validatePeopleScheduleMove,
		validateEventPlacement,
		validatePersonPlacement,
		deleteSchedule,
		deletePeopleSchedule,
		updateEvent,
		updatePerson,
		TIER_OPTIONS,
		EVENT_TIER_OPTIONS
	} from '$lib/database.js';
	import { toast } from 'svelte-sonner';
	import ColorPicker from '$lib/components/ColorPicker.svelte';
	import { CircleAlert, TriangleAlert, X, Pencil, Trash2, Lock, Unlock } from 'lucide-svelte';

	let {
		schedule = null,
		unscheduledEvent = null,
		anchorRect = null,
		convention = null,
		mode = 'events',
		rooms = [],
		timeSlots = [],
		issues = [],
		onclose = () => {},
		onsaved = () => {},
		onstartswap = () => {}
	} = $props();

	let loading = $state(true);
	let saving = $state(false);
	let editingSchedule = $state(false);
	let availabilityGrid = $state([]);
	let slotTiers = $state({});
	let eventTier = $state(2);
	let autoSchedule = $state(true);
	let estimatedAttendance = $state('');
	let requiredRoomTags = $state('');
	let eventKind = $state('');
	let color = $state('');
	let conflictTags = $state('');
	let coScheduleTags = $state('');
	const STATION_PREFERENCE_OPTIONS = [
		{ value: 1, label: 'Chcę' },
		{ value: 2, label: 'Tylko w razie potrzeby' },
		{ value: 3, label: 'Nie chcę' }
	];

	let tagPreferencesMap = $state({});
	let minBlocks = $state('');
	let maxBlocks = $state('');
	let scheduleForm = $state(null);
	let validationMessage = $state('');
	let validationSeverity = $state('');

	const panelWidth = 360;
	const panelMaxHeight = 520;

	const panelStyle = $derived.by(() => {
		if (!anchorRect) return 'display:none';
		const margin = 10;
		let left = anchorRect.right + margin;
		let top = anchorRect.top;

		if (left + panelWidth > window.innerWidth - margin) {
			left = anchorRect.left - panelWidth - margin;
		}
		if (left < margin) left = margin;

		const maxTop = window.innerHeight - panelMaxHeight - margin;
		if (top > maxTop) top = Math.max(margin, maxTop);
		if (top < margin) top = margin;

		return `left:${left}px;top:${top}px;width:${panelWidth}px;max-height:${panelMaxHeight}px`;
	});

	const scheduleIssues = $derived(
		schedule ? issues.filter((issue) => issue.scheduleId === schedule.id) : []
	);
	const isPeopleMode = $derived(mode === 'people');
	const hostId = $derived(
		schedule?.hosts?.[0]?.id ?? unscheduledEvent?.hosts?.[0]?.id ?? null
	);
	const personId = $derived(schedule?.person_id ?? unscheduledEvent?.person?.id ?? unscheduledEvent?.id ?? hostId);
	const panelTitle = $derived(schedule?.event?.title ?? unscheduledEvent?.title ?? '');
	const panelDuration = $derived(
		schedule?.event?.duration_minutes ?? unscheduledEvent?.duration_minutes ?? 0
	);
	const panelOrganizerNotes = $derived(
		schedule?.event?.organizer_notes ?? unscheduledEvent?.organizer_notes ?? ''
	);
	const panelEventTier = $derived(schedule?.event?.tier ?? unscheduledEvent?.tier ?? 2);
	const panelAutoSchedule = $derived(
		(schedule?.event?.auto_schedule ?? unscheduledEvent?.auto_schedule ?? 1) !== 0
	);
	const panelEstimatedAttendance = $derived(
		schedule?.event?.estimated_attendance ?? unscheduledEvent?.estimated_attendance ?? ''
	);
	const panelRequiredRoomTags = $derived(
		(schedule?.event?.required_room_tags ?? unscheduledEvent?.required_room_tags ?? []).join(', ')
	);
	const panelEventKind = $derived(schedule?.event?.kind ?? unscheduledEvent?.kind ?? '');
	const panelColor = $derived(
		schedule?.event?.color ?? schedule?.person?.color ?? unscheduledEvent?.color ?? unscheduledEvent?.person?.color ?? ''
	);
	const panelConflictTags = $derived(
		(schedule?.event?.conflict_tags ?? schedule?.person?.conflict_tags ?? unscheduledEvent?.conflict_tags ?? unscheduledEvent?.person?.conflict_tags ?? []).join(', ')
	);
	const panelCoScheduleTags = $derived(
		(schedule?.event?.co_schedule_tags ?? schedule?.person?.co_schedule_tags ?? unscheduledEvent?.co_schedule_tags ?? unscheduledEvent?.person?.co_schedule_tags ?? []).join(', ')
	);
	const panelTagPreferencesMap = $derived(
		schedule?.person?.tag_preferences ?? unscheduledEvent?.person?.tag_preferences ?? {}
	);
	const panelPersonNotes = $derived(
		schedule?.person?.notes ?? unscheduledEvent?.person?.notes ?? unscheduledEvent?.notes ?? ''
	);
	const panelMinBlocks = $derived(schedule?.person?.min_blocks ?? unscheduledEvent?.person?.min_blocks ?? '');
	const panelMaxBlocks = $derived(schedule?.person?.max_blocks ?? unscheduledEvent?.person?.max_blocks ?? '');
	const scheduleLocked = $derived(schedule?.locked === true);
	const eventId = $derived(schedule?.event?.id ?? unscheduledEvent?.id ?? null);
	const hostLabel = $derived(
		schedule?.host_name ||
			unscheduledEvent?.host_name ||
			schedule?.hosts?.[0]?.display_name ||
			unscheduledEvent?.hosts?.[0]?.display_name ||
			'—'
	);
	const slotCount = $derived(
		convention?.slot_minutes
			? Math.ceil(panelDuration / convention.slot_minutes)
			: 1
	);
	const eventSlots = $derived.by(() => {
		if (!schedule || !availabilityGrid.length) return [];
		const day = availabilityGrid.find((d) => d.date === schedule.start_slot?.date);
		if (!day) return [];
		const startIdx = day.slots.findIndex((s) => s.id === schedule.start_time_slot_id);
		if (startIdx < 0) return [];
		return day.slots.slice(startIdx, startIdx + schedule.slot_count);
	});
	const eventSlotIds = $derived(new Set(eventSlots.map((slot) => slot.id)));
	const tiersDirty = $derived.by(() =>
		availabilityGrid.some((day) =>
			day.slots.some((slot) => Number(slotTiers[slot.id]) !== Number(slot.tier))
		)
	);
	const scheduleDirty = $derived.by(() => {
		if (!scheduleForm || !editingSchedule) return false;
		if (unscheduledEvent) {
			return Boolean(scheduleForm.room_id && scheduleForm.start_time_slot_id);
		}
		if (!schedule) return false;
		return (
			scheduleForm.room_id !== schedule.room_id ||
			scheduleForm.start_time_slot_id !== schedule.start_time_slot_id
		);
	});
	const eventTierDirty = $derived(eventId != null && Number(eventTier) !== Number(panelEventTier));
	const autoScheduleDirty = $derived(eventId != null && Boolean(autoSchedule) !== panelAutoSchedule);
	const eventMetadataDirty = $derived(
		eventId != null &&
			(String(estimatedAttendance) !== String(panelEstimatedAttendance ?? '') ||
				requiredRoomTags !== panelRequiredRoomTags ||
				eventKind !== panelEventKind ||
				color !== String(panelColor ?? '') ||
				conflictTags !== panelConflictTags ||
				coScheduleTags !== panelCoScheduleTags)
	);
	const personSettingsDirty = $derived(
		isPeopleMode &&
			personId != null &&
			(color !== String(panelColor ?? '') ||
				conflictTags !== panelConflictTags ||
				coScheduleTags !== panelCoScheduleTags ||
				JSON.stringify(tagPreferencesMap) !== JSON.stringify(panelTagPreferencesMap) ||
				String(minBlocks) !== String(panelMinBlocks ?? '') ||
				String(maxBlocks) !== String(panelMaxBlocks ?? ''))
	);
	const eventSettingsDirty = $derived(!isPeopleMode && (eventTierDirty || autoScheduleDirty || eventMetadataDirty));
	const isDirty = $derived(tiersDirty || scheduleDirty || eventSettingsDirty || personSettingsDirty);

	function formatTime(timeStr) {
		return String(timeStr || '').slice(0, 5);
	}

	function getEndTime() {
		if (!schedule) return '';
		const startIdx = timeSlots.findIndex((ts) => ts.id === schedule.start_time_slot_id);
		if (startIdx < 0) return '';
		return formatTime(timeSlots[startIdx + schedule.slot_count - 1]?.end_time);
	}

	function formatDate(dateStr) {
		if (!dateStr) return '';
		const [year, month, day] = dateStr.split('-').map(Number);
		return new Date(year, month - 1, day).toLocaleDateString('pl-PL', {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});
	}

	function tierBtnColor(tier) {
		if (tier === 1) return '#34a853';
		if (tier === 3) return '#ea4335';
		return '#fbbc04';
	}

	function cycleSlotTier(slotId) {
		const current = Number(slotTiers[slotId] ?? 2);
		setSlotTier(slotId, current === 3 ? 1 : current + 1);
	}

	function updateTagPreference(stationName, value) {
		tagPreferencesMap = { ...tagPreferencesMap, [stationName]: Number(value) };
	}

	function stationPreferenceFor(stationName) {
		return Number(tagPreferencesMap[stationName] ?? 2);
	}

	function initForms(grid = availabilityGrid) {
		const allSlots = grid.flatMap((day) => day.slots);
		slotTiers = Object.fromEntries(allSlots.map((slot) => [slot.id, slot.tier]));
		eventTier = Number(schedule?.event?.tier ?? unscheduledEvent?.tier ?? 2);
		autoSchedule = (schedule?.event?.auto_schedule ?? unscheduledEvent?.auto_schedule ?? 1) !== 0;
		estimatedAttendance = String(panelEstimatedAttendance ?? '');
		requiredRoomTags = panelRequiredRoomTags;
		eventKind = panelEventKind;
		color = String(panelColor ?? '');
		conflictTags = panelConflictTags;
		coScheduleTags = panelCoScheduleTags;
		tagPreferencesMap = { ...panelTagPreferencesMap };
		minBlocks = panelMinBlocks ?? '';
		maxBlocks = panelMaxBlocks ?? '';
		if (schedule) {
			scheduleForm = {
				room_id: schedule.room_id,
				start_time_slot_id: schedule.start_time_slot_id
			};
		} else if (unscheduledEvent) {
			scheduleForm = {
				room_id: rooms[0]?.id ?? '',
				start_time_slot_id: timeSlots[0]?.id ?? ''
			};
		} else {
			scheduleForm = null;
		}
		validationMessage = '';
		validationSeverity = '';
	}

	async function loadDetails() {
		if (!convention || (!schedule && !unscheduledEvent)) return;
		loading = true;
		editingSchedule = false;
		try {
			if (hostId) {
				const grid = await getPersonAvailabilityGrid(hostId, convention.id);
				availabilityGrid = grid;
				initForms(grid);
			} else {
				availabilityGrid = [];
				initForms([]);
			}
		} catch (error) {
			toast.error('Błąd ładowania szczegółów', { description: error.message });
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (schedule?.id || unscheduledEvent?.id) {
			loadDetails();
		}
	});

	async function previewScheduleEdit() {
		if (!scheduleForm) return;
		const validation = isPeopleMode
			? unscheduledEvent
				? await validatePersonPlacement(
						personId,
						scheduleForm.room_id,
						scheduleForm.start_time_slot_id
					)
				: await validatePeopleScheduleMove(
						schedule.id,
						scheduleForm.room_id,
						scheduleForm.start_time_slot_id
					)
			: unscheduledEvent
				? await validateEventPlacement(
						unscheduledEvent.id,
						scheduleForm.room_id,
						scheduleForm.start_time_slot_id
					)
				: await validateScheduleMove(
						schedule.id,
						scheduleForm.room_id,
						scheduleForm.start_time_slot_id
					);
		if (!validation.valid) {
			validationSeverity = 'error';
			validationMessage = validation.reason || 'Konflikt w grafiku';
			return;
		}
		if (validation.warning) {
			validationSeverity = 'warning';
			validationMessage = validation.warning;
			return;
		}
		if (validation.info) {
			validationSeverity = 'info';
			validationMessage = validation.info;
			return;
		}
		validationSeverity = '';
		validationMessage = '';
	}

	async function handleSave() {
		if (!schedule && !unscheduledEvent) return;
		saving = true;
		try {
			if (scheduleDirty) {
				if (unscheduledEvent) {
					if (isPeopleMode) {
						await createPeopleSchedule({
							person_id: personId,
							room_id: scheduleForm.room_id,
							time_slot_id: scheduleForm.start_time_slot_id
						});
					} else {
						await createSchedule({
							event_id: unscheduledEvent.id,
							room_id: scheduleForm.room_id,
							start_time_slot_id: scheduleForm.start_time_slot_id,
							slot_count: slotCount
						});
					}
				} else {
					if (scheduleLocked) {
						toast.error('Pozycja zablokowana — odblokuj ją przed zmianą grafiku');
						return;
					}
					if (isPeopleMode) {
						await updatePeopleSchedule(schedule.id, {
							room_id: scheduleForm.room_id,
							time_slot_id: scheduleForm.start_time_slot_id
						});
					} else {
						await updateSchedule(schedule.id, {
							room_id: scheduleForm.room_id,
							start_time_slot_id: scheduleForm.start_time_slot_id,
							slot_count: schedule.slot_count
						});
					}
				}
			}

			if (tiersDirty) {
				if (!hostId) {
					toast.error('Brak prowadzącego — nie można zapisać dyspozycyjności');
					return;
				}
				for (const day of availabilityGrid) {
					for (const slot of day.slots) {
						const tier = Number(slotTiers[slot.id]);
						if (tier !== slot.tier) {
							await setAvailability(hostId, slot.id, tier);
						}
					}
				}
			}

			if (eventSettingsDirty && eventId) {
				await updateEvent(eventId, {
					tier: Number(eventTier),
					auto_schedule: Boolean(autoSchedule),
					estimated_attendance: estimatedAttendance,
					required_room_tags: requiredRoomTags,
					kind: eventKind.trim() || null,
					color,
					conflict_tags: conflictTags,
					co_schedule_tags: coScheduleTags
				});
			}

			if (personSettingsDirty && personId) {
				await updatePerson(personId, {
					color,
					conflict_tags: conflictTags,
					co_schedule_tags: coScheduleTags,
					tag_preferences: tagPreferencesMap,
					min_blocks: minBlocks,
					max_blocks: maxBlocks
				});
			}

			toast.success(unscheduledEvent && scheduleDirty ? 'Zaplanowano pozycję' : 'Zapisano zmiany');
			editingSchedule = false;
			onsaved({
				scheduleChanged: scheduleDirty || eventSettingsDirty,
				availabilityHostIds: tiersDirty && hostId ? [hostId] : []
			});
			if (unscheduledEvent && scheduleDirty) {
				onclose();
				return;
			}
			await loadDetails();
		} catch (error) {
			toast.error('Błąd zapisu', { description: error.message });
		} finally {
			saving = false;
		}
	}

	async function handleDelete() {
		if (!confirm(`Usunąć „${schedule.event.title}" z grafiku?`)) return;
		try {
			if (isPeopleMode) {
				await deletePeopleSchedule(schedule.id);
			} else {
				await deleteSchedule(schedule.id);
			}
			toast.success('Usunięto z grafiku');
			onsaved({ scheduleChanged: true });
			onclose();
		} catch (error) {
			toast.error('Błąd usuwania', { description: error.message });
		}
	}

	async function handleToggleLock() {
		if (!schedule) return;
		saving = true;
		try {
			if (isPeopleMode) {
				await updatePeopleSchedule(schedule.id, { locked: !scheduleLocked });
			} else {
				await updateSchedule(schedule.id, { locked: !scheduleLocked });
			}
			toast.success(scheduleLocked ? 'Odblokowano pozycję' : 'Zablokowano pozycję');
			editingSchedule = false;
			onsaved({ scheduleChanged: true });
			await loadDetails();
		} catch (error) {
			toast.error('Błąd blokady', { description: error.message });
		} finally {
			saving = false;
		}
	}

	function handleBackdropClick(event) {
		if (event.target === event.currentTarget) onclose();
	}

	function handleKeydown(event) {
		if (event.key === 'Escape') onclose();
	}

	function setSlotTier(slotId, tier) {
		slotTiers = { ...slotTiers, [slotId]: tier };
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if (schedule || unscheduledEvent) && anchorRect}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="panel-backdrop" onclick={handleBackdropClick}></div>

	<div class="event-panel" style={panelStyle} role="dialog" aria-label="Szczegóły pozycji">
		<header class="panel-header">
			<div class="panel-header-text">
				<h2>{panelTitle}</h2>
				<p>
					{#if schedule}
						{formatTime(schedule.start_slot?.start_time)}–{getEndTime()} · {schedule.room?.name}
					{:else}
						Do zaplanowania · {panelDuration} min
					{/if}
				</p>
			</div>
			<button class="panel-icon-btn" onclick={onclose} title="Zamknij">
				<X size={15} />
			</button>
		</header>

		<div class="panel-body">
			{#if loading}
				<div class="panel-loading">Ładowanie…</div>
			{:else}
				{#if scheduleIssues.length > 0}
					<section class="panel-section">
						<h3>Problemy</h3>
						<div class="panel-issues">
							{#each scheduleIssues as issue}
								<div class="panel-issue panel-issue--{issue.severity}">
									{#if issue.severity === 'error'}
										<CircleAlert size={14} />
									{:else if issue.severity === 'warning'}
										<TriangleAlert size={14} />
									{:else}
										<span aria-hidden="true">ℹ</span>
									{/if}
									<span>{issue.message}</span>
								</div>
							{/each}
						</div>
					</section>
				{/if}

				<section class="panel-hype">
					<div class="panel-hype-grid">
						<div class="panel-hype-cell">
							<span class="panel-hype-label">Pseudonim</span>
							<span class="panel-hype-value">{hostLabel}</span>
						</div>
						<div class="panel-hype-cell">
							<span class="panel-hype-label">Tytuł</span>
							<span class="panel-hype-value">{panelTitle}</span>
						</div>
						<div class="panel-hype-cell panel-hype-cell--narrow">
							<span class="panel-hype-label">Czas</span>
							<span class="panel-hype-value">{isPeopleMode ? `${convention?.slot_minutes ?? 30} min` : `${panelDuration} min`}</span>
						</div>
						{#if !isPeopleMode}
						<div class="panel-hype-cell panel-hype-cell--tier">
							<span class="panel-hype-label">Tier atrakcji</span>
							<div class="tier-buttons tier-buttons--compact">
								{#each EVENT_TIER_OPTIONS as tier}
									<button
										type="button"
										class="tier-btn"
										class:tier-btn--active={Number(eventTier) === tier.value}
										style="--tier-color:{tierBtnColor(tier.value)}"
										title={tier.label}
										onclick={() => (eventTier = tier.value)}
									>
										T{tier.value}
									</button>
								{/each}
							</div>
						</div>
						<label class="panel-auto-plan">
							<input type="checkbox" bind:checked={autoSchedule} />
							<span>
								<span class="panel-hype-label">Auto-plan</span>
								<span class="panel-hype-value">Planuj automatycznie</span>
							</span>
						</label>
						{/if}
					</div>
					{#if isPeopleMode && panelPersonNotes?.trim()}
						<p class="panel-hype-notes">
							<span class="panel-hype-label">Notatki</span>
							{panelPersonNotes}
						</p>
					{:else if panelOrganizerNotes?.trim()}
						<p class="panel-hype-notes">
							<span class="panel-hype-label">Notatki</span>
							{panelOrganizerNotes}
						</p>
					{/if}
				</section>

				<section class="panel-section">
					<h3>{isPeopleMode ? 'Ustawienia w grafiku' : 'Wymagania sali'}</h3>
					<div class="panel-form-grid">
						{#if isPeopleMode}
							<label class="panel-field">
								<span>Min. slotów</span>
								<input type="number" min="0" bind:value={minBlocks} />
							</label>
							<label class="panel-field">
								<span>Maks. slotów</span>
								<input type="number" min="0" bind:value={maxBlocks} />
							</label>
						{:else}
							<label class="panel-field">
								<span>Szacowana frekwencja</span>
								<input type="number" min="0" bind:value={estimatedAttendance} placeholder="np. 50" />
							</label>
							<label class="panel-field">
								<span>Typ atrakcji</span>
								<input bind:value={eventKind} placeholder="np. Prelekcja, Konkurs, Warsztaty" />
							</label>
							<label class="panel-field panel-field--full">
								<span>Wymagane tagi sali</span>
								<input bind:value={requiredRoomTags} placeholder="projector, quiet_room" />
							</label>
						{/if}
						<div class="panel-field">
							<span>Kolor</span>
							<ColorPicker bind:value={color} />
						</div>
						<label class="panel-field">
							<span>Tagi wykluczające</span>
							<input bind:value={conflictTags} placeholder="np. prowadzący, konkurs" />
						</label>
						<label class="panel-field panel-field--full">
							<span>Tagi wspólnego slotu</span>
							<input bind:value={coScheduleTags} placeholder="np. jury, ekipa techniczna" />
						</label>
						{#if isPeopleMode}
							<div class="panel-field panel-field--full">
								<span>Preferencje stanowisk</span>
								<div class="panel-station-grid">
									{#each rooms as room}
										<label class="panel-station-item">
											<span class="panel-station-name">{room.name}</span>
											<select
												class="panel-station-select"
												value={stationPreferenceFor(room.name)}
												onchange={(event) =>
													updateTagPreference(room.name, event.currentTarget.value)}
											>
												{#each STATION_PREFERENCE_OPTIONS as option}
													<option value={option.value}>{option.label}</option>
												{/each}
											</select>
										</label>
									{:else}
										<p class="panel-station-empty">Brak stanowisk — dodaj je w zakładce Konwent.</p>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</section>

				{#if hostId && availabilityGrid.length > 0}
					<section class="panel-section panel-section--availability">
						<h3>Dyspozycyjność</h3>
						<div class="avail-legend">
							{#each TIER_OPTIONS as tier}
								<span class="avail-legend-item">
									<span
										class="avail-legend-dot"
										style="background:{tierBtnColor(tier.value)}"
									></span>
									{tier.value}
								</span>
							{/each}
							<span class="avail-legend-hint">Kliknij slot</span>
						</div>
						<div class="avail-days">
							{#each availabilityGrid as day}
								<div class="avail-day">
									<div class="avail-day-header">{formatDate(day.date)}</div>
									<div class="avail-slots">
										{#each day.slots as slot}
											<button
												type="button"
												class="avail-chip"
												class:avail-chip--event={eventSlotIds.has(slot.id)}
												class:avail-chip--t1={Number(slotTiers[slot.id]) === 1}
												class:avail-chip--t2={Number(slotTiers[slot.id]) === 2}
												class:avail-chip--t3={Number(slotTiers[slot.id]) === 3}
												title="{formatTime(slot.start_time)}–{formatTime(slot.end_time)}: {TIER_OPTIONS.find((t) => t.value === Number(slotTiers[slot.id]))?.label}"
												onclick={() => cycleSlotTier(slot.id)}
											>
												{formatTime(slot.start_time)}
											</button>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/if}

				{#if editingSchedule && scheduleForm}
					<section class="panel-section">
						<h3>Grafik</h3>
						<label class="panel-field">
							<span>Sala</span>
							<select bind:value={scheduleForm.room_id} onchange={previewScheduleEdit}>
								{#each rooms as room}
									<option value={room.id}>{room.name}</option>
								{/each}
							</select>
						</label>
						<label class="panel-field">
							<span>Start</span>
							<select bind:value={scheduleForm.start_time_slot_id} onchange={previewScheduleEdit}>
								{#each timeSlots as slot}
									<option value={slot.id}>
										{formatTime(slot.start_time)} – {formatTime(slot.end_time)}
									</option>
								{/each}
							</select>
						</label>
						{#if validationMessage}
							<div class="panel-validation panel-validation--{validationSeverity}">{validationMessage}</div>
						{/if}
					</section>
				{/if}

				<div class="panel-actions">
					{#if schedule}
						<div class="panel-lock-state" class:panel-lock-state--locked={scheduleLocked}>
							{#if scheduleLocked}
								<Lock size={14} />
								<span>Pozycja zablokowana — ten wpis nie będzie przenoszony.</span>
							{:else}
								<Unlock size={14} />
								<span>Pozycja odblokowana.</span>
							{/if}
						</div>
						<button class="panel-btn panel-btn--danger" onclick={handleDelete}>
							<Trash2 size={14} /> Usuń
						</button>
						<button class="panel-btn" onclick={handleToggleLock} disabled={saving}>
							{#if scheduleLocked}
								<Unlock size={14} /> Odblokuj
							{:else}
								<Lock size={14} /> Zablokuj
							{/if}
						</button>
					{/if}
					{#if !editingSchedule}
						{#if schedule}
							<button class="panel-btn" onclick={() => onstartswap(schedule)} disabled={scheduleLocked}>
								Znajdź zamianę
							</button>
						{/if}
						<button
							class="panel-btn"
							onclick={() => {
								editingSchedule = true;
								previewScheduleEdit();
							}}
							disabled={scheduleLocked && schedule}
						>
							<Pencil size={14} /> {unscheduledEvent ? 'Zaplanuj' : 'Grafik'}
						</button>
					{:else}
						<button
							class="panel-btn"
							onclick={() => {
								editingSchedule = false;
								if (schedule) {
									scheduleForm = {
										room_id: schedule.room_id,
										start_time_slot_id: schedule.start_time_slot_id
									};
								} else {
									scheduleForm = {
										room_id: rooms[0]?.id ?? '',
										start_time_slot_id: timeSlots[0]?.id ?? ''
									};
								}
								validationMessage = '';
								validationSeverity = '';
							}}
						>
							Anuluj grafik
						</button>
					{/if}
					<button class="panel-btn panel-btn--primary" onclick={handleSave} disabled={saving || !isDirty}>
						{saving ? 'Zapisywanie…' : 'Zapisz'}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.panel-backdrop {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: transparent;
	}

	.event-panel {
		position: fixed;
		z-index: 100;
		display: flex;
		flex-direction: column;
		background: #fff;
		border: 1px solid #dadce0;
		border-radius: 8px;
		box-shadow: 0 8px 28px rgba(60, 64, 67, 0.28);
		overflow: hidden;
		font-size: 13px;
		color: #202124;
	}

	.panel-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 0.875rem;
		border-bottom: 1px solid #e8eaed;
		background: #f8f9fa;
		flex-shrink: 0;
	}

	.panel-header-text {
		min-width: 0;
	}

	.panel-header h2 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		line-height: 1.3;
	}

	.panel-header p {
		margin: 0.25rem 0 0;
		font-size: 11px;
		color: #5f6368;
	}

	.panel-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		background: #fff;
		color: #5f6368;
		cursor: pointer;
		flex-shrink: 0;
	}

	.panel-icon-btn:hover {
		background: #f1f3f4;
		color: #202124;
	}

	.panel-body {
		overflow-y: auto;
		padding: 0.75rem 0.875rem;
	}

	.panel-loading {
		padding: 2rem 0;
		text-align: center;
		color: #5f6368;
	}

	.panel-section + .panel-section {
		margin-top: 0.875rem;
		padding-top: 0.875rem;
		border-top: 1px solid #e8eaed;
	}

	.panel-section h3 {
		margin: 0 0 0.5rem;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #5f6368;
	}

	.panel-hype {
		margin-bottom: 0.5rem;
	}

	.panel-hype-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		align-items: flex-end;
	}

	.panel-hype-cell {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		flex: 1 1 7rem;
	}

	.panel-hype-cell--narrow {
		flex: 0 1 4.5rem;
	}

	.panel-hype-cell--tier {
		flex: 1 1 100%;
	}

	.panel-auto-plan {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1 1 100%;
		padding: 0.375rem 0.5rem;
		border: 1px solid #e8eaed;
		border-radius: 4px;
		background: #f8f9fa;
		cursor: pointer;
	}

	.panel-hype-label {
		font-size: 10px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #5f6368;
	}

	.panel-hype-value {
		font-size: 12px;
		line-height: 1.3;
		color: #202124;
		word-break: break-word;
	}

	.panel-hype-notes {
		margin: 0.5rem 0 0;
		font-size: 11px;
		line-height: 1.35;
		color: #3c4043;
	}

	.panel-hype-notes .panel-hype-label {
		margin-right: 0.375rem;
	}

	.panel-form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}

	.panel-field--full {
		grid-column: 1 / -1;
	}

	.panel-station-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.375rem;
		margin-top: 0.25rem;
	}

	.panel-station-item {
		display: grid;
		gap: 0.25rem;
		padding: 0.375rem 0.5rem;
		border: 1px solid #dadce0;
		border-radius: 6px;
		background: #fff;
	}

	.panel-station-name {
		font-size: 11px;
		font-weight: 500;
		color: #202124;
	}

	.panel-station-select {
		width: 100%;
		font-size: 11px;
		padding: 0.25rem 0.375rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		background: #fff;
	}

	.panel-station-empty {
		margin: 0;
		font-size: 11px;
		color: #5f6368;
	}

	.panel-section--availability {
		margin-top: 0.625rem;
		padding-top: 0.625rem;
		border-top: 1px solid #e8eaed;
	}

	.panel-section--availability h3 {
		margin: 0 0 0.375rem;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #5f6368;
	}

	.avail-legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		margin-bottom: 0.5rem;
		font-size: 10px;
		color: #5f6368;
	}

	.avail-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.avail-legend-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 2px;
	}

	.avail-legend-hint {
		color: #80868b;
	}

	.avail-days {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: 120px;
		overflow-y: auto;
		padding-right: 0.125rem;
	}

	.avail-day-header {
		margin-bottom: 0.25rem;
		font-size: 10px;
		font-weight: 600;
		color: #3c4043;
	}

	.avail-slots {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.avail-chip {
		padding: 0.125rem 0.375rem;
		border: 1px solid #dadce0;
		border-radius: 3px;
		background: #fff;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		line-height: 1.4;
	}

	.avail-chip--t1 {
		background: #e6f4ea;
		border-color: #34a853;
		color: #137333;
	}

	.avail-chip--t2 {
		background: #fef7e0;
		border-color: #fbbc04;
		color: #b06000;
	}

	.avail-chip--t3 {
		background: #fce8e6;
		border-color: #ea4335;
		color: #c5221f;
	}

	.avail-chip--event {
		box-shadow: 0 0 0 2px #1a73e8;
	}

	.avail-chip:hover {
		filter: brightness(0.97);
	}

	.panel-issues {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.panel-issue {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		border-radius: 4px;
		font-size: 11px;
		line-height: 1.35;
	}

	.panel-issue--error {
		background: #fce8e6;
		color: #c5221f;
	}

	.panel-issue--warning {
		background: #fef7e0;
		color: #b06000;
	}

	.panel-issue--info {
		background: #e8f0fe;
		color: #1967d2;
	}

	.tier-buttons--compact .tier-btn {
		width: auto;
		min-width: 1.75rem;
		padding: 0 0.375rem;
		height: 1.5rem;
		font-size: 10px;
	}

	.tier-buttons {
		display: flex;
		gap: 0.25rem;
	}

	.tier-btn {
		width: 1.625rem;
		height: 1.625rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		background: #fff;
		font-size: 11px;
		cursor: pointer;
	}

	.tier-btn--active {
		background: color-mix(in srgb, var(--tier-color) 18%, white);
		border-color: var(--tier-color);
		color: var(--tier-color);
		font-weight: 600;
	}

	.panel-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}

	.panel-field span {
		font-size: 11px;
		color: #5f6368;
	}

	.panel-field select {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		font-size: 12px;
		font-family: inherit;
		box-sizing: border-box;
	}

	.panel-validation {
		margin-top: 0.25rem;
		padding: 0.5rem;
		border-radius: 4px;
		background: #fef7e0;
		color: #b06000;
		font-size: 11px;
	}

	.panel-validation--error {
		background: #fce8e6;
		color: #c5221f;
	}

	.panel-validation--warning {
		background: #fef7e0;
		color: #b06000;
	}

	.panel-validation--info {
		background: #e8f0fe;
		color: #1967d2;
	}

	.panel-actions {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.875rem;
		padding-top: 0.875rem;
		border-top: 1px solid #e8eaed;
	}

	.panel-lock-state {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: 1 0 100%;
		padding: 0.5rem 0.625rem;
		border: 1px solid #dadce0;
		border-radius: 6px;
		background: #f8f9fa;
		color: #5f6368;
		font-size: 12px;
	}

	.panel-lock-state--locked {
		border-color: #f9ab00;
		background: #fef7e0;
		color: #b06000;
	}

	.panel-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		border: 1px solid #dadce0;
		border-radius: 4px;
		background: #fff;
		font-size: 12px;
		cursor: pointer;
	}

	.panel-btn:hover {
		background: #f8f9fa;
	}

	.panel-btn--primary {
		background: #1a73e8;
		border-color: #1a73e8;
		color: #fff;
	}

	.panel-btn--primary:hover {
		background: #1765cc;
	}

	.panel-btn--danger {
		color: #c5221f;
		border-color: #f5c2c0;
		margin-right: auto;
	}

	.panel-btn--danger:hover {
		background: #fce8e6;
	}

	.panel-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
