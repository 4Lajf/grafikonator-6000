<script>
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: className,
		...restProps
	} = $props();
</script>

{#if type === "file"}
	<input
		bind:this={ref}
		data-slot="input"
		class={cn(
			"border-input bg-card selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground flex h-9 w-full min-w-0 rounded-[4px] border px-3 py-1 text-sm outline-none transition-[border-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50",
			"focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20",
			"aria-invalid:border-destructive aria-invalid:ring-destructive/20",
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot="input"
		class={cn(
			"border-input bg-card selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground flex h-9 w-full min-w-0 rounded-[4px] border px-3 py-1 text-sm outline-none transition-[border-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50",
			"focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20",
			"aria-invalid:border-destructive aria-invalid:ring-destructive/20",
			className
		)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}