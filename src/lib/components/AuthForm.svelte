<script>
    import { signIn, signUp } from '$lib/auth.js'
    import Button from '$lib/components/ui/button/button.svelte'
    import Card from '$lib/components/ui/card/card.svelte'
    import Input from '$lib/components/ui/input/input.svelte'
    import Label from '$lib/components/ui/label/label.svelte'
    import { toast } from 'svelte-sonner'

    let isSignUp = false
    let email = ''
    let password = ''
    let confirmPassword = ''
    let loading = false
    let error = ''

    async function handleSubmit() {
        if (!email || !password) {
            toast.error('Missing information', {
                description: 'Please fill in all fields.'
            })
            return
        }

        if (isSignUp && password !== confirmPassword) {
            toast.error('Password mismatch', {
                description: 'Passwords do not match.'
            })
            return
        }

        if (password.length < 6) {
            toast.error('Password too short', {
                description: 'Password must be at least 6 characters.'
            })
            return
        }

        loading = true
        error = ''

        try {
            if (isSignUp) {
                const result = await signUp(email, password)
                if (result.user && !result.session) {
                    toast.info('Check your email', {
                        description: 'Please check your email for a confirmation link to complete registration.'
                    })
                } else {
                    toast.success('Account created!', {
                        description: 'Welcome to Grafikonator 6000!'
                    })
                }
            } else {
                await signIn(email, password)
                toast.success('Welcome back!', {
                    description: 'Successfully signed in to Grafikonator 6000.'
                })
            }
        } catch (err) {
            toast.error(isSignUp ? 'Sign up failed' : 'Sign in failed', {
                description: err.message || 'An error occurred. Please try again.'
            })
        } finally {
            loading = false
        }
    }

    function toggleMode() {
        isSignUp = !isSignUp
        error = ''
        password = ''
        confirmPassword = ''
    }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full space-y-8">
        <div>
            <h2 class="mt-6 text-center text-3xl font-bold text-gray-900">
                {isSignUp ? 'Create your account' : 'Sign in to your account'}
            </h2>
            <p class="mt-2 text-center text-sm text-gray-600">
                Access Grafikonator 6000 Scheduling System
            </p>
        </div>

        <Card class="p-8">
            <form onsubmit={(e) => { e.preventDefault(); handleSubmit(e); }} class="space-y-6">

                <div class="space-y-4">
                    <div>
                        <Label for="email">Email address</Label>
                        <Input
                            id="email"
                            type="email"
                            bind:value={email}
                            required
                            placeholder="Enter your email"
                            disabled={loading}
                        />
                    </div>

                    <div>
                        <Label for="password">Password</Label>
                        <Input
                            id="password"
                            type="password"
                            bind:value={password}
                            required
                            placeholder="Enter your password"
                            disabled={loading}
                        />
                    </div>

                    {#if isSignUp}
                        <div>
                            <Label for="confirmPassword">Confirm Password</Label>
                            <Input
                                id="confirmPassword"
                                type="password"
                                bind:value={confirmPassword}
                                required
                                placeholder="Confirm your password"
                                disabled={loading}
                            />
                        </div>
                    {/if}
                </div>

                <div>
                    <Button
                        type="submit"
                        class="w-full"
                        disabled={loading}
                    >
                        {loading ? 'Please wait...' : (isSignUp ? 'Sign up' : 'Sign in')}
                    </Button>
                </div>

                <div class="text-center">
                    <button
                        type="button"
                        onclick={toggleMode}
                        class="text-sm text-blue-600 hover:text-blue-500"
                        disabled={loading}
                    >
                        {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
                    </button>
                </div>
            </form>
        </Card>

        <div class="text-center text-xs text-gray-500">
            <p>Secure access to your scheduling management system.</p>
        </div>
    </div>
</div>
