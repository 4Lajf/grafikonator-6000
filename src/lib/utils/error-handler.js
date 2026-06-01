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

    if (error.code === 'NOT_FOUND') {
        return new AppError('Nie znaleziono', 'NOT_FOUND', 404)
    }

    if (error.code === 'DUPLICATE_RESOURCE' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return new AppError('Zasób już istnieje', 'DUPLICATE_RESOURCE', 409)
    }

    if (error.code === 'FORBIDDEN') {
        return new AppError('Brak uprawnień', 'FORBIDDEN', 403)
    }

    if (error.code === 'UNAUTHORIZED') {
        return new AppError('Wymagane logowanie', 'UNAUTHORIZED', 401)
    }

    return new AppError(
        dev ? error.message : 'Błąd bazy danych',
        'DATABASE_ERROR',
        500
    )
}

/**
 * Authentication error handler
 */
export function handleAuthError(error) {
    console.error('Auth error:', error)

    if (error.code === 'INVALID_CREDENTIALS') {
        return new AppError('Nieprawidłowy e-mail lub hasło', 'INVALID_CREDENTIALS', 401)
    }

    if (error.code === 'USER_EXISTS') {
        return new AppError('Konto z tym adresem e-mail już istnieje', 'USER_EXISTS', 409)
    }

    return new AppError(
        dev ? error.message : 'Błąd logowania',
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
    
    console.error('Unexpected error:', error)
    
    return new AppError(
        dev ? error.message : 'Nieoczekiwany błąd',
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
        return dev ? error.message : 'Wystąpił błąd'
    }
    
    return 'Nieoczekiwany błąd'
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
            
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt - 1)))
        }
    }
    
    throw handleError(lastError)
}
