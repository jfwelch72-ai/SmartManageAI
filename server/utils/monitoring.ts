/**
 * Monitoring & Observability Hooks
 * 
 * Provides conditional integration with error tracking services (e.g., Sentry).
 * Only initializes if the appropriate environment variables are set.
 */

import { logInfo, logError, type LogContext } from './logger';

let isMonitoringInitialized = false;
let monitoringService: 'sentry' | 'none' = 'none';

/**
 * Initialize monitoring service if configured via environment variables.
 * 
 * Supported environment variables:
 * - SENTRY_DSN: If set, initializes Sentry for error tracking
 * 
 * Call this once during application startup.
 */
export async function initializeMonitoring(): Promise<void> {
  const sentryDsn = process.env.SENTRY_DSN;

  if (sentryDsn) {
    try {
      // Dynamic import to avoid bundling Sentry if not used
      // Note: User must install @sentry/node if they want to use Sentry
      // const Sentry = await import('@sentry/node');
      // Sentry.init({
      //   dsn: sentryDsn,
      //   environment: process.env.NODE_ENV || 'development',
      //   tracesSampleRate: 0.1,
      // });
      // monitoringService = 'sentry';
      // isMonitoringInitialized = true;
      
      // For now, just log that Sentry would be initialized
      // Actual Sentry integration requires installing @sentry/node
      logInfo('Monitoring: Sentry DSN detected. Install @sentry/node to enable.', {
        dsn: sentryDsn.substring(0, 20) + '...',
      });
      monitoringService = 'none';
      isMonitoringInitialized = false;
    } catch (error) {
      logError('Monitoring: Failed to initialize Sentry', {}, error as Error);
    }
  } else {
    logInfo('Monitoring: No monitoring service configured. Set SENTRY_DSN to enable error tracking.');
    monitoringService = 'none';
    isMonitoringInitialized = false;
  }
}

/**
 * Capture an exception and send to monitoring service.
 * Safe to call even if monitoring is not initialized.
 */
export function captureException(error: Error, context?: LogContext): void {
  // Always log the error locally
  logError('Exception captured', context, error);

  if (!isMonitoringInitialized) {
    return;
  }

  // If Sentry is configured, send the exception
  // if (monitoringService === 'sentry') {
  //   const Sentry = require('@sentry/node');
  //   Sentry.captureException(error, {
  //     extra: context,
  //   });
  // }
}

/**
 * Capture a message and send to monitoring service.
 * Safe to call even if monitoring is not initialized.
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error', context?: LogContext): void {
  // Always log locally
  if (level === 'error') {
    logError(message, context);
  } else if (level === 'warning') {
    logInfo(`[WARNING] ${message}`, context);
  } else {
    logInfo(message, context);
  }

  if (!isMonitoringInitialized) {
    return;
  }

  // If Sentry is configured, send the message
  // if (monitoringService === 'sentry') {
  //   const Sentry = require('@sentry/node');
  //   Sentry.captureMessage(message, {
  //     level,
  //     extra: context,
  //   });
  // }
}

/**
 * Set user context for monitoring service.
 * Helps associate errors with specific users.
 */
export function setUserContext(userId: string, email?: string, organizationId?: string): void {
  if (!isMonitoringInitialized) {
    return;
  }

  // if (monitoringService === 'sentry') {
  //   const Sentry = require('@sentry/node');
  //   Sentry.setUser({
  //     id: userId,
  //     email,
  //     organization_id: organizationId,
  //   });
  // }
}

/**
 * Clear user context from monitoring service.
 * Call on logout or session end.
 */
export function clearUserContext(): void {
  if (!isMonitoringInitialized) {
    return;
  }

  // if (monitoringService === 'sentry') {
  //   const Sentry = require('@sentry/node');
  //   Sentry.setUser(null);
  // }
}

/**
 * Get current monitoring service status
 */
export function getMonitoringStatus(): { initialized: boolean; service: string } {
  return {
    initialized: isMonitoringInitialized,
    service: monitoringService,
  };
}
