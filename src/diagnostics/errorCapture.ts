import { useDiagnosticsStore } from './diagnosticsStore';

/**
 * Records uncaught errors and unhandled promise rejections into the diagnostics store.
 * It observes only: it never calls preventDefault, so errors still reach the console unchanged.
 */

export function describeUnknownError(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    return String(reason);
  }
}

/** Installs listeners on `target`. Returns a function that removes them. */
export function installRuntimeErrorCapture(target: Window): () => void {
  const onError = (event: ErrorEvent): void => {
    const location = event.filename ? ` (${event.filename}:${event.lineno})` : '';
    useDiagnosticsStore.getState().pushError('window.error', `${event.message}${location}`);
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    useDiagnosticsStore.getState().pushError('unhandledrejection', describeUnknownError(event.reason));
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
