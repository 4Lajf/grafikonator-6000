<script>
	import { onMount } from 'svelte';
	import {
		getImportFields,
		previewImport,
		executeImport,
		createManualConvention
	} from '$lib/database.js';
	import Button from '$lib/components/ui/button/button.svelte';
	import Card from '$lib/components/ui/card/card.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import FileInput from '$lib/components/ui/file-input/file-input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';

	const CSV_STEPS = ['Wgraj', 'Mapowanie', 'Ustawienia', 'Podgląd'];
	const MANUAL_STEPS = ['Ustawienia', 'Osoby i atrakcje', 'Podsumowanie'];

	let mode = $state(null);
	let step = $state(1);
	let csvText = $state('');
	let csvFileName = $state('');
	let appFields = $state([]);
	let headers = $state([]);
	let fieldMappings = $state({});
	let preview = $state(null);
	let editablePeople = $state([]);
	let loading = $state(false);
	let saving = $state(false);

	let conventionConfig = $state({
		name: 'Demo Convention 2026',
		startDate: '2026-09-30',
		endDate: '2026-10-01',
		slotMinutes: 30,
		dayStartHour: 0,
		dayEndHour: 24
	});

	let roomNames = $state(
		'Main Stage\nAuditorium\nWorkshop Room A\nWorkshop Room B'
	);
	let valueMappings = $state({});
	let unmappedHeaders = $state([]);

	let manualEntries = $state([
		{
			display_name: '',
			events: [{ title: '', duration_minutes: 60 }]
		}
	]);

	onMount(async () => {
		const data = await getImportFields();
		appFields = data.fields;
	});

	function parsedRoomNames() {
		return roomNames
			.split('\n')
			.map((r) => r.trim())
			.filter(Boolean);
	}

	function resetFlow(nextMode) {
		mode = nextMode;
		step = 1;
		csvText = '';
		csvFileName = '';
		preview = null;
		editablePeople = [];
		fieldMappings = {};
		manualEntries = [
			{
				display_name: '',
				events: [{ title: '', duration_minutes: 60 }]
			}
		];
	}

	async function handleFileSelect(event) {
		const file = event.target.files?.[0];
		if (!file) return;
		csvFileName = file.name;
		csvText = await file.text();
		await runPreview();
		step = 2;
	}

	async function runPreview() {
		if (!csvText) return;
		loading = true;
		try {
			preview = await previewImport({
				csvText,
				fieldMappings,
				conventionConfig,
				valueMappings,
				roomNames: parsedRoomNames()
			});
			headers = preview.headers;
			if (Object.keys(fieldMappings).length === 0) {
				fieldMappings = preview.fieldMappings;
			}
			unmappedHeaders = preview.unmappedHeaders || [];
		} catch (error) {
			toast.error('Podgląd nieudany', { description: error.message });
		} finally {
			loading = false;
		}
	}

	async function handleImport() {
		if (!validateEditablePreview()) return;
		saving = true;
		try {
			const result = await executeImport({
				csvText,
				fieldMappings,
				conventionConfig,
				valueMappings,
				roomNames: parsedRoomNames(),
				editedPreview: buildEditedPreview()
			});
			toast.success('Import zakończony!', {
				description: `${result.peopleCount} osób, ${result.eventCount} atrakcji, ${result.slotCount} slotów`
			});
			goto('/schedule');
		} catch (error) {
			toast.error('Import nieudany', { description: error.message });
		} finally {
			saving = false;
		}
	}

	async function handleManualSave() {
		saving = true;
		try {
			const result = await createManualConvention({
				conventionConfig,
				roomNames: parsedRoomNames(),
				entries: manualEntries
			});
			toast.success('Konwent zapisany!', {
				description: `${result.peopleCount} osób, ${result.eventCount} atrakcji, ${result.slotCount} slotów`
			});
			goto('/schedule');
		} catch (error) {
			toast.error('Zapis nieudany', { description: error.message });
		} finally {
			saving = false;
		}
	}

	function setMapping(header, field) {
		fieldMappings = { ...fieldMappings, [header]: field };
	}

	function isMapped(header) {
		const field = fieldMappings[header];
		return field && field !== '_skip';
	}

	function isSkipped(header) {
		return fieldMappings[header] === '_skip';
	}

	function mappedCount() {
		return headers.filter((h) => isMapped(h)).length;
	}

	function skippedCount() {
		return headers.filter((h) => isSkipped(h)).length;
	}

	function addPerson() {
		manualEntries = [
			...manualEntries,
			{ display_name: '', events: [{ title: '', duration_minutes: 60 }] }
		];
	}

	function removePerson(index) {
		if (manualEntries.length <= 1) return;
		manualEntries = manualEntries.filter((_, i) => i !== index);
	}

	function addEvent(personIndex) {
		manualEntries = manualEntries.map((person, i) =>
			i === personIndex
				? {
						...person,
						events: [...person.events, { title: '', duration_minutes: 60 }]
					}
				: person
		);
	}

	function removeEvent(personIndex, eventIndex) {
		manualEntries = manualEntries.map((person, i) => {
			if (i !== personIndex || person.events.length <= 1) return person;
			return {
				...person,
				events: person.events.filter((_, j) => j !== eventIndex)
			};
		});
	}

	function manualPreview() {
		const rooms = parsedRoomNames();
		const people = manualEntries.filter((p) => p.display_name.trim());
		const eventCount = people.reduce(
			(n, p) => n + p.events.filter((e) => e.title.trim() && Number(e.duration_minutes) > 0).length,
			0
		);
		return { people, peopleCount: people.length, eventCount, rooms };
	}

	function validateConventionConfig() {
		if (!conventionConfig.name.trim()) {
			toast.error('Podaj nazwę konwentu');
			return false;
		}
		if (!conventionConfig.startDate || !conventionConfig.endDate) {
			toast.error('Podaj daty konwentu');
			return false;
		}
		if (conventionConfig.startDate > conventionConfig.endDate) {
			toast.error('Data początku nie może być po dacie końca');
			return false;
		}
		if (parsedRoomNames().length === 0) {
			toast.error('Dodaj co najmniej jedną salę');
			return false;
		}
		return true;
	}

	function validateManualEntries() {
		const summary = manualPreview();
		if (summary.peopleCount === 0) {
			toast.error('Dodaj co najmniej jedną osobę z pseudonimem');
			return false;
		}
		if (summary.eventCount === 0) {
			toast.error('Dodaj co najmniej jedną atrakcję z tytułem i czasem trwania');
			return false;
		}
		return true;
	}

	$effect(() => {
		if (mode === 'manual') {
			preview = manualPreview();
		}
	});

	function truncateTitle(title, max = 70) {
		const t = title.trim();
		return t.length > max ? `${t.slice(0, max - 1)}…` : t;
	}

	function syncEditablePeople() {
		if (!preview?.people) {
			editablePeople = [];
			return;
		}
		// preview.people is a Svelte $state proxy — structuredClone fails on proxies
		const people = JSON.parse(JSON.stringify(preview.people));
		editablePeople = people.map((person) => ({
			...person,
			events: person.events.map((event) => ({
				...event,
				duration_minutes: event.duration_minutes ?? ''
			}))
		}));
	}

	function eventNeedsDuration(event) {
		return (
			event.needs_duration_edit ||
			!Number(event.duration_minutes) ||
			Number(event.duration_minutes) <= 0
		);
	}

	function sortedEditablePeople() {
		return editablePeople
			.map((person, personIndex) => ({
				person,
				personIndex,
				events: person.events
					.map((event, eventIndex) => ({ event, eventIndex }))
					.sort((a, b) => {
						const aNeeds = eventNeedsDuration(a.event);
						const bNeeds = eventNeedsDuration(b.event);
						if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
						return a.eventIndex - b.eventIndex;
					})
			}))
			.sort((a, b) => {
				const aNeeds = a.events.some(({ event }) => eventNeedsDuration(event));
				const bNeeds = b.events.some(({ event }) => eventNeedsDuration(event));
				if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
				return a.person.display_name.localeCompare(b.person.display_name, 'pl');
			});
	}

	function editableStats() {
		const people = editablePeople.filter((p) => p.events.length > 0);
		const eventCount = people.reduce((n, p) => n + p.events.length, 0);
		const needsDurationCount = people.reduce(
			(n, p) => n + p.events.filter((e) => eventNeedsDuration(e)).length,
			0
		);
		return { peopleCount: people.length, eventCount, needsDurationCount };
	}

	function removeEditableEvent(personIndex, eventIndex) {
		editablePeople = editablePeople
			.map((person, i) =>
				i !== personIndex
					? person
					: { ...person, events: person.events.filter((_, j) => j !== eventIndex) }
			)
			.filter((person) => person.events.length > 0);
	}

	function updateEventDuration(event, value) {
		event.duration_minutes = value === '' ? '' : Number(value);
		if (Number(event.duration_minutes) > 0) {
			event.needs_duration_edit = false;
		}
	}

	function buildEditedPreview() {
		const people = editablePeople
			.map((person) => ({
				...person,
				events: person.events.map((event) => ({
					...event,
					title: event.title.trim(),
					duration_minutes: Number(event.duration_minutes)
				}))
			}))
			.filter((person) => person.events.length > 0);
		const eventCount = people.reduce((n, person) => n + person.events.length, 0);
		return { ...preview, people, peopleCount: people.length, eventCount };
	}

	function validateEditablePreview() {
		const stats = editableStats();
		if (stats.eventCount === 0) {
			toast.error('Brak atrakcji do importu');
			return false;
		}
		for (const person of editablePeople) {
			for (const event of person.events) {
				if (!event.title?.trim()) {
					toast.error(`Uzupełnij tytuł atrakcji (${person.display_name})`);
					return false;
				}
				if (!Number(event.duration_minutes) || Number(event.duration_minutes) <= 0) {
					toast.error(
						`Ustaw czas trwania: „${truncateTitle(event.title, 50)}" (${person.display_name})`
					);
					return false;
				}
			}
		}
		return true;
	}
</script>

<div class="g-page mx-auto max-w-4xl">
	<header class="g-page-header">
		<h1 class="g-page-title">Konfiguracja konwentu</h1>
		<p class="g-page-subtitle">
			{mode === null
				? 'Wybierz sposób dodania danych — import CSV albo wpis ręczny.'
				: mode === 'csv'
					? 'Wgraj CSV z Google Forms i ustaw konwent.'
					: 'Uzupełnij dane konwentu, sale i atrakcje ręcznie.'}
		</p>
	</header>

	{#if mode !== null}
		<Button variant="outline" size="sm" onclick={() => resetFlow(null)}>← Wróć do wyboru</Button>
	{/if}

	{#if mode === null}
		<div class="g-card-grid">
			<Card class="p-6">
				<h2 class="g-product-card-title">Import CSV</h2>
				<p class="g-product-card-desc">
					Eksport odpowiedzi z Google Forms — automatyczne mapowanie kolumn i dyspozycyjności.
				</p>
				<Button onclick={() => resetFlow('csv')}>Kreator importu</Button>
			</Card>

			<Card class="p-6">
				<h2 class="g-product-card-title">Wpis ręczny</h2>
				<p class="g-product-card-desc">
					Dodaj osoby, atrakcje i sale samodzielnie. Dyspozycyjność domyślnie: dostępny we
					wszystkich slotach.
				</p>
				<Button variant="outline" onclick={() => resetFlow('manual')}>Formularz ręczny</Button>
			</Card>
		</div>
	{:else}
		<div class="g-steps">
			{#each (mode === 'csv' ? CSV_STEPS : MANUAL_STEPS) as label, i}
				<span
					class="g-step {step > i + 1
						? 'g-step--done'
						: step === i + 1
							? 'g-step--active'
							: 'g-step--pending'}"
				>
					{i + 1}. {label}
				</span>
			{/each}
		</div>

		{#if mode === 'csv' && step === 1}
			<Card class="p-6 space-y-4">
				<h2 class="text-xl font-medium text-foreground">Plik CSV</h2>
				<p class="text-sm text-muted-foreground">Eksport odpowiedzi z Google Forms.</p>
				<FileInput
					id="csv-file"
					label="Plik CSV"
					accept=".csv,text/csv"
					fileName={csvFileName}
					onchange={handleFileSelect}
				/>
			</Card>
		{/if}

		{#if mode === 'csv' && step === 2 && preview}
			<Card class="p-6 gap-3">
				<h2 class="text-xl font-medium text-foreground">Mapowanie kolumn</h2>
				<p class="text-sm text-muted-foreground">
					Przypisz kolumny z pliku CSV do odpowiednich pól w aplikacji. Niepotrzebne kolumny
					oznacz jako „pomiń”.
				</p>
				<p class="text-sm">
					<span class="font-medium text-[#137333]">{mappedCount()} zmapowane</span>
					·
					<span class="font-medium text-muted-foreground">{skippedCount()} pominięte</span>
					{#if headers.length - mappedCount() - skippedCount() > 0}
						·
						<span class="font-medium text-[#b06000]">
							{headers.length - mappedCount() - skippedCount()} do uzupełnienia
						</span>
					{/if}
				</p>
				<div class="space-y-1">
					{#each headers as header}
						<div
							class="grid grid-cols-2 items-center gap-3 rounded px-2 py-0.5 {isMapped(header)
								? 'bg-card'
								: isSkipped(header)
									? 'g-surface border border-border'
									: 'g-surface-warn border border-[#f9ab00]/30'}"
						>
							<span class="text-sm font-medium truncate" title={header}>{header}</span>
							<select
								class="g-select"
								value={fieldMappings[header] || '_skip'}
								onchange={(e) => setMapping(header, e.currentTarget.value)}
							>
								{#each appFields as field}
									<option value={field.key}>{field.label}</option>
								{/each}
							</select>
						</div>
					{/each}
				</div>
				<Button
					onclick={async () => {
						await runPreview();
						step = 3;
					}}
					disabled={loading}
				>
					{loading ? 'Podgląd…' : 'Dalej: ustawienia'}
				</Button>
			</Card>
		{/if}

		{#if (mode === 'csv' && step === 3) || (mode === 'manual' && step === 1)}
			<Card class="p-6 space-y-4">
				<h2 class="text-xl font-medium text-foreground">Ustawienia konwentu</h2>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<Label for="conv-name">Nazwa konwentu</Label>
						<Input id="conv-name" bind:value={conventionConfig.name} />
					</div>
					<div>
						<Label for="slot-min">Długość slotu</Label>
						<select
							id="slot-min"
							class="g-select"
							bind:value={conventionConfig.slotMinutes}
						>
							<option value={30}>30 min</option>
							<option value={60}>60 min</option>
						</select>
					</div>
					<div>
						<Label for="start-date">Data początku</Label>
						<Input id="start-date" type="date" bind:value={conventionConfig.startDate} />
					</div>
					<div>
						<Label for="end-date">Data końca</Label>
						<Input id="end-date" type="date" bind:value={conventionConfig.endDate} />
					</div>
					<div>
						<Label for="day-start">Początek dnia (godz.)</Label>
						<Input
							id="day-start"
							type="number"
							min="0"
							max="23"
							bind:value={conventionConfig.dayStartHour}
						/>
					</div>
					<div>
						<Label for="day-end">Koniec dnia (godz.)</Label>
						<Input
							id="day-end"
							type="number"
							min="1"
							max="24"
							bind:value={conventionConfig.dayEndHour}
						/>
					</div>
				</div>
				<div>
					<Label for="rooms">Sale (jedna na linię)</Label>
					<textarea
						id="rooms"
						class="g-textarea mt-1 font-mono"
						rows="4"
						bind:value={roomNames}
					></textarea>
				</div>
				<Button
					onclick={() => {
						if (!validateConventionConfig()) return;
						if (mode === 'manual') {
							step = 2;
							return;
						}
						runPreview().then(() => {
							syncEditablePeople();
							step = 4;
						});
					}}
					disabled={loading}
				>
					{mode === 'manual' ? 'Dalej: osoby i atrakcje' : loading ? 'Podgląd…' : 'Dalej: podgląd'}
				</Button>
			</Card>
		{/if}

		{#if mode === 'manual' && step === 2}
			<Card class="p-6 space-y-4">
				<div class="flex items-center justify-between gap-3">
					<h2 class="text-xl font-medium text-foreground">Osoby i atrakcje</h2>
					<Button variant="outline" size="sm" onclick={addPerson}>+ Osoba</Button>
				</div>
				<p class="text-sm text-muted-foreground">
					Każda osoba może mieć wiele atrakcji. Dyspozycyjność zostanie ustawiona na „mogę” we
					wszystkich slotach.
				</p>

				<div class="space-y-6">
					{#each manualEntries as person, personIndex}
						<div class="g-surface space-y-4 rounded-lg border border-border p-4">
							<div class="flex items-start gap-3">
								<div class="flex-1">
									<Label for="person-{personIndex}">Pseudonim</Label>
									<Input
										id="person-{personIndex}"
										bind:value={person.display_name}
										placeholder="np. Kitsu"
									/>
								</div>
								{#if manualEntries.length > 1}
									<Button
										variant="outline"
										size="sm"
										class="mt-6"
										onclick={() => removePerson(personIndex)}
									>
										Usuń osobę
									</Button>
								{/if}
							</div>

							<div class="space-y-3">
								{#each person.events as event, eventIndex}
									<div class="grid grid-cols-1 md:grid-cols-3 gap-3 items-end bg-white rounded p-3">
										<div class="md:col-span-2">
											<Label for="title-{personIndex}-{eventIndex}">Tytuł atrakcji</Label>
											<Input
												id="title-{personIndex}-{eventIndex}"
												bind:value={event.title}
												placeholder="np. Warsztat origami"
											/>
										</div>
										<div>
											<Label for="duration-{personIndex}-{eventIndex}">Czas trwania (min)</Label>
											<Input
												id="duration-{personIndex}-{eventIndex}"
												type="number"
												min="1"
												step="1"
												bind:value={event.duration_minutes}
											/>
										</div>
										{#if person.events.length > 1}
											<div class="md:col-span-3">
												<Button
													variant="outline"
													size="sm"
													onclick={() => removeEvent(personIndex, eventIndex)}
												>
													Usuń atrakcję
												</Button>
											</div>
										{/if}
									</div>
								{/each}
							</div>

							<Button variant="outline" size="sm" onclick={() => addEvent(personIndex)}>
								+ Atrakcja
							</Button>
						</div>
					{/each}
				</div>

				<div class="flex gap-3">
					<Button variant="outline" onclick={() => (step = 1)}>Wstecz</Button>
					<Button
						onclick={() => {
							if (!validateManualEntries()) return;
							step = 3;
						}}
					>
						Dalej: podsumowanie
					</Button>
				</div>
			</Card>
		{/if}

		{#if mode === 'csv' && step === 4 && preview}
			{@const stats = editableStats()}
			<Card class="p-6 space-y-4">
				<h2 class="text-xl font-medium text-foreground">Podgląd i import</h2>
				<p class="text-sm text-muted-foreground">
					Sprawdź listę przed importem. Możesz edytować tytuły i czasy trwania albo usunąć
					wiersze. Atrakcje bez rozpoznanego czasu wymagają uzupełnienia (podświetlone).
				</p>
				<div class="grid grid-cols-3 gap-4">
					<div class="g-stat">
						<div class="g-stat-value text-primary">{stats.peopleCount}</div>
						<div class="g-stat-label">Osoby</div>
					</div>
					<div class="g-stat">
						<div class="g-stat-value text-[#137333]">{stats.eventCount}</div>
						<div class="g-stat-label">Atrakcje</div>
					</div>
					<div class="g-stat">
						<div class="g-stat-value text-[#9334e6]">
							{preview.suggestedRooms?.length ?? 0}
						</div>
						<div class="g-stat-label">Sale</div>
					</div>
				</div>

				{#if stats.needsDurationCount > 0}
					<div class="g-surface-warn border border-[#f9ab00]/30 p-3 text-sm text-[#b06000]">
						{stats.needsDurationCount} atrakcji wymaga ręcznego ustawienia czasu trwania (min).
					</div>
				{/if}

				{#if preview.stats}
					<div class="text-sm text-muted-foreground">
						Wierszy w CSV: {preview.stats.totalRows} · przetworzonych: {preview.stats.processedRows}
					</div>
				{/if}

				{#if preview.issues?.length > 0}
					{@const errors = preview.issues.filter((i) => i.type === 'error')}
					{@const warnings = preview.issues.filter((i) => i.type === 'warning')}

					<div class="space-y-2">
						{#if warnings.length > 0}
							<details class="g-surface-warn rounded-lg border border-[#f9ab00]/30 p-3" open>
								<summary class="cursor-pointer font-medium text-[#b06000]">
									Ostrzeżenia ({warnings.length}) — wiersze pominięte
								</summary>
								<ul class="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-sm text-[#b06000]">
									{#each warnings as issue}
										<li>{issue.message}</li>
									{/each}
								</ul>
							</details>
						{/if}

						{#if errors.length > 0}
							<details class="g-danger-zone rounded-lg p-3" open>
								<summary class="cursor-pointer font-medium text-[#c5221f]">
									Błędy ({errors.length}) — wiersze pominięte
								</summary>
								<ul class="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-sm text-[#c5221f]">
									{#each errors as issue}
										<li>{issue.message}</li>
									{/each}
								</ul>
							</details>
						{/if}
					</div>
				{/if}

				<div class="max-h-96 overflow-y-auto rounded-lg border border-border">
					<table class="w-full text-sm">
						<thead class="sticky top-0 bg-muted">
							<tr>
								<th class="text-left p-2 w-28">Prowadzący</th>
								<th class="text-left p-2">Tytuł</th>
								<th class="text-left p-2 w-24">Min</th>
								<th class="text-right p-2 w-28">Akcje</th>
							</tr>
						</thead>
						<tbody>
							{#each sortedEditablePeople() as entry (entry.personIndex)}
								{#each entry.events as { event, eventIndex }, rowIndex}
									<tr
										class="{rowIndex === 0 ? 'border-t' : ''} align-top {eventNeedsDuration(event)
											? 'bg-[#fef7e0]'
											: ''}"
									>
										{#if rowIndex === 0}
											<td
												class="p-2 font-medium align-top bg-inherit"
												rowspan={entry.events.length}
											>
												{entry.person.display_name}
											</td>
										{/if}
										<td class="p-2">
											<Input bind:value={event.title} class="text-sm" />
										</td>
										<td class="p-2">
											<Input
												type="number"
												min="1"
												step="1"
												class="text-sm"
												value={event.duration_minutes}
												placeholder={event.duration_raw || 'min'}
												title={event.duration_raw ? `Z CSV: ${event.duration_raw}` : undefined}
												oninput={(e) => updateEventDuration(event, e.currentTarget.value)}
											/>
										</td>
										<td class="p-2 text-right align-middle whitespace-nowrap">
											<Button
												variant="outline"
												size="sm"
												onclick={() => removeEditableEvent(entry.personIndex, eventIndex)}
											>
												Usuń
											</Button>
										</td>
									</tr>
								{/each}
							{/each}
						</tbody>
					</table>
					{#if editablePeople.length === 0}
						<p class="text-sm text-muted-foreground p-4 text-center">Brak atrakcji do importu.</p>
					{/if}
				</div>

				<div class="flex gap-3">
					<Button variant="outline" onclick={() => (step = 3)}>Wstecz</Button>
					<Button onclick={handleImport} disabled={saving || stats.eventCount === 0}>
						{saving ? 'Import…' : 'Importuj i otwórz grafik'}
					</Button>
				</div>
			</Card>
		{/if}

		{#if mode === 'manual' && step === 3 && preview}
			<Card class="p-6 space-y-4">
				<h2 class="text-xl font-medium text-foreground">Podsumowanie</h2>
				<div class="grid grid-cols-3 gap-4">
					<div class="g-stat">
						<div class="g-stat-value text-primary">{preview.peopleCount}</div>
						<div class="g-stat-label">Osoby</div>
					</div>
					<div class="g-stat">
						<div class="g-stat-value text-[#137333]">{preview.eventCount}</div>
						<div class="g-stat-label">Atrakcje</div>
					</div>
					<div class="g-stat">
						<div class="g-stat-value text-[#9334e6]">{preview.rooms.length}</div>
						<div class="g-stat-label">Sale</div>
					</div>
				</div>

				<div class="max-h-96 overflow-y-auto rounded-lg border border-border">
					<table class="w-full text-sm table-fixed">
						<colgroup>
							<col class="w-32" />
							<col class="w-12" />
							<col />
						</colgroup>
						<thead class="sticky top-0 bg-muted">
							<tr>
								<th class="text-left p-2">Prowadzący</th>
								<th class="text-center p-2">Szt.</th>
								<th class="text-left p-2">Atrakcje</th>
							</tr>
						</thead>
						<tbody>
							{#each preview.people as person}
								<tr class="border-t align-top">
									<td class="p-2 font-medium">{person.display_name}</td>
									<td class="p-2 text-center text-muted-foreground tabular-nums">
										{person.events.filter((e) => e.title.trim()).length}
									</td>
									<td class="p-2">
										<ul class="space-y-1.5">
											{#each person.events.filter((e) => e.title.trim()) as event}
												<li class="leading-snug">
													<span class="text-foreground" title={event.title}>
														{truncateTitle(event.title)}
													</span>
													<span class="text-muted-foreground/70 text-xs whitespace-nowrap">
														· {event.duration_minutes} min
													</span>
												</li>
											{/each}
										</ul>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<p class="text-sm text-muted-foreground">
					Konwent: {conventionConfig.name} · {conventionConfig.startDate} – {conventionConfig.endDate}
					· sloty {conventionConfig.slotMinutes} min
				</p>

				<div class="flex gap-3">
					<Button variant="outline" onclick={() => (step = 2)}>Wstecz</Button>
					<Button onclick={handleManualSave} disabled={saving}>
						{saving ? 'Zapisywanie…' : 'Zapisz i otwórz grafik'}
					</Button>
				</div>
			</Card>
		{/if}
	{/if}
</div>
