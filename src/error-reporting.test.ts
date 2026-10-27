import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportUncaughtErrors } from './error-reporting';
import { platform } from './platform';

let stop: (() => void) | null = null;
afterEach(() => { stop?.(); stop = null; vi.restoreAllMocks(); });

describe('errors nothing caught', () => {
  it('reach the log, with where they came from', () => {
    const log = vi.spyOn(platform, 'logError').mockImplementation(() => {});
    stop = reportUncaughtErrors();
    const error = new Error('boom');
    window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught Error: boom', error }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error', filename: 'app.js', lineno: 4, colno: 9 }));
    expect(log).toHaveBeenNthCalledWith(1, 'Uncaught Error: boom', error.stack);
    expect(log).toHaveBeenNthCalledWith(2, 'Script error', 'app.js:4:9');
  });

  it('include promises that failed with nobody to hear of it', () => {
    const log = vi.spyOn(platform, 'logError').mockImplementation(() => {});
    stop = reportUncaughtErrors();
    const rejection = (reason: unknown) => Object.assign(new Event('unhandledrejection'), { reason });
    const error = new Error('nope');
    window.dispatchEvent(rejection(error));
    window.dispatchEvent(rejection('just a string'));
    window.dispatchEvent(rejection(undefined));
    expect(log).toHaveBeenNthCalledWith(1, 'unhandled rejection: nope', error.stack);
    expect(log).toHaveBeenNthCalledWith(2, 'unhandled rejection: just a string', undefined);
    expect(log).toHaveBeenNthCalledWith(3, 'unhandled rejection: undefined', undefined);
  });

  it('stop being reported when asked', () => {
    const log = vi.spyOn(platform, 'logError').mockImplementation(() => {});
    reportUncaughtErrors()();
    window.dispatchEvent(new ErrorEvent('error', { message: 'late' }));
    expect(log).not.toHaveBeenCalled();
  });
});
