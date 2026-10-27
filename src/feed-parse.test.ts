import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseFeed } from '../shared/feed';
import { parseFeedAsync, resetFeedWorker } from './feed-parse';

const xml = readFileSync('test/fixtures/feed.xml', 'utf8');

class FakeWorker {
  static last: FakeWorker;
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  sent: { id: number; xml: string }[] = [];
  terminated = false;
  constructor(readonly url: URL, readonly options: unknown) { FakeWorker.last = this; }
  addEventListener(type: string, fn: (e: unknown) => void) { (this.listeners[type] ??= []).push(fn); }
  postMessage(m: { id: number; xml: string }) { this.sent.push(m); }
  terminate() { this.terminated = true; }
  emit(type: string, data?: unknown) { this.listeners[type]?.forEach((fn) => fn({ data })); }
}

beforeEach(() => resetFeedWorker());
afterEach(() => { vi.unstubAllGlobals(); resetFeedWorker(); });

describe('reading a feed off the main thread', () => {
  it('parses right here when there is no worker to be had', async () => {
    expect(typeof Worker).toBe('undefined'); // jsdom
    expect(await parseFeedAsync(xml)).toEqual(parseFeed(xml));
    await expect(parseFeedAsync('<html></html>')).rejects.toThrow('Not a podcast RSS feed');
  });

  it('asks a module worker, and matches each answer to its request', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const a = parseFeedAsync('first');
    const b = parseFeedAsync('second');
    const w = FakeWorker.last;
    expect(w.options).toEqual({ type: 'module' });
    expect(w.url.pathname).toMatch(/feed\.worker\.ts$/);
    expect(w.sent.map((m) => m.xml)).toEqual(['first', 'second']);
    const feed = (title: string) => ({ title, author: '', description: '', category: '', episodes: [] });
    w.emit('message', { id: w.sent[1].id, feed: feed('B') });
    w.emit('message', { id: w.sent[0].id, feed: feed('A') });
    expect((await a).title).toBe('A');
    expect((await b).title).toBe('B');
    w.emit('message', { id: 999, feed: feed('nobody asked') }); // an answer no one is waiting for is ignored
    expect(FakeWorker.last).toBe(w); // one worker is kept for all of them
  });

  it('turns a failure in the worker into an error with the same message', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const p = parseFeedAsync('x');
    FakeWorker.last.emit('message', { id: FakeWorker.last.sent[0].id, error: 'The feed is not valid XML' });
    await expect(p).rejects.toThrow('The feed is not valid XML');
  });

  it('parses here what a worker that failed to start was asked, and everything after it', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const first = parseFeedAsync(xml);
    const w = FakeWorker.last;
    w.emit('error');
    expect(await first).toEqual(parseFeed(xml));
    expect(w.terminated).toBe(true);
    const later = await parseFeedAsync(xml);
    expect(later.title).toBe('Kernel Panic Hour');
    expect(FakeWorker.last).toBe(w); // no new worker was started
    expect(w.sent).toHaveLength(1);
  });
});
