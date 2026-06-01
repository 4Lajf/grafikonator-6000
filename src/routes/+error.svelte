<script>
	import { page } from '$app/stores';
	import { dev } from '$app/environment';
	import Button from '$lib/components/ui/button/button.svelte';
	import Card from '$lib/components/ui/card/card.svelte';

	$: error = $page.error;
	$: status = $page.status;

	function getErrorMessage(status, error) {
		switch (status) {
			case 404:
				return 'Nie znaleziono strony.';
			case 403:
				return 'Brak uprawnień.';
			case 500:
				return 'Błąd serwera. Spróbuj później.';
			case 503:
				return 'Usługa niedostępna. Spróbuj później.';
			default:
				return dev && error?.message ? error.message : 'Nieoczekiwany błąd.';
		}
	}

	function getErrorTitle(status) {
		switch (status) {
			case 404:
				return 'Nie znaleziono';
			case 403:
				return 'Brak dostępu';
			case 500:
				return 'Błąd serwera';
			case 503:
				return 'Niedostępne';
			default:
				return 'Błąd';
		}
	}

	function goBack() {
		if (window.history.length > 1) {
			window.history.back();
		} else {
			window.location.href = '/';
		}
	}

	function goHome() {
		window.location.href = '/';
	}
</script>

<svelte:head>
	<title>{getErrorTitle(status)} - Grafikonator</title>
</svelte:head>

<div class="flex min-h-[60vh] items-center justify-center py-12">
	<div class="w-full max-w-md space-y-8">
		<div class="text-center">
			<div class="mb-4 text-6xl font-normal text-muted-foreground/40">
				{status}
			</div>
			<h1 class="g-page-title mb-2">
				{getErrorTitle(status)}
			</h1>
			<p class="text-sm text-muted-foreground">
				{getErrorMessage(status, error)}
			</p>
		</div>

		<Card class="p-6">
			<div class="space-y-4">
				<div class="flex flex-col space-y-3">
					<Button onclick={goHome} class="w-full">Strona główna</Button>
					<Button variant="outline" onclick={goBack} class="w-full">Wstecz</Button>
				</div>

				{#if dev && error}
					<details class="mt-6">
						<summary class="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
							Info dla dewelopera
						</summary>
						<div class="g-surface mt-2 p-3 font-mono text-xs">
							<div><strong>Błąd:</strong> {error.message}</div>
							{#if error.stack}
								<div class="mt-2"><strong>Stack:</strong></div>
								<pre class="whitespace-pre-wrap text-xs">{error.stack}</pre>
							{/if}
						</div>
					</details>
				{/if}
			</div>
		</Card>
	</div>
</div>
