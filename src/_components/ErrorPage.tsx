/**
 * Custom Error Page Component
 * 
 * This is used as the error boundary fallback for React Router.
 * Uses custom Tailwind colors for consistent branding.
 */

import { useRouteError, isRouteErrorResponse, Link } from 'react-router-dom';
import { useTranslator } from 'src/_functions/translator';

export default function ErrorPage() {
  const translate = useTranslator();
  const error = useRouteError();

  // Determine error type and message
  let errorCode = '500';
  let errorTitle = 'Unexpected Error';
  let errorMessage = 'Something went wrong. Please try again later.';

  if (isRouteErrorResponse(error)) {
    errorCode = error.status.toString();
    errorTitle = error.statusText || 'Error';
    errorMessage = (error.data as { message?: string } | undefined)?.message ?? getErrorMessage(error.status);
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {/* Error Icon */}
      <div className="mb-8 relative">
        <div className="w-32 h-32 rounded-full bg-container1 border border-container1-border flex items-center justify-center">
          <svg
            className="w-16 h-16 text-wrong"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        {/* Floating error code */}
        <div className="absolute -top-2 -right-2 bg-wrong text-white text-2xl font-bold px-3 py-1 rounded-lg shadow-lg">
          {errorCode}
        </div>
      </div>

      {/* Error Content */}
      <div className="text-center max-w-md">
        <h1 className="text-4xl font-bold text-title mb-4">
          {errorTitle}
        </h1>
        <p className="text-muted text-lg mb-8">
          {errorMessage}
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          onClick={() => { globalThis.history.back(); }}
          className="px-6 py-3 bg-container1 text-common border border-container1-border rounded-lg hover:bg-container1-hover transition-colors font-medium"
        >
          {translate({ key: 'errorPage.goBack' })}
        </button>
        <Link
          to="/"
          className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors font-medium"
        >
          {translate({ key: 'errorPage.home' })}
        </Link>
      </div>

      {/* Dev info (only in development) */}
      {import.meta.env.DEV && error instanceof Error && (
        <div className="mt-12 max-w-2xl w-full">
          <details className="bg-container1 rounded-lg p-4 border border-container1-border">
            <summary className="cursor-pointer text-sm text-muted font-medium">
              {translate({ key: 'errorPage.developerDetails' })}
            </summary>
            <pre className="mt-4 text-xs text-wrong overflow-auto p-4 bg-container2 rounded border border-container2-border">
              {error.stack}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function getErrorMessage(status: number): string {
  switch (status) {
    case 400: {
      return 'The request was invalid or malformed.';
    }
    case 401: {
      return 'You need to be logged in to access this page.';
    }
    case 403: {
      return "You don't have permission to access this page.";
    }
    case 404: {
      return "The page you're looking for doesn't exist or has been moved.";
    }
    case 500: {
      return 'Our servers encountered an unexpected error.';
    }
    case 502: {
      return 'Our servers are temporarily unavailable.';
    }
    case 503: {
      return 'The service is temporarily unavailable. Please try again later.';
    }
    default: {
      return 'An unexpected error occurred.';
    }
  }
}
