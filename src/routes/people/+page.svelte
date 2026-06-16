<script>
	import { onMount } from 'svelte';
	import {
		getConventions,
		getPeople,
		getPersonWithDetails,
		getPersonAvailabilityGrid,
		getAvailability,
		getRooms,
		getTimeSlots,
		updatePerson,
		deletePerson,
		createEvent,
		updateEvent,
		deleteEvent,
		setAvailability,
		TIER_OPTIONS,
		EVENT_TIER_OPTIONS
	} from '$lib/database.js';
	import Button from '$lib/components/ui/button/button.svelte';
	import ColorPicker from '$lib/components/ColorPicker.svelte';
	import Card from '$lib/components/ui/card/card.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { toast } from 'svelte-sonner';

	let convention = $state(null);
	let people = $state([]);
	let rooms = $state([]);
	let timeSlots = $state([]);
	let allAvailability = $state([]);
	let loading = $state(true);
	let selectedSummary = $state(true);
	let selectedPerson = $state(null);
	let personDetails = $state(null);
	let availabilityGrid = $state([]);
	let saving = $state(false);

	let editingPerson = $state(null);
	let editingEvent = $state(null);
	let newEvent = $state(null);

	onMount(async () => {
		await loadData();
	});

	const STATION_PREFERENCE_OPTIONS = [
		{ value: 1, label: 'Chcę' },
		{ value: 2, label: 'Obojętnie' },
		{ value: 3, label: 'Nie chcę' }
	];

	const slotsByDay = $derived.by(() => {
		const grouped = new Map();
		for (const slot of timeSlots) {
			if (!grouped.has(slot.date)) grouped.set(slot.date, []);
			grouped.get(slot.date).push(slot);
		}
		return [...grouped.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([date, slots]) => ({
				date,
				slots: slots.sort((a, b) => a.start_time.localeCompare(b.start_time))
			}));
	});

	const availabilityByPersonSlot = $derived(
		new Map(allAvailability.map((entry) => [`${entry.person_id}|${entry.time_slot_id}`, entry.tier]))
	);

	function stationPreferenceForPerson(person, stationName) {
		return Number(person.tag_preferences?.[stationName] ?? 2);
	}

	function stationPreferenceLabel(tier) {
		return STATION_PREFERENCE_OPTIONS.find((option) => option.value === Number(tier))?.label ?? 'Obojętnie';
	}

	function availabilityTierFor(personId, slotId) {
		return Number(availabilityByPersonSlot.get(`${personId}|${slotId}`) ?? 1);
	}

	function tierMark(tier) {
		const value = Number(tier);
		if (value === 1) return 'x';
		if (value === 2) return 'o';
		return '-';
	}

	function nextPreferenceTier(tier) {
		const current = Number(tier ?? 2);
		return current === 3 ? 1 : current + 1;
	}

	function updateStationPreference(stationName, value) {
		if (!editingPerson) return;
		editingPerson = {
			...editingPerson,
			tag_preferences: {
				...editingPerson.tag_preferences,
				[stationName]: Number(value)
			}
		};
	}

	async function loadData() {
		loading = true;
		try {
			const { active } = await getConventions();
			if (!active) {
				convention = null;
				return;
			}
			convention = active;
			[people, rooms, timeSlots, allAvailability] = await Promise.all([
				getPeople(convention.id),
				getRooms(convention.id),
				getTimeSlots(convention.id),
				getAvailability(convention.id)
			]);
		} catch (error) {
			toast.error('Błąd ładowania', { description: error.message });
		} finally {
			loading = false;
		}
	}

	async function selectPerson(person) {
		selectedSummary = false;
		selectedPerson = person;
		editingPerson = null;
		editingEvent = null;
		newEvent = null;
		try {
			personDetails = await getPersonWithDetails(person.id);
			availabilityGrid = await getPersonAvailabilityGrid(person.id, convention.id);
		} catch (error) {
			toast.error('Błąd ładowania szczegółów', { description: error.message });
		}
	}

	function selectSummary() {
		selectedSummary = true;
		selectedPerson = null;
		personDetails = null;
		availabilityGrid = [];
		editingPerson = null;
		editingEvent = null;
		newEvent = null;
	}

	function startEditPerson() {
		editingPerson = {
			display_name: personDetails.display_name,
			notes: personDetails.notes || '',
			min_blocks: personDetails.min_blocks ?? '',
			max_blocks: personDetails.max_blocks ?? '',
			color: personDetails.color || '',
			conflict_tags: (personDetails.conflict_tags || []).join(', '),
			co_schedule_tags: (personDetails.co_schedule_tags || []).join(', '),
			tag_preferences: { ...(personDetails.tag_preferences || {}) }
		};
	}

	async function savePerson() {
		saving = true;
		try {
			await updatePerson(selectedPerson.id, editingPerson);
			toast.success('Zapisano zmiany');
			await loadData();
			await selectPerson({ ...selectedPerson, ...editingPerson });
			editingPerson = null;
		} catch (error) {
			toast.error('Błąd zapisu', { description: error.message });
		} finally {
			saving = false;
		}
	}

	async function handleDeletePerson() {
		if (!confirm(`Usunąć ${selectedPerson.display_name}? Najpierw musisz usunąć wszystkie atrakcje tej osoby.`)) return;
		saving = true;
		try {
			await deletePerson(selectedPerson.id);
			toast.success('Usunięto osobę');
			selectSummary();
			await loadData();
		} catch (error) {
			toast.error('Błąd usuwania', { description: error.message });
		} finally {
			saving = false;
		}
	}

	function startEditEvent(event) {
		editingEvent = {
			id: event.id,
			title: event.title,
			duration_minutes: event.duration_minutes,
			organizer_notes: event.organizer_notes || '',
			tier: event.tier ?? 2
		};
	}

	async function saveEvent() {
		saving = true;
		try {
			await updateEvent(editingEvent.id, {
				title: editingEvent.title,
				duration_minutes: editingEvent.duration_minutes,
				organizer_notes: editingEvent.organizer_notes,
				tier: editingEvent.tier
			});
			toast.success('Zapisano atrakcję');
			await selectPerson(selectedPerson);
			editingEvent = null;
		} catch (error) {
			toast.error('Błąd zapisu', { description: error.message });
		} finally {
			saving = false;
		}
	}

	async function handleDeleteEvent(eventId) {
		if (!confirm('Usunąć tę atrakcję?')) return;
		saving = true;
		try {
			await deleteEvent(eventId);
			toast.success('Usunięto atrakcję');
			await selectPerson(selectedPerson);
		} catch (error) {
			toast.error('Błąd usuwania', { description: error.message });
		} finally {
			saving = false;
		}
	}

	function startNewEvent() {
		newEvent = {
			title: '',
			duration_minutes: 60,
			tier: 2
		};
	}

	async function saveNewEvent() {
		if (!newEvent.title.trim()) {
			toast.error('Podaj tytuł atrakcji');
			return;
		}
		saving = true;
		try {
			await createEvent(convention.id, selectedPerson.id, newEvent);
			toast.success('Dodano atrakcję');
			await selectPerson(selectedPerson);
			newEvent = null;
		} catch (error) {
			toast.error('Błąd zapisu', { description: error.message });
		} finally {
			saving = false;
		}
	}

	async function handleTierChange(slotId, newTier) {
		try {
			await setAvailability(selectedPerson.id, slotId, newTier);
			[availabilityGrid, allAvailability] = await Promise.all([
				getPersonAvailabilityGrid(selectedPerson.id, convention.id),
				getAvailability(convention.id)
			]);
		} catch (error) {
			toast.error('Błąd zapisu dyspozycyjności', { description: error.message });
		}
	}

	async function handleOverviewTierChange(personId, slotId) {
		const current = availabilityTierFor(personId, slotId);
		const next = current === 3 ? 1 : current + 1;
		try {
			await setAvailability(personId, slotId, next);
			allAvailability = await getAvailability(convention.id);
			if (selectedPerson?.id === personId) {
				availabilityGrid = await getPersonAvailabilityGrid(personId, convention.id);
			}
		} catch (error) {
			toast.error('Błąd zapisu dyspozycyjności', { description: error.message });
		}
	}

	async function handlePreferenceTileChange(person, stationName) {
		const nextPreferences = {
			...(person.tag_preferences || {}),
			[stationName]: nextPreferenceTier(person.tag_preferences?.[stationName])
		};
		try {
			await updatePerson(person.id, { tag_preferences: nextPreferences });
			people = people.map((entry) =>
				entry.id === person.id ? { ...entry, tag_preferences: nextPreferences } : entry
			);
			if (personDetails?.id === person.id) {
				personDetails = { ...personDetails, tag_preferences: nextPreferences };
			}
			if (selectedPerson?.id === person.id) {
				selectedPerson = { ...selectedPerson, tag_preferences: nextPreferences };
			}
			if (editingPerson && selectedPerson?.id === person.id) {
				editingPerson = { ...editingPerson, tag_preferences: nextPreferences };
			}
		} catch (error) {
			toast.error('Błąd zapisu preferencji', { description: error.message });
		}
	}

	function formatTime(time) {
		return time?.slice(0, 5) || '';
	}

	function formatDate(dateStr) {
		const date = new Date(dateStr + 'T00:00:00');
		return date.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });
	}

	function getTierClass(tier) {
		if (tier === 1) return 'g-tier-1 hover:brightness-95';
		if (tier === 2) return 'g-tier-2 hover:brightness-95';
		return 'g-tier-3 hover:brightness-95';
	}

	function getStationPreferenceClass(tier) {
		if (Number(tier) === 1) return 'g-tier-1 hover:brightness-95';
		if (Number(tier) === 3) return 'g-tier-3 hover:brightness-95';
		return 'bg-[#e8f0fe] text-[#1967d2] hover:brightness-95';
	}
</script>

<div class="g-page">
	<header class="g-page-header">
		<h1 class="g-page-title">{convention?.schedule_mode === 'people' ? 'Osoby' : 'Osoby i atrakcje'}</h1>
		<p class="g-page-subtitle">
			{convention?.schedule_mode === 'people'
				? 'Edytuj limity godzin, tagi, kolory i dyspozycyjność osób przed planowaniem grafiku.'
				: 'Edytuj pseudonimy, atrakcje i dyspozycyjność prowadzących przed planowaniem grafiku.'}
		</p>
	</header>

	{#if loading}
		<div class="py-12 text-center text-muted-foreground">Ładowanie…</div>
	{:else if !convention}
		<Card class="p-8 text-center">
			<h2 class="g-section-title mb-2">Brak konwentu</h2>
			<p class="mb-4 text-muted-foreground">Wgraj CSV w konfiguracji.</p>
			<Button href="/setup">Przejdź do importu</Button>
		</Card>
	{:else}
		<div class="flex gap-6">
			<aside class="w-64 shrink-0">
				<Card class="p-4">
					<h2 class="g-section-title mb-3">Osoby ({people.length})</h2>
					<div class="max-h-[70vh] space-y-1 overflow-y-auto">
						{#if convention.schedule_mode === 'people'}
							<button
								class="g-sidebar-link"
								class:g-sidebar-link--active={selectedSummary}
								onclick={selectSummary}
							>
								Podsumowanie
							</button>
						{/if}
						{#each people as person}
							<button
								class="g-sidebar-link"
								class:g-sidebar-link--active={selectedPerson?.id === person.id}
								onclick={() => selectPerson(person)}
							>
								{person.display_name}
							</button>
						{/each}
						{#if people.length === 0}
							<p class="text-sm text-muted-foreground">Brak osób</p>
						{/if}
					</div>
				</Card>
			</aside>

			<main class="flex-1 min-w-0 space-y-6">
				{#if convention.schedule_mode === 'people' && selectedSummary}
					<Card class="p-6">
						<div class="mb-4">
							<h3 class="g-section-title">Dyspozycyjność wszystkich osób</h3>
							<p class="text-sm text-muted-foreground">
								Kliknij komórkę, aby zmienić: x = mogę, o = obojętnie, - = nie mogę.
							</p>
						</div>
						<div class="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
							<span class="flex items-center gap-1"><span class="g-tier-1 h-3 w-3 rounded"></span> x Mogę</span>
							<span class="flex items-center gap-1"><span class="g-tier-2 h-3 w-3 rounded"></span> o Obojętnie</span>
							<span class="flex items-center gap-1"><span class="g-tier-3 h-3 w-3 rounded"></span> - Nie mogę</span>
						</div>
						<div class="max-h-[60vh] overflow-auto rounded-lg border border-border">
							<table class="min-w-max border-collapse text-xs">
								<thead class="sticky top-0 z-10 bg-white">
									<tr>
										<th class="sticky left-0 z-20 border-b border-r border-border bg-white px-3 py-2 text-left font-medium">
											Slot
										</th>
										{#each people as person}
											<th class="border-b border-r border-border px-3 py-2 text-center font-medium">
												<button
													type="button"
													class="whitespace-nowrap hover:underline"
													onclick={() => selectPerson(person)}
												>
													{person.display_name}
												</button>
											</th>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each slotsByDay as day}
										<tr>
											<th
												class="sticky left-0 z-10 border-b border-r border-border bg-muted px-3 py-2 text-left font-medium capitalize"
												colspan={people.length + 1}
											>
												{formatDate(day.date)}
											</th>
										</tr>
										{#each day.slots as slot}
											<tr>
												<th class="sticky left-0 z-10 border-b border-r border-border bg-white px-3 py-1.5 text-left font-medium tabular-nums">
													{formatTime(slot.start_time)}–{formatTime(slot.end_time)}
												</th>
												{#each people as person}
													{@const tier = availabilityTierFor(person.id, slot.id)}
													<td class="border-b border-r border-border p-0 text-center">
														<button
															type="button"
															class="block w-full px-3 py-1.5 font-semibold tabular-nums {getTierClass(tier)}"
															title="{person.display_name}, {formatTime(slot.start_time)}–{formatTime(slot.end_time)}"
															onclick={() => handleOverviewTierChange(person.id, slot.id)}
														>
															{tierMark(tier)}
														</button>
													</td>
												{/each}
											</tr>
										{/each}
									{/each}
								</tbody>
							</table>
						</div>
					</Card>

					<Card class="p-6">
						<div class="mb-4">
							<h3 class="g-section-title">Preferencje stanowisk</h3>
							<p class="text-sm text-muted-foreground">
								Tabela pokazuje preferencje zaimportowane lub ustawione w edytorze osoby.
							</p>
						</div>
						<div class="overflow-auto rounded-lg border border-border">
							<table class="min-w-max border-collapse text-xs">
								<thead class="bg-white">
									<tr>
										<th class="sticky left-0 z-10 border-b border-r border-border bg-white px-3 py-2 text-left font-medium">
											Osoba
										</th>
										{#each rooms as room}
											<th class="border-b border-r border-border px-3 py-2 text-center font-medium">
												{room.name}
											</th>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each people as person}
										<tr>
											<th class="sticky left-0 z-10 border-b border-r border-border bg-white px-3 py-1.5 text-left font-medium">
												<button type="button" class="hover:underline" onclick={() => selectPerson(person)}>
													{person.display_name}
												</button>
											</th>
											{#each rooms as room}
												{@const tier = stationPreferenceForPerson(person, room.name)}
												<td class="border-b border-r border-border p-1 text-center">
													<button
														type="button"
														class="inline-flex min-w-24 justify-center rounded px-2 py-1 transition {getStationPreferenceClass(tier)}"
														title="{person.display_name}, {room.name}: kliknij, aby zmienić"
														onclick={() => handlePreferenceTileChange(person, room.name)}
													>
														{stationPreferenceLabel(tier)}
													</button>
												</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</Card>

				{:else if !selectedPerson}
					<Card class="p-8 text-center text-muted-foreground">
						Wybierz osobę z listy po lewej stronie, aby edytować jej dane.
					</Card>
				{:else if personDetails}
					<Card class="p-6">
						<div class="flex items-start justify-between mb-4">
							<div>
								<h2 class="text-2xl font-normal text-foreground">{personDetails.display_name}</h2>
								{#if personDetails.notes && !editingPerson}
									<p class="mt-1 text-sm text-muted-foreground">{personDetails.notes}</p>
								{/if}
							</div>
							<div class="flex gap-2">
								{#if editingPerson}
									<Button size="sm" onclick={savePerson} disabled={saving}>Zapisz</Button>
									<Button size="sm" variant="outline" onclick={() => (editingPerson = null)}>Anuluj</Button>
								{:else}
									<Button size="sm" variant="outline" onclick={startEditPerson}>Edytuj dane</Button>
									<Button size="sm" variant="destructive" onclick={handleDeletePerson} disabled={saving}>Usuń osobę</Button>
								{/if}
							</div>
						</div>

						{#if editingPerson}
							<div class="g-surface mt-4 grid grid-cols-2 gap-4">
								<div>
									<Label for="edit-name">Pseudonim</Label>
									<Input id="edit-name" bind:value={editingPerson.display_name} />
								</div>
								<div class="col-span-2">
									<Label for="edit-notes">Notatki</Label>
									<textarea
										id="edit-notes"
										class="g-textarea"
										rows="2"
										bind:value={editingPerson.notes}
									></textarea>
								</div>
								<div>
									<Label for="edit-min">Min. slotów</Label>
									<Input id="edit-min" type="number" min="0" bind:value={editingPerson.min_blocks} />
								</div>
								<div>
									<Label for="edit-max">Maks. slotów</Label>
									<Input id="edit-max" type="number" min="0" bind:value={editingPerson.max_blocks} />
								</div>
								<div>
									<Label for="edit-color">Kolor</Label>
									<ColorPicker id="edit-color" bind:value={editingPerson.color} />
								</div>
								<div>
									<Label for="edit-conflict-tags">Tagi wykluczające</Label>
									<Input id="edit-conflict-tags" bind:value={editingPerson.conflict_tags} />
								</div>
								<div class="col-span-2">
									<Label for="edit-co-tags">Tagi wspólnego slotu</Label>
									<Input id="edit-co-tags" bind:value={editingPerson.co_schedule_tags} />
								</div>
								<div class="col-span-2">
									<Label>Preferencje stanowisk</Label>
									<div class="mt-2 grid gap-2 md:grid-cols-2">
										{#each rooms as room}
											<label class="rounded border border-border bg-white p-2 text-sm">
												<span class="mb-1 block font-medium text-foreground">{room.name}</span>
												<select
													class="g-select"
													value={stationPreferenceForPerson(editingPerson, room.name)}
													onchange={(event) =>
														updateStationPreference(room.name, event.currentTarget.value)}
												>
													{#each STATION_PREFERENCE_OPTIONS as option}
														<option value={option.value}>{option.label}</option>
													{/each}
												</select>
											</label>
										{:else}
											<p class="text-sm text-muted-foreground">
												Dodaj stanowiska w zakładce Konwent, żeby przypisać preferencje.
											</p>
										{/each}
									</div>
								</div>
							</div>
						{/if}
					</Card>

					{#if convention.schedule_mode !== 'people'}
					<Card class="p-6">
						<div class="flex items-center justify-between mb-4">
							<h3 class="g-section-title">Atrakcje ({personDetails.events.length})</h3>
							<Button size="sm" variant="outline" onclick={startNewEvent}>+ Dodaj atrakcję</Button>
						</div>

						{#if newEvent}
							<div class="g-surface-accent mb-4 space-y-3">
								<h4 class="font-medium">Nowa atrakcja</h4>
								<div class="grid grid-cols-2 gap-3">
									<div class="col-span-2">
										<Label for="new-title">Tytuł</Label>
										<Input id="new-title" bind:value={newEvent.title} />
									</div>
									<div>
										<Label for="new-duration">Czas trwania (min)</Label>
										<Input id="new-duration" type="number" min="1" bind:value={newEvent.duration_minutes} />
									</div>
									<div>
										<Label for="new-tier">Tier atrakcji</Label>
										<select id="new-tier" class="g-select" bind:value={newEvent.tier}>
											{#each EVENT_TIER_OPTIONS as tier}
												<option value={tier.value}>{tier.label}</option>
											{/each}
										</select>
									</div>
								</div>
								<div class="flex gap-2">
									<Button size="sm" onclick={saveNewEvent} disabled={saving}>Dodaj</Button>
									<Button size="sm" variant="outline" onclick={() => (newEvent = null)}>Anuluj</Button>
								</div>
							</div>
						{/if}

						<div class="space-y-3">
							{#each personDetails.events as event}
								{#if editingEvent?.id === event.id}
									<div class="g-surface-warn space-y-3">
										<div class="grid grid-cols-2 gap-3">
											<div class="col-span-2">
												<Label for="edit-title">Tytuł</Label>
												<Input id="edit-title" bind:value={editingEvent.title} />
											</div>
											<div>
												<Label for="edit-duration">Czas trwania (min)</Label>
												<Input id="edit-duration" type="number" min="1" bind:value={editingEvent.duration_minutes} />
											</div>
											<div>
												<Label for="edit-tier">Tier atrakcji</Label>
												<select id="edit-tier" class="g-select" bind:value={editingEvent.tier}>
													{#each EVENT_TIER_OPTIONS as tier}
														<option value={tier.value}>{tier.label}</option>
													{/each}
												</select>
											</div>
											<div class="col-span-2">
												<Label for="edit-org-notes">Notatki organizatora</Label>
												<textarea id="edit-org-notes" class="g-textarea" rows="2" bind:value={editingEvent.organizer_notes}></textarea>
											</div>
										</div>
										<div class="flex gap-2">
											<Button size="sm" onclick={saveEvent} disabled={saving}>Zapisz</Button>
											<Button size="sm" variant="outline" onclick={() => (editingEvent = null)}>Anuluj</Button>
										</div>
									</div>
								{:else}
									<div class="g-surface">
										<div class="flex items-start justify-between">
											<div>
												<h4 class="font-medium">{event.title}</h4>
												<p class="text-sm text-muted-foreground">
													{event.duration_minutes} min
													· T{event.tier ?? 2}
													{#if event.kind}· {event.kind}{/if}
													{#if event.adult_content}· <span class="text-destructive">18+</span>{/if}
												</p>
												{#if event.description}
													<p class="mt-1 text-sm text-muted-foreground">{event.description}</p>
												{/if}
												{#if event.schedule}
													<p class="mt-1 text-xs text-[#137333]">
														Zaplanowane: {event.schedule.room_name}, {event.schedule.date} {formatTime(event.schedule.start_time)}
													</p>
												{:else}
													<p class="mt-1 text-xs text-[#b06000]">Do zaplanowania</p>
												{/if}
											</div>
											<div class="flex gap-2">
												<Button size="sm" variant="outline" onclick={() => startEditEvent(event)}>Edytuj</Button>
												<Button size="sm" variant="outline" onclick={() => handleDeleteEvent(event.id)}>Usuń</Button>
											</div>
										</div>
									</div>
								{/if}
							{/each}
							{#if personDetails.events.length === 0}
								<p class="text-sm text-muted-foreground">Brak atrakcji</p>
							{/if}
						</div>
					</Card>
					{/if}

					<Card class="p-6">
						<div class="mb-4">
							<h3 class="g-section-title">Dyspozycyjność</h3>
						</div>

						<div class="mb-3 flex gap-4 text-xs text-muted-foreground">
							<span class="flex items-center gap-1"><span class="g-tier-1 h-3 w-3 rounded"></span> Mogę</span>
							<span class="flex items-center gap-1"><span class="g-tier-2 h-3 w-3 rounded"></span> Wolę nie</span>
							<span class="flex items-center gap-1"><span class="g-tier-3 h-3 w-3 rounded"></span> Nie mogę</span>
							<span class="text-muted-foreground/70">Kliknij slot, aby zmienić</span>
						</div>

						{#if convention.schedule_mode === 'people'}
							<div class="mb-5 rounded-lg border border-border bg-muted/20 p-3">
								<h4 class="mb-2 text-sm font-medium">Preferencje stanowisk tej osoby</h4>
								<div class="flex flex-wrap gap-2">
									{#each rooms as room}
										{@const tier = stationPreferenceForPerson(personDetails, room.name)}
										<span class="inline-flex items-center gap-2 rounded border border-border bg-white p-1 text-xs">
											<span class="font-medium text-foreground">{room.name}</span>
											<button
												type="button"
												class="rounded px-2 py-0.5 transition {getStationPreferenceClass(tier)}"
												title="{room.name}: kliknij, aby zmienić"
												onclick={() => handlePreferenceTileChange(personDetails, room.name)}
											>
												{stationPreferenceLabel(tier)}
											</button>
										</span>
									{:else}
										<span class="text-sm text-muted-foreground">
											Brak stanowisk. Dodaj je w zakładce Konwent.
										</span>
									{/each}
								</div>
							</div>
						{/if}

						<div class="space-y-4">
							{#each availabilityGrid as day}
								<div>
									<h4 class="mb-2 font-medium text-sm">{formatDate(day.date)}</h4>
									<div class="flex flex-wrap gap-1">
										{#each day.slots as slot}
											<button
												class="text-xs px-2 py-1 rounded {getTierClass(slot.tier)} transition-colors"
												onclick={() => handleTierChange(slot.id, slot.tier === 3 ? 1 : slot.tier + 1)}
												title="{formatTime(slot.start_time)}–{formatTime(slot.end_time)}: {TIER_OPTIONS.find(t => t.value === slot.tier)?.label}"
											>
												{formatTime(slot.start_time)}
											</button>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</Card>
				{/if}
			</main>
		</div>
	{/if}
</div>
