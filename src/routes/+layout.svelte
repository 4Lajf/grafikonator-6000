<script>
	import '../app.css';
	import { Toaster } from 'svelte-sonner';
	import { page } from '$app/stores';

	let { children } = $props();

	const navLinks = [
		{ href: '/setup', label: 'Import' },
		{ href: '/convention', label: 'Konwent' },
		{ href: '/people', label: 'Osoby' },
		{ href: '/schedule', label: 'Grafik' }
	];

	const isSchedule = $derived($page.url.pathname === '/schedule');

	function isActive(href, pathname) {
		return pathname === href || pathname.startsWith(`${href}/`);
	}
</script>

<div
	class="flex flex-col bg-background {isSchedule ? 'h-screen overflow-hidden' : 'min-h-screen'}"
>
	<header class="g-app-bar">
		<div class="g-app-bar-inner" class:g-app-bar-inner--wide={!isSchedule}>
			<a href="/" class="g-brand">
				<span class="g-brand-text">Grafikonator 6000</span>
			</a>

			<nav class="g-nav" aria-label="Główne">
				{#each navLinks as link}
					<a
						href={link.href}
						class="g-nav-link"
						class:g-nav-link--active={isActive(link.href, $page.url.pathname)}
					>
						{link.label}
					</a>
				{/each}
			</nav>
		</div>
	</header>

	<main class="flex min-h-0 flex-1 flex-col" class:overflow-hidden={isSchedule}>
		{#if isSchedule}
			{@render children()}
		{:else}
			<div class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
				{@render children()}
			</div>
		{/if}
	</main>
</div>

<Toaster richColors position="bottom-right" expand={true} duration={4000} closeButton={true} />
