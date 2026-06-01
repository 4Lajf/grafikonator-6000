<script>
	import { cn } from '$lib/utils.js';
	import Button from '$lib/components/ui/button/button.svelte';
	import Label from '$lib/components/ui/label/label.svelte';

	let {
		id,
		label,
		accept,
		fileName = '',
		disabled = false,
		class: className,
		onchange
	} = $props();

	let inputRef = $state(null);

	function openPicker() {
		inputRef?.click();
	}
</script>

<div class={cn('space-y-2', className)}>
	{#if label}
		<Label for={id}>{label}</Label>
	{/if}
	<div
		class="flex min-h-9 flex-wrap items-center gap-3 rounded-[4px] border border-input bg-card px-3 py-2"
	>
		<input bind:this={inputRef} {id} type="file" {accept} {disabled} class="sr-only" {onchange} />
		<Button type="button" variant="outline" size="sm" {disabled} onclick={openPicker}>
			Wybierz plik
		</Button>
		<span class="min-w-0 flex-1 truncate text-sm {fileName ? 'text-foreground' : 'text-muted-foreground'}">
			{fileName || 'Nie wybrano pliku'}
		</span>
	</div>
</div>
