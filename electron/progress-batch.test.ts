// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadEvent, DownloadMessage } from '../shared/types';
import { batchProgress } from './progress-batch';

const progress = (key: string, received: number): DownloadEvent => ({ type: 'progress', key, received, total: 100, speed: 1 });

let sent: DownloadMessage[];
let feed: (e: DownloadEvent) => void;
beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  feed = batchProgress((e) => sent.push(e), 250);
});
afterEach(() => vi.useRealTimers());

describe('batchProgress', () => {
  it('sends the latest progress of every download as one message per tick', () => {
    feed(progress('a', 10));
    feed(progress('b', 5));
    feed(progress('a', 20));
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(250);
    expect(sent).toEqual([{ type: 'progressBatch', items: [
      { key: 'a', received: 20, total: 100, speed: 1 },
      { key: 'b', received: 5, total: 100, speed: 1 },
    ] }]);
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1); // nothing new, nothing sent
  });

  it('sends any other event at once, after the progress that came before it', () => {
    feed(progress('a', 10));
    feed({ type: 'done', key: 'a', path: '/p/a.mp3', bytes: 100 });
    expect(sent.map((e) => e.type)).toEqual(['progressBatch', 'done']);
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(2); // the timer was cleared with the flush
  });

  it('starts a new tick after a flush', () => {
    feed(progress('a', 10));
    vi.advanceTimersByTime(250);
    feed(progress('a', 30));
    vi.advanceTimersByTime(250);
    expect(sent.map((e) => (e.type === 'progressBatch' ? e.items[0].received : e.type))).toEqual([10, 30]);
  });

  it('passes events through untouched when no progress is waiting', () => {
    const retry: DownloadEvent = { type: 'retry', key: 'a', attempt: 1, at: 5, message: 'HTTP 503' };
    feed(retry);
    expect(sent).toEqual([retry]);
  });
});
