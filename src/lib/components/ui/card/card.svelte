<script>
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	class={cn(
		"bg-card text-card-foreground flex flex-col gap-4 rounded-lg border border-border py-6 shadow-none",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>