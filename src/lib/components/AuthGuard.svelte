<script>
    import { onMount } from 'svelte'
    import { user, loading, initAuth } from '$lib/auth.js'
    import AuthForm from './AuthForm.svelte'

    let { children } = $props()

    onMount(async () => {
        await initAuth()
    })
</script>

{#if $loading}
    <div class="min-h-screen flex items-center justify-center bg-gray-50">
        <div class="text-center">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p class="mt-4 text-gray-600">Loading...</p>
        </div>
    </div>
{:else if !$user}
    <AuthForm />
{:else}
    {@render children()}
{/if}
