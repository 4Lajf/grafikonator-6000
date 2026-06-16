<script>
	import Card from '$lib/components/ui/card/card.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { onMount } from 'svelte';
	import { exportDataJson, exportScheduleCsv, getConventions, importDataJson } from '$lib/database.js';
	import { clearAllData } from '$lib/local-db.js';
	import { toast } from 'svelte-sonner';

	let active = $state(null);
	let profileCount = $state(0);
	let showClearDialog = $state(false);
	let importAsPeople = $state(false);

	onMount(async () => {
		try {
			const data = await getConventions();
			active = data.active;
			profileCount = data.conventions.length;
		} catch {
			active = null;
			profileCount = 0;
		}
	});

	function confirmClearData() {
		clearAllData();
		active = null;
		profileCount = 0;
		showClearDialog = false;
		window.dispatchEvent(new CustomEvent('profiles-changed'));
	}

	function downloadText(filename, text, type) {
		const blob = new Blob([text], { type });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
	}

	async function refreshActive() {
		const data = await getConventions();
		active = data.active;
		profileCount = data.conventions.length;
		window.dispatchEvent(new CustomEvent('profiles-changed'));
	}

	async function handleExportJson() {
		const json = await exportDataJson();
		downloadText('grafikonator-data.json', json, 'application/json');
	}

	async function handleExportCsv() {
		if (!active) return;
		const csv = await exportScheduleCsv(active.id);
		downloadText(`${active.name || 'grafik'}-schedule.csv`, csv, 'text/csv;charset=utf-8');
	}

	async function handleImportJson(event) {
		const input = event.target;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const text = await file.text();
			await importDataJson(text, { convertEventsToPeople: importAsPeople });
			await refreshActive();
			toast.success('Zaimportowano dane', {
				description: active?.name ? `Aktywny konwent: ${active.name}` : undefined
			});
		} catch (error) {
			toast.error('Nie udało się zaimportować pliku', {
				description: error?.message ?? 'Nieznany błąd importu.'
			});
		} finally {
			input.value = '';
		}
	}
</script>

<div class="g-page">
	<header class="g-page-header">
		<h1 class="g-page-title">Grafikonator 6000</h1>
		<p class="g-page-subtitle">
			Planowanie grafiku konwentu. Dane są zapisywane lokalnie w tej przeglądarce — każdy organizator
			ma własną kopię. Zacznij od importu danych albo przejdź od razu do grafiku.
		</p>
	</header>

	<div class="g-card-grid">
		<Card class="p-0 overflow-hidden">
			<div class="g-product-card rounded-none border-0 shadow-none">
				<span class="g-product-card-icon g-product-card-icon--blue" aria-hidden="true">P</span>
				<div>
					<h2 class="g-product-card-title">Profile</h2>
					<p class="g-product-card-desc">
						{profileCount} zapisanych profili. Przelaczaj osobne konwenty i warianty planu bez kasowania danych.
					</p>
				</div>
				<Button href="/profiles" variant={profileCount ? 'default' : 'outline'}>Zarzadzaj profilami</Button>
			</div>
		</Card>

		<Card class="p-0 overflow-hidden">
			<div class="g-product-card rounded-none border-0 shadow-none">
				<span class="g-product-card-icon g-product-card-icon--blue" aria-hidden="true">↑</span>
				<div>
					<h2 class="g-product-card-title">Import danych</h2>
					<p class="g-product-card-desc">
						Wgraj CSV z Google Forms albo uzupełnij dane ręcznie — osoby, atrakcje i sale.
					</p>
				</div>
				<Button href="/setup" variant={active ? 'outline' : 'default'}>Otwórz import</Button>
			</div>
		</Card>

		<Card class="p-0 overflow-hidden">
			<div class="g-product-card rounded-none border-0 shadow-none">
				<span class="g-product-card-icon g-product-card-icon--green" aria-hidden="true">▦</span>
				<div>
					<h2 class="g-product-card-title">Grafik konwentu</h2>
					<p class="g-product-card-desc">
						{#if active}
							Aktywny konwent: <strong class="font-medium text-foreground">{active.name}</strong>
							({active.start_date} – {active.end_date})
						{:else}
							Brak aktywnego konwentu — najpierw dodaj dane importem.
						{/if}
					</p>
				</div>
				<Button href="/schedule" variant={active ? 'default' : 'outline'}>Otwórz grafik</Button>
			</div>
		</Card>
	</div>

	<section class="g-section-card">
		<h2 class="g-section-title">Jak to działa</h2>
		<ol class="space-y-2 pl-5 text-sm text-muted-foreground list-decimal">
			<li>Wgraj CSV albo wpisz dane ręcznie</li>
			<li>Zmapuj kolumny (Pseudonim, dyspozycyjność…)</li>
			<li>Ustaw daty konwentu, sloty (30/60 min) i sale</li>
			<li>Automatyczne układanie wg dyspozycyjności (mogę / wolę nie / nie mogę)</li>
			<li>Przeciągaj wpisy na siatce; sprawdzaj, ile godzin ma każda osoba</li>
		</ol>
	</section>

	<section class="g-section-card">
		<h2 class="g-section-title">Kopia zapasowa i eksport</h2>
		<p class="mb-4 text-sm text-muted-foreground">
			Eksportuj pełny JSON aplikacji albo CSV aktualnego grafiku do Google Sheets. JSON można też
			wgrać z powrotem, opcjonalnie konwertując konwenty z grafiku atrakcji na grafik osób.
		</p>
		<div class="flex flex-wrap items-center gap-3">
			<Button variant="outline" onclick={handleExportJson} disabled={!active}>Eksport JSON</Button>
			<Button variant="outline" onclick={handleExportCsv} disabled={!active}>Eksport CSV grafiku</Button>
			<label class="inline-flex items-center gap-2 text-sm text-muted-foreground">
				<input type="checkbox" bind:checked={importAsPeople} />
				<span>Przy imporcie JSON: konwertuj na grafik osób</span>
			</label>
			<label class="inline-flex cursor-pointer rounded border border-border px-3 py-2 text-sm">
				Import JSON
				<input class="sr-only" type="file" accept="application/json,.json" onchange={handleImportJson} />
			</label>
		</div>
	</section>

	<section class="g-danger-zone">
		<h2 class="g-section-title text-[#c5221f]">Wyczyść dane</h2>
		<p class="mb-4 text-sm text-muted-foreground">
			Usuwa wszystkie dane konwentu zapisane w tej przeglądarce. Tej operacji nie można cofnąć.
		</p>
		<Button variant="outline" onclick={() => (showClearDialog = true)}>Wyczyść dane</Button>
	</section>
</div>

<AlertDialog.Root bind:open={showClearDialog}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Wyczyść dane?</AlertDialog.Title>
			<AlertDialog.Description>
				Usuniesz wszystkie dane konwentu zapisane w tej przeglądarce
				{#if active}
					(w tym <strong>{active.name}</strong>)
				{/if}
				. Tej operacji nie można cofnąć.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Anuluj</AlertDialog.Cancel>
			<AlertDialog.Action class={buttonVariants({ variant: 'destructive' })} onclick={confirmClearData}>
				Wyczyść dane
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
