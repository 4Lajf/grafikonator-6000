import { writable } from 'svelte/store'
import { supabase } from './supabase.js'
import { handleAuthError } from './utils/error-handler.js'
import { logger } from './utils/logger.js'

// Create stores for user and loading state
export const user = writable(null)
export const loading = writable(true)

// Initialize auth state
export async function initAuth() {
    loading.set(true)
    
    try {
        // Get initial session
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
            console.error('Error getting session:', error)
            user.set(null)
        } else {
            user.set(session?.user ?? null)
        }
        
        // Listen for auth changes
        supabase.auth.onAuthStateChange((event, session) => {
            console.log('Auth state changed:', event, session?.user?.email)
            user.set(session?.user ?? null)
        })
        
    } catch (error) {
        console.error('Error initializing auth:', error)
        user.set(null)
    } finally {
        loading.set(false)
    }
}

// Sign up with email and password
export async function signUp(email, password) {
    try {
        logger.info('User signup attempt', { email })

        const { data, error } = await supabase.auth.signUp({
            email,
            password
        })

        if (error) {
            logger.error('Signup failed', error, { email })
            throw handleAuthError(error)
        }

        logger.audit('user_signup', data.user?.id, { email })
        return data
    } catch (error) {
        if (error.name === 'AppError') {
            throw error
        }
        logger.error('Unexpected signup error', error, { email })
        throw handleAuthError(error)
    }
}

// Sign in with email and password
export async function signIn(email, password) {
    try {
        logger.info('User signin attempt', { email })

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        })

        if (error) {
            logger.error('Signin failed', error, { email })
            throw handleAuthError(error)
        }

        logger.audit('user_signin', data.user?.id, { email })
        return data
    } catch (error) {
        if (error.name === 'AppError') {
            throw error
        }
        logger.error('Unexpected signin error', error, { email })
        throw handleAuthError(error)
    }
}

// Sign out
export async function signOut() {
    const { error } = await supabase.auth.signOut()
    
    if (error) {
        throw error
    }
}

// Get current user
export function getCurrentUser() {
    return supabase.auth.getUser()
}

// Check if user is authenticated
export function isAuthenticated() {
    let currentUser = null
    user.subscribe(value => currentUser = value)()
    return currentUser !== null
}
