/**
 * Sentry error monitoring initialization for the client.
 * 
 * This module initializes Sentry for capturing errors, performance data,
 * and session replays on the frontend.
 * 
 * @see https://docs.sentry.io/platforms/javascript/guides/react/
 */

import * as Sentry from '@sentry/react';
import { initSharedSentry } from '../../shared/sentrySetup';
import config from '../../config';

const env = import.meta.env;

/**
 * Initialize Sentry error monitoring for the React application.
 * Should be called as early as possible in the application startup.
 * 
 * @example
 * ```typescript
 * // In main.tsx, before ReactDOM.createRoot
 * import { initializeSentry } from './utils/sentry';
 * initializeSentry();
 * ```
 */
export const initializeSentry = () => {
  const dsn = env.VITE_SENTRY_DSN;
  const isProduction = env.PROD;
  const runtimeEnvironment = isProduction ? 'production' : 'development';
  const enabledInDevelopment = env.VITE_SENTRY_ENABLED === 'true';

  if (!dsn) {
    if (isProduction || enabledInDevelopment) {
      console.warn('VITE_SENTRY_DSN not configured. Error monitoring disabled.');
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: runtimeEnvironment,

    // Performance Monitoring
    tracesSampleRate: isProduction
      ? config.sentry.client.tracesSampleRate.production
      : config.sentry.client.tracesSampleRate.development,

    // Session Replay
    replaysSessionSampleRate: isProduction
      ? config.sentry.client.replaysSessionSampleRate.production
      : config.sentry.client.replaysSessionSampleRate.development,
    replaysOnErrorSampleRate: isProduction
      ? config.sentry.client.replaysOnErrorSampleRate.production
      : config.sentry.client.replaysOnErrorSampleRate.development,

    // Integrations
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Mask all text and block media for privacy
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],

    // Only send errors in production by default
    enabled: isProduction || enabledInDevelopment,

    // Ignore common non-actionable errors
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      /^Network Error$/,
      /^Socket connection/,
    ],

    // Filter out sensitive data
    beforeSend(event) {
      // Remove sensitive URL parameters
      if (event.request?.url) {
        const url = new URL(event.request.url);
        url.searchParams.delete('token');
        url.searchParams.delete('code');
        event.request.url = url.toString();
      }
      return event;
    },
  });

  // Initialize shared Sentry instance
  initSharedSentry(Sentry);

  console.log('Sentry initialized for error monitoring');
};

// Re-export shared capture functions
export * from '../../shared/sentrySetup';

/**
 * Error Boundary component for React.
 * Wrap your app or components to catch and report errors.
 */
export const SentryErrorBoundary = Sentry.ErrorBoundary;

/**
 * HOC to wrap components with Sentry profiling.
 */
export const withSentryProfiler = Sentry.withProfiler;

export default Sentry;
