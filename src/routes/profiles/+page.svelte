<script>
	import { onMount } from 'svelte';
	import { deleteConvention, getConventions, setActiveConvention } from '$lib/database.js';
	import Button from '$lib/components/ui/button/button.svelte';
	import Card from '$lib/components/ui/card/card.svelte';
	import { toast } from 'svelte-sonner';

	let profiles = $state([]);
	let activeId = $state('');
	let loading = $state(true);
	let busyId = $state(null);

	onMount(loadProfiles);

	async function loadProfiles() {
		loading = true;
		try {
			const data = await getConventions();
			profiles = data.conventions;
			activeId = data.activeId ?? '';
		} catch (error) {
			toast.error('Nie udalo sie wczytac profili', { description: error.message });
			profiles = [];
			activeId = '';
		} finally {
			loading = false;
		}
	}

	function notifyProfilesChanged() {
		window.dispatchEvent(new CustomEvent('profiles-changed'));
	}

	async function activateProfile(profile) {
		if (!profile || profile.id === activeId) return;
		busyId = profile.id;
		try {
			await setActiveConvention(profile.id);
			toast.success('Profil aktywny', { description: profile.name });
			await loadProfiles();
			notifyProfilesChanged();
		} catch (error) {
			toast.error('Nie udalo sie przelaczyc profilu', { description: error.message });
		} finally {
			busyId = null;
		}
	}

	async function removeProfile(profile) {
		if (!profile) return;
		const label = profile.name || 'ten profil';
		if (!confirm(`Usunac profil "${label}" wraz z jego grafikiem i danymi? Tej operacji nie mozna cofnac.`)) {
			return;
		}
		busyId = profile.id;
		try {
			await deleteConvention(profile.id);
			toast.success('Profil usuniety', { description: label });
			await loadProfiles();
			notifyProfilesChanged();
		} catch (error) {
			toast.error('Nie udalo sie usunac profilu', { description: error.message });
		} finally {
			busyId = null;
		}
	}

	function modeLabel(mode) {
		return mode === 'people' ? 'Grafik osob' : 'Grafik atrakcji';
	}
</script>

<div class="g-page">
	<header class="g-page-header">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="g-page-title">Profile</h1>
				<p class="g-page-subtitle">
					Oddzielne konwenty i warianty planu zapisane lokalnie w tej przegladarce.
				</p>
			</div>
			<Button href="/setup">Nowy profil</Button>
		</div>
	</header>

	{#if loading}
		<div class="py-12 text-center text-sm text-muted-foreground">Ladowanie profili...</div>
	{:else if profiles.length === 0}
		<Card class="p-8 text-center">
			<h2 class="g-section-title mb-2">Brak profili</h2>
			<p class="mb-4 text-sm text-muted-foreground">
				Utworz pierwszy profil przez import CSV albo reczne wpisanie danych.
			</p>
			<Button href="/setup">Utworz profil</Button>
		</Card>
	{:else}
		<div class="grid gap-4">
			{#each profiles as profile}
				<Card class="p-5">
					<div class="flex flex-wrap items-start justify-between gap-4">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h2 class="truncate text-lg font-medium text-foreground">{profile.name}</h2>
								{#if profile.id === activeId}
									<span class="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
										aktywny
									</span>
								{/if}
							</div>
							<p class="mt-1 text-sm text-muted-foreground">
								{profile.start_date} - {profile.end_date} | {profile.slot_minutes} min | {modeLabel(profile.schedule_mode)}
							</p>
						</div>

						<div class="flex flex-wrap gap-2">
							{#if profile.id !== activeId}
								<Button
									variant="outline"
									onclick={() => activateProfile(profile)}
									disabled={busyId === profile.id}
								>
									Aktywuj
								</Button>
							{/if}
							<Button href="/convention" variant="outline" disabled={profile.id !== activeId}>
								Ustawienia
							</Button>
							<Button href="/schedule" variant={profile.id === activeId ? 'default' : 'outline'} disabled={profile.id !== activeId}>
								Grafik
							</Button>
							<Button
								variant="destructive"
								onclick={() => removeProfile(profile)}
								disabled={busyId === profile.id}
							>
								Usun
							</Button>
						</div>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>
