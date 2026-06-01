<script>
	import Card from '$lib/components/ui/card/card.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { onMount } from 'svelte';
	import { getConventions } from '$lib/database.js';
	import { clearAllData } from '$lib/local-db.js';

	let active = $state(null);
	let showClearDialog = $state(false);

	onMount(async () => {
		try {
			const data = await getConventions();
			active = data.active;
		} catch {
			active = null;
		}
	});

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
