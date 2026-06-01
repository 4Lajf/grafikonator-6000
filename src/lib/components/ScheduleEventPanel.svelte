<script>
	import {
		getPersonAvailabilityGrid,
		updateSchedule,
		createSchedule,
		setAvailability,
		validateScheduleMove,
		validateEventPlacement,
		deleteSchedule,
		TIER_OPTIONS
	} from '$lib/database.js';
	import { toast } from 'svelte-sonner';
	import { CircleAlert, TriangleAlert, X, Pencil, Trash2 } from 'lucide-svelte';

	let {
		schedule = null,
		unscheduledEvent = null,
		anchorRect = null,
		convention = null,
		rooms = [],
		timeSlots = [],
		issues = [],
		onclose = () => {},
		onsaved = () => {}
	} = $props();

	let loading = $state(true);
	let saving = $state(false);
	let editingSchedule = $state(false);
	let availabilityGrid = $state([]);
	let slotTiers = $state({});
	let scheduleForm = $state(null);
	let validationMessage = $state('');

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
	const hostId = $derived(
		schedule?.hosts?.[0]?.id ?? unscheduledEvent?.hosts?.[0]?.id ?? null
	);
	const panelTitle = $derived(schedule?.event?.title ?? unscheduledEvent?.title ?? '');
	const panelDuration = $derived(
		schedule?.event?.duration_minutes ?? unscheduledEvent?.duration_minutes ?? 0
	);
	const panelOrganizerNotes = $derived(
		schedule?.event?.organizer_notes ?? unscheduledEvent?.organizer_notes ?? ''
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
	const isDirty = $derived(tiersDirty || scheduleDirty);

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

	function initForms(grid = availabilityGrid) {
		const allSlots = grid.flatMap((day) => day.slots);
		slotTiers = Object.fromEntries(allSlots.map((slot) => [slot.id, slot.tier]));
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
		const validation = unscheduledEvent
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
		validationMessage = validation.valid
			? validation.warning || ''
			: validation.reason || 'Konflikt w grafiku';
	}

	async function handleSave() {
		if (!schedule && !unscheduledEvent) return;
		saving = true;
		try {
			if (scheduleDirty) {
				if (unscheduledEvent) {
					await createSchedule({
						event_id: unscheduledEvent.id,
						room_id: scheduleForm.room_id,
						start_time_slot_id: scheduleForm.start_time_slot_id,
						slot_count: slotCount
					});
				} else {
					await updateSchedule(schedule.id, {
						room_id: scheduleForm.room_id,
						start_time_slot_id: scheduleForm.start_time_slot_id,
						slot_count: schedule.slot_count
					});
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

			toast.success(unscheduledEvent && scheduleDirty ? 'Zaplanowano atrakcję' : 'Zapisano zmiany');
			editingSchedule = false;
			onsaved({
				scheduleChanged: scheduleDirty,
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
			await deleteSchedule(schedule.id);
			toast.success('Usunięto z grafiku');
			onsaved({ scheduleChanged: true });
			onclose();
		} catch (error) {
			toast.error('Błąd usuwania', { description: error.message });
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

	<div class="event-panel" style={panelStyle} role="dialog" aria-label="Szczegóły atrakcji">
		<header class="panel-header">
			<div class="panel-header-text">
				<h2>{panelTitle}</h2>
				<p>
					{#if schedule}
						{formatTime(schedule.start_slot?.start_time)}–{getEndTime()} · {schedule.room?.name}
					{:else}
						Niezaplanowane · {panelDuration} min
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
									{:else}
										<TriangleAlert size={14} />
									{/if}
									<span>{issue.message}</span>
								</div>
							{/each}
						</div>
					</section>
				{/if}

				<section class="panel-section">
					<h3>Atrakcja</h3>
					<dl class="panel-dl">
						<div><dt>Pseudonim</dt><dd>{schedule?.host_name || unscheduledEvent?.host_name || schedule?.hosts?.[0]?.display_name || unscheduledEvent?.hosts?.[0]?.display_name || '—'}</dd></div>
						<div><dt>Tytuł</dt><dd>{panelTitle}</dd></div>
						<div><dt>Czas trwania</dt><dd>{panelDuration} min</dd></div>
						{#if panelOrganizerNotes?.trim()}
							<div><dt>Notatki organizatora</dt><dd>{panelOrganizerNotes}</dd></div>
						{/if}
					</dl>
				</section>

				{#if hostId && availabilityGrid.length > 0}
					<section class="panel-section">
						<h3>Dyspozycyjność</h3>
						<div class="tier-days">
							{#each availabilityGrid as day}
								<div class="tier-day">
									<div class="tier-day-header">{formatDate(day.date)}</div>
									<div class="tier-grid">
										{#each day.slots as slot}
											<div class="tier-entry" class:tier-entry--event={eventSlotIds.has(slot.id)}>
												<div class="tier-row">
													<span class="tier-row-time">
														{formatTime(slot.start_time)}–{formatTime(slot.end_time)}
													</span>
													<div class="tier-buttons">
														{#each TIER_OPTIONS as tier}
															<button
																type="button"
																class="tier-btn"
																class:tier-btn--active={Number(slotTiers[slot.id]) === tier.value}
																style="--tier-color:{tier.value === 1 ? '#34a853' : tier.value === 2 ? '#fbbc04' : '#ea4335'}"
																title={tier.label}
																onclick={() => setSlotTier(slot.id, tier.value)}
															>
																{tier.value}
															</button>
														{/each}
													</div>
												</div>
												<div class="tier-label">
													{TIER_OPTIONS.find((t) => t.value === Number(slotTiers[slot.id]))?.label || '—'}
												</div>
											</div>
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
							<div class="panel-validation">{validationMessage}</div>
						{/if}
					</section>
				{/if}

				<div class="panel-actions">
					{#if schedule}
						<button class="panel-btn panel-btn--danger" onclick={handleDelete}>
							<Trash2 size={14} /> Usuń
						</button>
					{/if}
					{#if !editingSchedule}
						<button
							class="panel-btn"
							onclick={() => {
								editingSchedule = true;
								previewScheduleEdit();
							}}
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

	.panel-dl {
		display: grid;
		gap: 0.375rem;
	}

	.panel-dl div {
		display: grid;
		grid-template-columns: 6.5rem 1fr;
		gap: 0.5rem;
		align-items: start;
	}

	.panel-dl dt {
		margin: 0;
		font-size: 11px;
		color: #5f6368;
	}

	.panel-dl dd {
		margin: 0;
		font-size: 12px;
		line-height: 1.35;
		word-break: break-word;
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

	.tier-days {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-height: 240px;
		overflow-y: auto;
		padding-right: 0.125rem;
	}

	.tier-day-header {
		margin-bottom: 0.375rem;
		font-size: 11px;
		font-weight: 600;
		color: #3c4043;
	}

	.tier-entry {
		padding: 0.25rem 0;
	}

	.tier-entry + .tier-entry {
		border-top: 1px solid #f1f3f4;
	}

	.tier-entry--event {
		margin: 0 -0.375rem;
		padding: 0.25rem 0.375rem;
		border-radius: 4px;
		background: #e8f0fe;
		border-top: none;
	}

	.tier-entry--event + .tier-entry {
		border-top: 1px solid #f1f3f4;
	}

	.tier-grid {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.tier-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.tier-row-time {
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: #3c4043;
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

	.tier-label {
		margin-top: -0.25rem;
		font-size: 10px;
		color: #5f6368;
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

	.panel-actions {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.875rem;
		padding-top: 0.875rem;
		border-top: 1px solid #e8eaed;
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
