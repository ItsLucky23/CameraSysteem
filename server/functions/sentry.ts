/**
 * Sentry error monitoring initialization for the server.
 * 
 * This module initializes Sentry for capturing errors, performance data,
 * and other monitoring information on the backend.
 * 
 * @see https://docs.sentry.io/platforms/node/
 */

import * as Sentry from '@sentry/node';
import config from '../../config';
import {
  initSharedSentry,
  captureException as sharedCaptureException,
  captureMessage as sharedCaptureMessage,
  setSentryUser as sharedSetSentryUser,
  startSpan as sharedStartSpan,
} from '../../shared/sentrySetup';

/**
 * Initialize Sentry error monitoring.
 * Should be called as early as possible in server startup.
 * 
 * @example
 * ```typescript
 * import { initializeSentry } from './utils/sentry';
 * 
 * // At the very top of server.ts, before any other imports
 * initializeSentry();
 * ```
 */
export const initializeSentry = () => {
  const dsn = process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN;
  const isProduction = process.env.NODE_ENV === 'production';
  const enabledOverride = process.env.SENTRY_ENABLED ?? process.env.VITE_SENTRY_ENABLED;

  if (!dsn) {
    if (process.env.NODE_ENV === 'production') {
      console.log('SENTRY_DSN not configured. Error monitoring disabled.', 'yellow');
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',

    // Performance monitoring
    tracesSampleRate: isProduction
      ? config.sentry.server.tracesSampleRate.production
      : config.sentry.server.tracesSampleRate.development,

    // Profiling (optional - requires @sentry/profiling-node)
    // profilesSampleRate: 0.1,

    // Additional options
    serverName: process.env.PROJECT_NAME || "",

    // Only send errors in production by default
    enabled: isProduction || enabledOverride === 'true',

    // Ignore certain errors
    ignoreErrors: [
      'Socket connection timeout',
      'ECONNREFUSED',
    ],

    // Attach additional context
    beforeSend(event) {
      // Remove sensitive data if needed
      if (event.request?.cookies) {
        delete event.request.cookies;
      }
      return event;
    },
  });

  // Initialize shared Sentry instance for shared utilities
  initSharedSentry(Sentry);

  console.log('Sentry initialized for error monitoring', 'green');
};

export const captureException = (
  error: unknown,
  context?: Record<string, unknown>
): void => {
  return sharedCaptureException(error, context);
};

export const captureMessage = (
  message: string,
  level: 'info' | 'warning' | 'error' | 'fatal' = 'info',
  context?: Record<string, unknown>
): void => {
  return sharedCaptureMessage(message, level, context);
};

export const setSentryUser = (user: {
  id?: string;
  email?: string;
  username?: string;
} | null): void => {
  return sharedSetSentryUser(user);
};

export const startSpan = (name: string, op: string): unknown => {
  return sharedStartSpan(name, op);
};

export default Sentry;
