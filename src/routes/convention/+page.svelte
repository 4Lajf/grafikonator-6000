<script>
	import { onMount } from 'svelte';
	import {
		getConventions,
		updateConvention,
		generateTimeSlots,
		getRooms,
		createRoom,
		updateRoom,
		deleteRoom,
		getTimeSlots,
		updateTimeSlot,
		getSchedules,
		SLOT_TIER_OPTIONS
	} from '$lib/database.js';
	import Button from '$lib/components/ui/button/button.svelte';
	import Card from '$lib/components/ui/card/card.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { toast } from 'svelte-sonner';
	import { normalizeHourWindow } from '$lib/convention-hours.js';

	let loading = $state(true);
	let savingSettings = $state(false);
	let convention = $state(null);
	let form = $state(null);
	let rooms = $state([]);
	let roomNames = $state({});
	let roomCapabilities = $state({});
	let roomBusy = $state({});
	let newRoomName = $state('');
	let timeSlots = $state([]);
	let slotBusy = $state({});

	const slotsByDate = $derived.by(() => {
		/** @type {Map<string, any[]>} */
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

	function listDates(startDate, endDate) {
		if (!startDate || !endDate || startDate > endDate) return [];
		const dates = [];
		const current = new Date(`${startDate}T00:00:00`);
		const end = new Date(`${endDate}T00:00:00`);
		while (current <= end) {
			const year = current.getFullYear();
			const month = String(current.getMonth() + 1).padStart(2, '0');
			const day = String(current.getDate()).padStart(2, '0');
			dates.push(`${year}-${month}-${day}`);
			current.setDate(current.getDate() + 1);
		}
		return dates;
	}

	function buildDaySettings(activeConvention) {
		const overrides = new Map((activeConvention.day_hours || []).map((day) => [day.date, day]));
		return listDates(activeConvention.start_date, activeConvention.end_date).map((date) => ({
			date,
			startHour: Number(overrides.get(date)?.start_hour ?? 8),
			endHour: Number(overrides.get(date)?.end_hour ?? 22)
		}));
	}

	function syncDaySettings() {
		if (!form) return;
		const dates = listDates(form.startDate, form.endDate);
		const current = new Map((form.daySettings || []).map((day) => [day.date, day]));
		/** @type {{ date: string, startHour: number, endHour: number }[]} */
		const next = [];
		for (const date of dates) {
			const day = current.get(date);
			if (day) {
				next.push({ date, startHour: Number(day.startHour), endHour: Number(day.endHour) });
			} else if (next.length > 0) {
				const prev = next[next.length - 1];
				next.push({ date, startHour: prev.startHour, endHour: prev.endHour });
			} else {
				next.push({ date, startHour: 8, endHour: 22 });
			}
		}
		const currentJson = JSON.stringify(form.daySettings || []);
		const nextJson = JSON.stringify(next);
		if (currentJson !== nextJson) {
			form = { ...form, daySettings: next };
		}
	}

	function updateDaySetting(date, key, value) {
		const parsed = Number(value);
		form = {
			...form,
			daySettings: (form.daySettings || []).map((day) => {
				if (day.date !== date) return day;
				const draft = {
					...day,
					[key]: Number.isFinite(parsed) ? parsed : day[key]
				};
				return { ...draft, ...normalizeHourWindow(draft.startHour, draft.endHour) };
			})
		};
	}

	function formatDate(dateStr) {
		return new Date(`${dateStr}T00:00:00`).toLocaleDateString('pl-PL', {
			weekday: 'long',
			day: 'numeric',
			month: 'short'
		});
	}

	function formatTime(timeStr) {
		return String(timeStr || '').slice(0, 5);
	}

	function capabilityForm(room) {
		const capabilities = room.capabilities || {};
		return {
			capacity: capabilities.capacity ?? '',
			tags: (capabilities.tags || []).join(', '),
			notes: capabilities.notes || room.description || ''
		};
	}

	function parseCapabilityForm(value) {
		return {
			capacity: value.capacity === '' ? null : Number(value.capacity),
			tags: String(value.tags || '')
				.split(/[,;\n]/)
				.map((tag) => tag.trim())
				.filter(Boolean),
			notes: value.notes || null
		};
	}

	async function refreshRoomsAndSlots() {
		if (!convention) return;
		const [roomsData, slotsData] = await Promise.all([
			getRooms(convention.id),
			getTimeSlots(convention.id)
		]);
		rooms = roomsData;
		roomNames = Object.fromEntries(roomsData.map((room) => [room.id, room.name]));
		roomCapabilities = Object.fromEntries(roomsData.map((room) => [room.id, capabilityForm(room)]));
		timeSlots = slotsData;
	}

	async function loadData() {
		loading = true;
		try {
			const { active } = await getConventions();
			convention = active;
			if (!active) return;
			form = {
				name: active.name,
				startDate: active.start_date,
				endDate: active.end_date,
				slotMinutes: Number(active.slot_minutes ?? 30),
				daySettings: buildDaySettings(active)
			};
			await refreshRoomsAndSlots();
		} catch (error) {
			toast.error('Błąd ładowania ustawień', { description: error.message });
		} finally {
			loading = false;
		}
	}

	function validateConventionForm() {
		if (!form.name.trim()) {
			toast.error('Podaj nazwę konwentu');
			return false;
		}
		if (!form.startDate || !form.endDate || form.startDate > form.endDate) {
			toast.error('Nieprawidłowy zakres dat');
			return false;
		}
		for (const day of form.daySettings || []) {
			if (
				Number(day.startHour) < 0 ||
				Number(day.startHour) > 23 ||
				Number(day.endHour) < 1 ||
				Number(day.endHour) > 24 ||
				Number(day.startHour) >= Number(day.endHour)
			) {
				toast.error(`Nieprawidłowe godziny dla ${day.date}`);
				return false;
			}
		}
		return true;
	}

	async function saveConventionSettings() {
		if (!convention || !form) return;
		if (!validateConventionForm()) return;
		savingSettings = true;
		try {
			const before = await getSchedules(convention.id);
			await updateConvention(convention.id, {
				name: form.name.trim(),
				start_date: form.startDate,
				end_date: form.endDate,
				slot_minutes: Number(form.slotMinutes),
				day_hours: (form.daySettings || []).map((day) => ({
					date: day.date,
					start_hour: Number(day.startHour),
					end_hour: Number(day.endHour)
				}))
			});
			await generateTimeSlots(convention.id);
			const after = await getSchedules(convention.id);
			const removedSchedules = Math.max(0, before.length - after.length);
			await loadData();
			toast.success('Zapisano szczegóły konwentu', {
				description:
					removedSchedules > 0
						? `Usunięto ${removedSchedules} wpisów grafiku, które nie mieszczą się już w slotach.`
						: 'Godziny, daty i sloty zostały zaktualizowane.'
			});
		} catch (error) {
			toast.error('Błąd zapisu ustawień', { description: error.message });
		} finally {
			savingSettings = false;
		}
	}

	async function handleAddRoom() {
		const name = newRoomName.trim();
		if (!convention || !name) return;
		roomBusy = { ...roomBusy, new: true };
		try {
			await createRoom(convention.id, { name });
			newRoomName = '';
			await refreshRoomsAndSlots();
			toast.success('Dodano salę');
		} catch (error) {
			toast.error('Nie udało się dodać sali', { description: error.message });
		} finally {
			const next = { ...roomBusy };
			delete next.new;
			roomBusy = next;
		}
	}

	async function handleSaveRoom(room) {
		const name = String(roomNames[room.id] || '').trim();
		if (!name) {
			toast.error('Nazwa sali nie może być pusta');
			return;
		}
		roomBusy = { ...roomBusy, [room.id]: true };
		try {
			const capabilities = parseCapabilityForm(roomCapabilities[room.id] || {});
			await updateRoom(room.id, {
				name,
				description: capabilities.notes,
				capabilities: {
					...capabilities,
					noisePolicy: room.capabilities?.noisePolicy ?? null
				}
			});
			await refreshRoomsAndSlots();
			toast.success('Zapisano salę');
		} catch (error) {
			toast.error('Nie udało się zapisać sali', { description: error.message });
		} finally {
			const next = { ...roomBusy };
			delete next[room.id];
			roomBusy = next;
		}
	}

	async function handleDeleteRoom(room) {
		if (!confirm(`Usunąć salę „${room.name}”?`)) return;
		roomBusy = { ...roomBusy, [room.id]: true };
		try {
			await deleteRoom(room.id);
			await refreshRoomsAndSlots();
			toast.success('Usunięto salę');
		} catch (error) {
			toast.error('Nie udało się usunąć sali', { description: error.message });
		} finally {
			const next = { ...roomBusy };
			delete next[room.id];
			roomBusy = next;
		}
	}

	async function handleSlotTierChange(slotId, value) {
		const tier = Number(value);
		slotBusy = { ...slotBusy, [slotId]: true };
		try {
			await updateTimeSlot(slotId, { tier });
			timeSlots = timeSlots.map((slot) => (slot.id === slotId ? { ...slot, tier } : slot));
			toast.success('Zapisano tier slotu');
		} catch (error) {
			toast.error('Nie udało się zapisać tieru', { description: error.message });
		} finally {
			const next = { ...slotBusy };
			delete next[slotId];
			slotBusy = next;
		}
	}

	function getSlotTierClass(tier) {
		const t = Number(tier ?? 2);
		if (t === 1) return 'g-tier-1 hover:brightness-95 border-[#34a853]';
		if (t === 3) return 'g-tier-3 hover:brightness-95 border-[#ea4335]';
		return 'g-tier-2 hover:brightness-95 border-[#fbbc04]';
	}

	function cycleSlotTier(slot) {
		const current = Number(slot.tier ?? 2);
		const next = current === 3 ? 1 : current + 1;
		handleSlotTierChange(slot.id, next);
	}

	onMount(async () => {
		await loadData();
	});

	$effect(() => {
		if (!form) return;
		form.startDate;
		form.endDate;
		syncDaySettings();
	});
</script>

<div class="g-page">
	<header class="g-page-header">
		<h1 class="g-page-title">Szczegóły konwentu</h1>
		<p class="g-page-subtitle">
			Edytuj daty, godziny dnia, długość slotów, sale oraz popularność godzin (tier slotów).
		</p>
	</header>

	{#if loading}
		<div class="py-12 text-center text-muted-foreground">Ładowanie…</div>
	{:else if !convention}
		<Card class="p-8 text-center">
			<h2 class="g-section-title mb-2">Brak aktywnego konwentu</h2>
			<p class="mb-4 text-muted-foreground">Najpierw utwórz konwent w imporcie.</p>
			<Button href="/setup">Przejdź do importu</Button>
		</Card>
	{:else}
		<Card class="p-6 space-y-4">
			<h2 class="text-xl font-medium text-foreground">Ustawienia podstawowe</h2>
			<div class="grid grid-cols-2 gap-4">
				<div>
					<Label for="conv-name">Nazwa</Label>
					<Input id="conv-name" bind:value={form.name} />
				</div>
				<div>
					<Label for="slot-min">Długość slotu</Label>
					<select id="slot-min" class="g-select" bind:value={form.slotMinutes}>
						<option value={30}>30 min</option>
						<option value={60}>60 min</option>
					</select>
				</div>
				<div>
					<Label for="start-date">Data początku</Label>
					<Input id="start-date" type="date" bind:value={form.startDate} />
				</div>
				<div>
					<Label for="end-date">Data końca</Label>
					<Input id="end-date" type="date" bind:value={form.endDate} />
				</div>
				<div class="col-span-2 space-y-2">
					<div>
						<p class="text-sm font-medium text-foreground">Godziny per dzień</p>
						<p class="text-xs text-muted-foreground">Możesz ustawić różny zakres godzin dla każdego dnia.</p>
					</div>
					<div class="overflow-hidden rounded-lg border border-border">
						<div
							class="grid grid-cols-[1fr_auto] items-center gap-3 bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground"
						>
							<span>Dzień</span>
							<span class="w-[150px] text-center">Godziny (od–do)</span>
						</div>
						{#each form.daySettings as day}
							<div
								class="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-border px-3 py-2 even:bg-muted/20"
							>
								<span class="text-sm capitalize text-foreground">{formatDate(day.date)}</span>
								<div class="flex w-[150px] items-center justify-center gap-1.5">
									<Input
										class="h-8 w-16 text-center tabular-nums"
										type="number"
										min="0"
										max="23"
										aria-label="Początek dnia {day.date}"
										value={day.startHour}
										oninput={(event) =>
											updateDaySetting(day.date, 'startHour', event.currentTarget.value)}
									/>
									<span class="text-muted-foreground">–</span>
									<Input
										class="h-8 w-16 text-center tabular-nums"
										type="number"
										min="1"
										max="24"
										aria-label="Koniec dnia {day.date}"
										value={day.endHour}
										oninput={(event) =>
											updateDaySetting(day.date, 'endHour', event.currentTarget.value)}
									/>
								</div>
							</div>
						{/each}
					</div>
				</div>
			</div>
			<Button onclick={saveConventionSettings} disabled={savingSettings}>
				{savingSettings ? 'Zapisywanie…' : 'Zapisz ustawienia konwentu'}
			</Button>
		</Card>

		<Card class="p-6 space-y-4">
			<h2 class="text-xl font-medium text-foreground">Sale</h2>
			<div class="space-y-2">
				{#each rooms as room}
					<div class="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[1.2fr_0.7fr_1.6fr_auto] md:items-end">
						<div>
							<Label for="room-{room.id}" class="text-xs">Nazwa sali</Label>
							<Input id="room-{room.id}" bind:value={roomNames[room.id]} />
						</div>
						<div>
							<Label for="room-capacity-{room.id}" class="text-xs">Pojemność</Label>
							<Input
								id="room-capacity-{room.id}"
								type="number"
								min="0"
								bind:value={roomCapabilities[room.id].capacity}
							/>
						</div>
						<div>
							<Label for="room-tags-{room.id}" class="text-xs">Tagi</Label>
							<Input
								id="room-tags-{room.id}"
								bind:value={roomCapabilities[room.id].tags}
								placeholder="projector, quiet_room"
							/>
						</div>
						<div class="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onclick={() => handleSaveRoom(room)}
								disabled={Boolean(roomBusy[room.id])}
							>
								Zapisz
							</Button>
							<Button
								variant="destructive"
								size="sm"
								onclick={() => handleDeleteRoom(room)}
								disabled={Boolean(roomBusy[room.id])}
							>
								Usuń
							</Button>
						</div>
						<div class="md:col-span-4">
							<Label for="room-notes-{room.id}" class="text-xs">Uwagi</Label>
							<Input
								id="room-notes-{room.id}"
								bind:value={roomCapabilities[room.id].notes}
								placeholder="Krótki opis sali"
							/>
						</div>
					</div>
				{/each}
			</div>
			<div class="flex items-end gap-2">
				<div class="flex-1">
					<Label for="new-room">Nowa sala</Label>
					<Input id="new-room" bind:value={newRoomName} placeholder="np. Panelowa 2" />
				</div>
				<Button onclick={handleAddRoom} disabled={!newRoomName.trim() || Boolean(roomBusy.new)}>
					Dodaj salę
				</Button>
			</div>
		</Card>

		<Card class="p-6 space-y-4">
			<h2 class="text-xl font-medium text-foreground">Popularność godzin (tier slotów)</h2>
			<p class="text-sm text-muted-foreground">
				Tier 1 = najbardziej popularny slot, Tier 3 = najmniej popularny.
			</p>
			<div class="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
				<span class="flex items-center gap-1"><span class="g-tier-1 h-3 w-3 rounded border border-[#34a853]"></span> T1 popularny</span>
				<span class="flex items-center gap-1"><span class="g-tier-2 h-3 w-3 rounded border border-[#fbbc04]"></span> T2 neutralny</span>
				<span class="flex items-center gap-1"><span class="g-tier-3 h-3 w-3 rounded border border-[#ea4335]"></span> T3 słaby</span>
				<span class="text-muted-foreground/70">Kliknij slot, aby zmienić</span>
			</div>
			<div class="space-y-4">
				{#each slotsByDate as day}
					<div>
						<h3 class="mb-2 text-sm font-medium">{formatDate(day.date)}</h3>
						<div class="flex flex-wrap gap-1">
							{#each day.slots as slot}
								<button
									type="button"
									class="rounded border px-2 py-1 text-xs transition-colors {getSlotTierClass(slot.tier)}"
									disabled={Boolean(slotBusy[slot.id])}
									title="{formatTime(slot.start_time)}–{formatTime(slot.end_time)}: {SLOT_TIER_OPTIONS.find((t) => t.value === (slot.tier ?? 2))?.label}"
									onclick={() => cycleSlotTier(slot)}
								>
									{formatTime(slot.start_time)}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground">
				Tier atrakcji ustawisz w szczegółach atrakcji na grafiku.
			</p>
		</Card>
	{/if}
</div>
