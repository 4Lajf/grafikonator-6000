import { dev } from '$app/environment'

/**
 * Production-ready logging utility
 */
class Logger {
    constructor() {
        this.isDev = dev
    }

    /**
     * Format log message with timestamp and context
     */
    formatMessage(level, message, context = {}) {
        const timestamp = new Date().toISOString()
        const logEntry = {
            timestamp,
            level,
            message,
            ...context
        }

        return this.isDev 
            ? `[${timestamp}] ${level.toUpperCase()}: ${message}` 
            : JSON.stringify(logEntry)
    }

    /**
     * Log info message
     */
    info(message, context = {}) {
        console.log(this.formatMessage('info', message, context))
    }

    /**
     * Log warning message
     */
    warn(message, context = {}) {
        console.warn(this.formatMessage('warn', message, context))
    }

    /**
     * Log error message
     */
    error(message, error = null, context = {}) {
        const errorContext = {
            ...context,
            ...(error && {
                error: {
                    name: error.name,
                    message: error.message,
                    stack: this.isDev ? error.stack : undefined,
                    code: error.code,
                    statusCode: error.statusCode
                }
            })
        }

        console.error(this.formatMessage('error', message, errorContext))
    }

    /**
     * Log debug message (only in development)
     */
    debug(message, context = {}) {
        if (this.isDev) {
            console.debug(this.formatMessage('debug', message, context))
        }
    }

    /**
     * Log user action for audit trail
     */
    audit(action, userId, details = {}) {
        this.info(`User action: ${action}`, {
            userId,
            action,
            ...details,
            type: 'audit'
        })
    }

    /**
     * Log performance metrics
     */
    performance(operation, duration, details = {}) {
        this.info(`Performance: ${operation}`, {
            operation,
            duration,
            ...details,
            type: 'performance'
        })
    }

    /**
     * Log database operations
     */
    database(operation, table, details = {}) {
        this.debug(`Database: ${operation} on ${table}`, {
            operation,
            table,
            ...details,
            type: 'database'
        })
    }
}

// Export singleton instance
export const logger = new Logger()

/**
 * Performance measurement decorator
 */
export function measurePerformance(operationName) {
    return function(target, propertyName, descriptor) {
        const method = descriptor.value

        descriptor.value = async function(...args) {
            const start = performance.now()
            try {
                const result = await method.apply(this, args)
                const duration = performance.now() - start
                logger.performance(operationName, duration)
                return result
            } catch (error) {
                const duration = performance.now() - start
                logger.performance(operationName, duration, { error: true })
                throw error
            }
        }

        return descriptor
    }
}

/**
 * Async operation wrapper with logging
 */
export async function loggedOperation(operationName, operation, context = {}) {
    const start = performance.now()
    
    try {
        logger.debug(`Starting operation: ${operationName}`, context)
        const result = await operation()
        const duration = performance.now() - start
        logger.performance(operationName, duration, { success: true })
        return result
    } catch (error) {
        const duration = performance.now() - start
        logger.error(`Operation failed: ${operationName}`, error, { 
            ...context, 
            duration 
        })
        throw error
    }
}
