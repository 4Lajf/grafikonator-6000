import { dev } from '$app/environment'

/**
 * Enhanced error handling for production
 */
export class AppError extends Error {
    constructor(message, code = 'UNKNOWN_ERROR', statusCode = 500, isOperational = true) {
        super(message)
        this.name = 'AppError'
        this.code = code
        this.statusCode = statusCode
        this.isOperational = isOperational
        this.timestamp = new Date().toISOString()
        
        Error.captureStackTrace(this, this.constructor)
    }
}

/**
 * Database error handler
 */
export function handleDatabaseError(error) {
    console.error('Database error:', error)
    
    // Supabase specific error handling
    if (error.code === 'PGRST116') {
        return new AppError('Resource not found', 'NOT_FOUND', 404)
    }
    
    if (error.code === '23505') {
        return new AppError('Resource already exists', 'DUPLICATE_RESOURCE', 409)
    }
    
    if (error.code === '42501') {
        return new AppError('Insufficient permissions', 'FORBIDDEN', 403)
    }
    
    if (error.message?.includes('JWT')) {
        return new AppError('Authentication required', 'UNAUTHORIZED', 401)
    }
    
    // Generic database error
    return new AppError(
        dev ? error.message : 'Database operation failed',
        'DATABASE_ERROR',
        500
    )
}

/**
 * Authentication error handler
 */
export function handleAuthError(error) {
    console.error('Auth error:', error)
    
    if (error.message?.includes('Invalid login credentials')) {
        return new AppError('Invalid email or password', 'INVALID_CREDENTIALS', 401)
    }
    
    if (error.message?.includes('Email not confirmed')) {
        return new AppError('Please confirm your email address', 'EMAIL_NOT_CONFIRMED', 401)
    }
    
    if (error.message?.includes('User already registered')) {
        return new AppError('An account with this email already exists', 'USER_EXISTS', 409)
    }
    
    return new AppError(
        dev ? error.message : 'Authentication failed',
        'AUTH_ERROR',
        401
    )
}

/**
 * Generic error handler
 */
export function handleError(error) {
    if (error instanceof AppError) {
        return error
    }
    
    // Log unexpected errors
    console.error('Unexpected error:', error)
    
    return new AppError(
        dev ? error.message : 'An unexpected error occurred',
        'INTERNAL_ERROR',
        500
    )
}

/**
 * Client-side error display
 */
export function getErrorMessage(error) {
    if (error instanceof AppError) {
        return error.message
    }
    
    if (typeof error === 'string') {
        return error
    }
    
    if (error?.message) {
        return dev ? error.message : 'An error occurred'
    }
    
    return 'An unexpected error occurred'
}

/**
 * Retry mechanism for failed operations
 */
export async function withRetry(operation, maxRetries = 3, delay = 1000) {
    let lastError
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation()
        } catch (error) {
            lastError = error
            
            if (attempt === maxRetries) {
                throw handleError(error)
            }
            
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt - 1)))
        }
    }
    
    throw handleError(lastError)
}
