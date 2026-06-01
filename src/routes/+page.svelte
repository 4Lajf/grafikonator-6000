<script>
	import Card from '$lib/components/ui/card/card.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import FileInput from '$lib/components/ui/file-input/file-input.svelte';
	import { onMount } from 'svelte';
	import {
		buildPlanFilename,
		describePlan,
		exportPlan,
		getConventions,
		importPlan,
		parsePlanJson
	} from '$lib/database.js';
	import { clearAllData } from '$lib/local-db.js';
	import { toast } from 'svelte-sonner';

	let active = $state(null);
	let showClearDialog = $state(false);
	let showImportDialog = $state(false);
	let pendingImportJson = $state('');
	let pendingImportSummary = $state(null);
	let importFileName = $state('');
	let exporting = $state(false);
	let importing = $state(false);

	onMount(async () => {
		try {
			const data = await getConventions();
			active = data.active;
		} catch {
			active = null;
		}
	});

	async function handleExportPlan() {
		if (!active) {
			toast.error('Brak planu do eksportu', {
				description: 'Najpierw zaimportuj dane konwentu albo utwórz plan ręcznie.'
			});
			return;
		}

		exporting = true;
		try {
			const json = await exportPlan();
			const blob = new Blob([json], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = buildPlanFilename(active.name);
			link.click();
			URL.revokeObjectURL(url);
			toast.success('Wyeksportowano plan', {
				description: 'Plik JSON możesz przenieść na inny komputer albo wysłać współorganizatorowi.'
			});
		} catch (error) {
			toast.error('Błąd eksportu', { description: error.message });
		} finally {
			exporting = false;
		}
	}

	async function handleImportFileChange(event) {
		const file = event.currentTarget.files?.[0];
		importFileName = file?.name || '';
		if (!file) return;

		try {
			const text = await file.text();
			const data = parsePlanJson(text);
			pendingImportJson = text;
			pendingImportSummary = describePlan(data);
			showImportDialog = true;
		} catch (error) {
			pendingImportJson = '';
			pendingImportSummary = null;
			toast.error('Nie można wczytać pliku', { description: error.message });
		} finally {
			event.currentTarget.value = '';
		}
	}

	async function confirmImportPlan() {
		if (!pendingImportJson) return;

		importing = true;
		try {
			const result = await importPlan(pendingImportJson);
			active = result.active;
			showImportDialog = false;
			pendingImportJson = '';
			pendingImportSummary = null;
			importFileName = '';
			toast.success('Zaimportowano plan', {
				description: result.summary.conventionName
			});
		} catch (error) {
			toast.error('Błąd importu', { description: error.message });
		} finally {
			importing = false;
		}
	}

	function confirmClearData() {
		clearAllData();
		active = null;
		showClearDialog = false;
	}
</script>

<div class="g-page">
	<header class="g-page-header">
		<h1 class="g-page-title">Planowanie paneli i warsztatów</h1>
		<p class="g-page-subtitle">
			Dane są zapisywane lokalnie w tej przeglądarce — każdy organizator ma własną kopię. Zacznij od
			importu danych albo przejdź od razu do grafiku.
		</p>
	</header>

	<div class="g-card-grid">
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
			<li>Auto-grafik wg dyspozycyjności (mogę / wolę nie / nie mogę)</li>
			<li>Przeciągaj atrakcje na siatce; sprawdzaj godziny na osobę</li>
		</ol>
	</section>

	<section class="g-section-card">
		<h2 class="g-section-title">Eksport i import planu</h2>
		<p class="mb-4 text-sm text-muted-foreground">
			Zapisz cały plan konwentu w pliku JSON, żeby kontynuować pracę na innym komputerze albo
			udostępnić go współorganizatorowi. Plik zawiera osoby, atrakcje, sale, dyspozycyjność i
			grafik.
		</p>
		<div class="flex flex-col gap-4 sm:flex-row sm:items-end">
			<Button onclick={handleExportPlan} disabled={!active || exporting}>
				{exporting ? 'Eksportowanie…' : 'Eksportuj plan (JSON)'}
			</Button>
			<div class="min-w-0 flex-1 sm:max-w-md">
				<FileInput
					id="plan-import"
					label="Importuj plan (JSON)"
					accept=".json,application/json"
					fileName={importFileName}
					onchange={handleImportFileChange}
				/>
			</div>
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

<AlertDialog.Root bind:open={showImportDialog}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Zastąpić bieżący plan?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if pendingImportSummary}
					Plik zawiera konwent <strong>{pendingImportSummary.conventionName}</strong>
					({pendingImportSummary.peopleCount} osób, {pendingImportSummary.eventCount} atrakcji,
					{pendingImportSummary.scheduleCount} wpisów w grafiku).
				{/if}
				{#if active}
					Bieżący plan (<strong>{active.name}</strong>) zostanie usunięty z tej przeglądarki i
					zastąpiony importowanym.
				{:else}
					Plan zostanie zapisany lokalnie w tej przeglądarce.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel
				onclick={() => {
					pendingImportJson = '';
					pendingImportSummary = null;
					importFileName = '';
				}}
			>
				Anuluj
			</AlertDialog.Cancel>
			<AlertDialog.Action
				class={buttonVariants({ variant: 'destructive' })}
				onclick={confirmImportPlan}
				disabled={importing}
			>
				{importing ? 'Importowanie…' : 'Importuj plan'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

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
