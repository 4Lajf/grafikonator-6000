<script>
	import { onMount } from 'svelte';
	import {
		getConventions,
		getPeople,
		getPersonWithDetails,
		getPersonAvailabilityGrid,
		createPerson,
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
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import Card from '$lib/components/ui/card/card.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { toast } from 'svelte-sonner';

	let convention = $state(null);
	let people = $state([]);
	let loading = $state(true);
	let selectedPerson = $state(null);
	let personDetails = $state(null);
	let availabilityGrid = $state([]);
	let saving = $state(false);

	let editingPerson = $state(null);
	let editingEvent = $state(null);
	let newEvent = $state(null);
	let newPerson = $state(null);
	let showDeletePersonDialog = $state(false);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		loading = true;
		try {
			const { active } = await getConventions();
			if (!active) {
				convention = null;
				return;
			}
			convention = active;
			people = await getPeople(convention.id);
		} catch (error) {
			toast.error('Błąd ładowania', { description: error.message });
		} finally {
			loading = false;
		}
	}

	async function selectPerson(person) {
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

	function startEditPerson() {
		editingPerson = {
			display_name: personDetails.display_name,
			phone: personDetails.phone || '',
			notes: personDetails.notes || ''
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

	function handleDeletePerson() {
		showDeletePersonDialog = true;
	}

	async function confirmDeletePerson() {
		showDeletePersonDialog = false;
		saving = true;
		try {
			await deletePerson(selectedPerson.id);
			toast.success('Usunięto osobę');
			selectedPerson = null;
			personDetails = null;
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

	function startNewPerson() {
		selectedPerson = null;
		personDetails = null;
		availabilityGrid = [];
		editingPerson = null;
		editingEvent = null;
		newEvent = null;
		newPerson = {
			display_name: '',
			phone: '',
			notes: '',
			events: [{ title: '', duration_minutes: 60, tier: 2 }]
		};
	}

	function addNewPersonEvent() {
		newPerson = {
			...newPerson,
			events: [...newPerson.events, { title: '', duration_minutes: 60, tier: 2 }]
		};
	}

	function removeNewPersonEvent(index) {
		if (newPerson.events.length <= 1) return;
		newPerson = {
			...newPerson,
			events: newPerson.events.filter((_, i) => i !== index)
		};
	}

	async function saveNewPerson() {
		const displayName = newPerson.display_name.trim();
		if (!displayName) {
			toast.error('Podaj pseudonim osoby');
			return;
		}

		const events = newPerson.events.filter(
			(e) => e.title.trim() && Number(e.duration_minutes) > 0
		);
		const partialEvents = newPerson.events.filter(
			(e) => (e.title.trim() && !(Number(e.duration_minutes) > 0)) || (!e.title.trim() && Number(e.duration_minutes) > 0)
		);
		if (partialEvents.length > 0) {
			toast.error('Uzupełnij tytuł i czas trwania każdej atrakcji');
			return;
		}

		saving = true;
		try {
			const person = await createPerson(convention.id, {
				display_name: displayName,
				phone: newPerson.phone,
				notes: newPerson.notes
			});
			for (const event of events) {
				await createEvent(convention.id, person.id, {
					title: event.title.trim(),
					duration_minutes: Number(event.duration_minutes),
					tier: event.tier
				});
			}
			toast.success(events.length ? 'Dodano osobę z atrakcjami' : 'Dodano osobę');
			newPerson = null;
			await loadData();
			await selectPerson(person);
		} catch (error) {
			toast.error('Błąd zapisu', { description: error.message });
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
			availabilityGrid = await getPersonAvailabilityGrid(selectedPerson.id, convention.id);
		} catch (error) {
			toast.error('Błąd zapisu dyspozycyjności', { description: error.message });
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
</script>

<div class="g-page">
	<header class="g-page-header">
		<h1 class="g-page-title">Osoby i atrakcje</h1>
		<p class="g-page-subtitle">
			Edytuj pseudonimy, atrakcje i dyspozycyjność prowadzących przed planowaniem grafiku.
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
					<div class="mb-3 flex items-center justify-between gap-2">
						<h2 class="g-section-title">Osoby ({people.length})</h2>
						<Button size="sm" variant="outline" onclick={startNewPerson}>+ Osoba</Button>
					</div>
					<div class="max-h-[70vh] space-y-1 overflow-y-auto">
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
				{#if newPerson}
					<Card class="p-6 space-y-4">
						<div class="flex items-center justify-between">
							<h2 class="g-section-title">Nowa osoba</h2>
							<Button size="sm" variant="outline" onclick={() => (newPerson = null)}>Anuluj</Button>
						</div>
						<p class="text-sm text-muted-foreground">
							Dyspozycyjność zostanie ustawiona na „mogę” we wszystkich slotach.
						</p>

						<div class="g-surface grid grid-cols-2 gap-4">
							<div>
								<Label for="new-person-name">Pseudonim</Label>
								<Input id="new-person-name" bind:value={newPerson.display_name} placeholder="np. Kitsu" />
							</div>
							<div>
								<Label for="new-person-phone">Telefon</Label>
								<Input id="new-person-phone" bind:value={newPerson.phone} />
							</div>
							<div class="col-span-2">
								<Label for="new-person-notes">Notatki</Label>
								<textarea
									id="new-person-notes"
									class="g-textarea"
									rows="2"
									bind:value={newPerson.notes}
								></textarea>
							</div>
						</div>

						<div class="space-y-3">
							<h3 class="font-medium">Atrakcje</h3>
							{#each newPerson.events as event, eventIndex}
								<div class="g-surface grid grid-cols-2 gap-3">
									<div class="col-span-2">
										<Label for="new-person-event-title-{eventIndex}">Tytuł</Label>
										<Input
											id="new-person-event-title-{eventIndex}"
											bind:value={event.title}
											placeholder="np. Warsztat origami"
										/>
									</div>
									<div>
										<Label for="new-person-event-duration-{eventIndex}">Czas trwania (min)</Label>
										<Input
											id="new-person-event-duration-{eventIndex}"
											type="number"
											min="1"
											bind:value={event.duration_minutes}
										/>
									</div>
									<div>
										<Label for="new-person-event-tier-{eventIndex}">Tier atrakcji</Label>
										<select
											id="new-person-event-tier-{eventIndex}"
											class="g-select"
											bind:value={event.tier}
										>
											{#each EVENT_TIER_OPTIONS as tier}
												<option value={tier.value}>{tier.label}</option>
											{/each}
										</select>
									</div>
									{#if newPerson.events.length > 1}
										<div class="col-span-2">
											<Button
												size="sm"
												variant="outline"
												onclick={() => removeNewPersonEvent(eventIndex)}
											>
												Usuń atrakcję
											</Button>
										</div>
									{/if}
								</div>
							{/each}
							<Button size="sm" variant="outline" onclick={addNewPersonEvent}>+ Atrakcja</Button>
						</div>

						<div class="flex gap-2">
							<Button onclick={saveNewPerson} disabled={saving}>Dodaj osobę</Button>
							<Button variant="outline" onclick={() => (newPerson = null)} disabled={saving}>
								Anuluj
							</Button>
						</div>
					</Card>
				{:else if !selectedPerson}
					<Card class="p-8 text-center text-muted-foreground">
						Wybierz osobę z listy po lewej stronie albo dodaj nową.
					</Card>
				{:else if personDetails}
					<Card class="p-6">
						<div class="flex items-start justify-between mb-4">
							<div>
								<h2 class="text-2xl font-normal text-foreground">{personDetails.display_name}</h2>
								{#if personDetails.phone}
									<p class="text-sm text-muted-foreground">Tel: {personDetails.phone}</p>
								{/if}
								{#if personDetails.notes}
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
								<div>
									<Label for="edit-phone">Telefon</Label>
									<Input id="edit-phone" bind:value={editingPerson.phone} />
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
							</div>
						{/if}
					</Card>

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
													<p class="mt-1 text-xs text-[#b06000]">Niezaplanowane</p>
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

<AlertDialog.Root bind:open={showDeletePersonDialog}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Usunąć {selectedPerson?.display_name}?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if personDetails?.events?.length}
					{@const eventCount = personDetails.events.length}
					{@const eventLabel =
						eventCount === 1 ? 'atrakcję' : eventCount >= 2 && eventCount <= 4 ? 'atrakcje' : 'atrakcji'}
					Usunięcie tej osoby spowoduje również trwałe usunięcie {eventCount} {eventLabel}.
					{#if personDetails.events.some((event) => event.schedule)}
						Atrakcje wpisane w grafiku zostaną z niego usunięte.
					{/if}
					Tej operacji nie można cofnąć.
				{:else}
					Usunięcie tej osoby jest nieodwracalne. Dyspozycyjność również zostanie usunięta.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Anuluj</AlertDialog.Cancel>
			<AlertDialog.Action
				class={buttonVariants({ variant: 'destructive' })}
				onclick={confirmDeletePerson}
				disabled={saving}
			>
				Usuń osobę
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
