<script>
	import '../app.css';
	import AuthGuard from '$lib/components/AuthGuard.svelte';
	import { user, signOut } from '$lib/auth.js';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Toaster } from 'svelte-sonner';

	let { children } = $props();

	async function handleSignOut() {
		try {
			await signOut();
		} catch (error) {
			console.error('Error signing out:', error);
		}
	}
</script>

<AuthGuard>
	<div class="min-h-screen bg-gray-50">
		<nav class="bg-white shadow-sm border-b">
			<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div class="flex justify-between h-16">
					<div class="flex items-center">
						<h1 class="text-xl font-bold text-gray-900">Grafikonator 6000</h1>
					</div>
					<div class="flex items-center space-x-4">
						<a href="/" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
							Dashboard
						</a>
						<a href="/individuals" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
							Individuals
						</a>
						<a href="/departments" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
							Departments
						</a>
						<a href="/time-slots" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
							Time Slots
						</a>
						<a href="/availability" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
							Availability
						</a>
						<a href="/schedule" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
							Schedule
						</a>
						<div class="flex items-center space-x-2 border-l pl-4">
							<span class="text-sm text-gray-600">{$user?.email}</span>
							<Button variant="outline" size="sm" onclick={handleSignOut}>
								Sign Out
							</Button>
						</div>
					</div>
				</div>
			</div>
		</nav>

		<main class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
			{@render children()}
		</main>
	</div>
</AuthGuard>

<Toaster
	richColors
	position="bottom-right"
	expand={true}
	duration={4000}
	closeButton={true}
/>
