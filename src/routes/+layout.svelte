<script>
	import '../app.css';
	import { Toaster } from 'svelte-sonner';
	import { page } from '$app/stores';
	import { afterNavigate } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getConventions, setActiveConvention } from '$lib/database.js';

	let { children } = $props();
	let profiles = $state([]);
	let activeProfileId = $state('');
	let profileLoading = $state(false);

	const navLinks = [
		{ href: '/profiles', label: 'Profile' },
		{ href: '/setup', label: 'Import' },
		{ href: '/convention', label: 'Konwent' },
		{ href: '/people', label: 'Osoby' },
		{ href: '/schedule', label: 'Grafik' }
	];

	const isSchedule = $derived($page.url.pathname === '/schedule');

	function isActive(href, pathname) {
		return pathname === href || pathname.startsWith(`${href}/`);
	}

	async function loadProfiles() {
		try {
			const data = await getConventions();
			profiles = data.conventions;
			activeProfileId = data.activeId ?? '';
		} catch {
			profiles = [];
			activeProfileId = '';
		}
	}

	async function handleProfileChange(event) {
		const nextId = event.currentTarget.value;
		if (!nextId || nextId === activeProfileId) return;
		profileLoading = true;
		try {
			await setActiveConvention(nextId);
			activeProfileId = nextId;
			window.location.reload();
		} finally {
			profileLoading = false;
		}
	}

	onMount(() => {
		loadProfiles();
		const refresh = () => loadProfiles();
		window.addEventListener('profiles-changed', refresh);
		return () => window.removeEventListener('profiles-changed', refresh);
	});

	afterNavigate(() => {
		loadProfiles();
	});
</script>

<div class="flex min-h-screen flex-col bg-background">
	<header class="g-app-bar">
		<div class="g-app-bar-inner" class:g-app-bar-inner--wide={!isSchedule}>
			<a href="/" class="g-brand">
				<span class="g-brand-text">Grafikonator 6000</span>
			</a>

			<div class="g-app-actions">
				{#if profiles.length > 0}
					<label class="g-profile-switcher" title="Aktywny profil">
						<span class="sr-only">Aktywny profil</span>
						<select
							class="g-profile-select"
							value={activeProfileId}
							disabled={profileLoading}
							onchange={handleProfileChange}
						>
							{#each profiles as profile}
								<option value={profile.id}>{profile.name}</option>
							{/each}
						</select>
					</label>
				{/if}

				<nav class="g-nav" aria-label="Glowne">
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
