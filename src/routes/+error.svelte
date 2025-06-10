<script>
    import { page } from '$app/stores'
    import { dev } from '$app/environment'
    import Button from '$lib/components/ui/button/button.svelte'
    import Card from '$lib/components/ui/card/card.svelte'

    $: error = $page.error
    $: status = $page.status

    function getErrorMessage(status, error) {
        switch (status) {
            case 404:
                return 'The page you are looking for could not be found.'
            case 403:
                return 'You do not have permission to access this resource.'
            case 500:
                return 'An internal server error occurred. Please try again later.'
            case 503:
                return 'The service is temporarily unavailable. Please try again later.'
            default:
                return dev && error?.message 
                    ? error.message 
                    : 'An unexpected error occurred.'
        }
    }

    function getErrorTitle(status) {
        switch (status) {
            case 404:
                return 'Page Not Found'
            case 403:
                return 'Access Forbidden'
            case 500:
                return 'Server Error'
            case 503:
                return 'Service Unavailable'
            default:
                return 'Error'
        }
    }

    function goBack() {
        if (window.history.length > 1) {
            window.history.back()
        } else {
            window.location.href = '/'
        }
    }

    function goHome() {
        window.location.href = '/'
    }

    function reportError() {
        // In production, you might want to send error reports to a service
        console.error('Error reported:', { status, error })
        alert('Error report sent. Thank you for helping us improve!')
    }
</script>

<svelte:head>
    <title>{getErrorTitle(status)} - Grafikonator 6000</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full space-y-8">
        <div class="text-center">
            <div class="text-6xl font-bold text-gray-300 mb-4">
                {status}
            </div>
            <h1 class="text-3xl font-bold text-gray-900 mb-2">
                {getErrorTitle(status)}
            </h1>
            <p class="text-gray-600">
                {getErrorMessage(status, error)}
            </p>
        </div>

        <Card class="p-6">
            <div class="space-y-4">
                <div class="flex flex-col space-y-3">
                    <Button onclick={goHome} class="w-full">
                        Go to Homepage
                    </Button>

                    <Button variant="outline" onclick={goBack} class="w-full">
                        Go Back
                    </Button>

                    {#if status >= 500}
                        <Button variant="outline" onclick={reportError} class="w-full">
                            Report This Error
                        </Button>
                    {/if}
                </div>

                {#if dev && error}
                    <details class="mt-6">
                        <summary class="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                            Developer Information
                        </summary>
                        <div class="mt-2 p-3 bg-gray-100 rounded text-xs font-mono">
                            <div><strong>Error:</strong> {error.message}</div>
                            {#if error.stack}
                                <div class="mt-2"><strong>Stack:</strong></div>
                                <pre class="whitespace-pre-wrap text-xs">{error.stack}</pre>
                            {/if}
                        </div>
                    </details>
                {/if}
            </div>
        </Card>

        <div class="text-center text-sm text-gray-500">
            <p>If this problem persists, please contact your system administrator.</p>
        </div>
    </div>
</div>

<style>
    /* Ensure the error page looks good even if CSS fails to load */
    :global(body) {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
</style>
