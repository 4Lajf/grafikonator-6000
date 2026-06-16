<script>
	import { normalizeColor } from '$lib/scheduling/common.js';

	const FALLBACK_SWATCH = '#d1d5db';

	let { value = $bindable(''), id = '', class: className = '' } = $props();

	const swatchColor = $derived(normalizeColor(value) ?? FALLBACK_SWATCH);
	const hasCustomColor = $derived(Boolean(normalizeColor(value)));

	function handleInput(event) {
		value = event.currentTarget.value;
	}

	function clearColor() {
		value = '';
	}
</script>

<div class="color-picker {className}">
	<input
		class="color-picker__input"
		type="color"
		{id}
		value={swatchColor}
		oninput={handleInput}
		aria-label="Wybierz kolor kafelka"
	/>
	{#if hasCustomColor}
		<span class="color-picker__hex">{value}</span>
		<button type="button" class="color-picker__clear" onclick={clearColor} aria-label="Usuń kolor">
			×
		</button>
	{:else}
		<span class="color-picker__hint">Domyślny</span>
	{/if}
</div>

<style>
	.color-picker {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.25rem;
	}

	.color-picker__input {
		width: 2.5rem;
		height: 2.25rem;
		padding: 0.125rem;
		border: 1px solid #dadce0;
		border-radius: 0.375rem;
		background: #fff;
		cursor: pointer;
		flex-shrink: 0;
	}

	.color-picker__input::-webkit-color-swatch-wrapper {
		padding: 0;
	}

	.color-picker__input::-webkit-color-swatch {
		border: none;
		border-radius: 0.25rem;
	}

	.color-picker__input::-moz-color-swatch {
		border: none;
		border-radius: 0.25rem;
	}

	.color-picker__hex {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.75rem;
		color: #5f6368;
	}

	.color-picker__hint {
		font-size: 0.75rem;
		color: #9aa0a6;
	}

	.color-picker__clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border: 1px solid #dadce0;
		border-radius: 999px;
		background: #fff;
		color: #5f6368;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}

	.color-picker__clear:hover {
		background: #f8f9fa;
		color: #202124;
	}
</style>
