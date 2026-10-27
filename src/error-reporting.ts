import { platform } from './platform';

/** Sends errors that nothing in the page caught, and promises that failed unhandled, to the log file. Returns a way to stop. */
export function reportUncaughtErrors(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onError = (e: Event) => {
    const { message, error, filename, lineno, colno } = e as ErrorEvent;
    platform.logError(message || 'error', error?.stack ?? (filename ? `${filename}:${lineno}:${colno}` : undefined));
  };
  const onRejection = (e: Event) => {
    const reason = (e as PromiseRejectionEvent).reason as { message?: string; stack?: string } | string | undefined;
    const message = typeof reason === 'string' ? reason : reason?.message ?? String(reason);
    platform.logError(`unhandled rejection: ${message}`, typeof reason === 'object' ? reason?.stack : undefined);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => { target.removeEventListener('error', onError); target.removeEventListener('unhandledrejection', onRejection); };
}
