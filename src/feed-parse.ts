import { parseFeed } from '../shared/feed';
import type { Feed } from '../shared/types';

interface Reply { id: number; feed?: Feed; error?: string }
interface Pending { xml: string; resolve(feed: Feed): void; reject(err: Error): void }

let worker: Worker | null | undefined; // undefined until first needed; null when there is none to be had
let nextId = 1;
const pending = new Map<number, Pending>();

/** Reads a feed in the worker (a 4 MB feed takes about 30 ms, in which the window can't be drawn) or, without one, right here. */
export function parseFeedAsync(xml: string): Promise<Feed> {
  const w = getWorker();
  if (!w) return Promise.resolve().then(() => parseFeed(xml));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { xml, resolve, reject });
    w.postMessage({ id, xml });
  });
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./feed.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  worker?.addEventListener('message', (e: MessageEvent<Reply>) => {
    const { id, feed, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (feed) p.resolve(feed);
    else p.reject(new Error(error ?? 'The feed could not be read'));
  });
  // If the worker can't start (or dies), what it was asked is parsed here instead, and from then on everything is.
  worker?.addEventListener('error', () => {
    worker?.terminate();
    worker = null;
    for (const [id, p] of [...pending]) {
      pending.delete(id);
      try { p.resolve(parseFeed(p.xml)); } catch (err) { p.reject(err as Error); }
    }
  });
  return worker;
}

/** For tests: forget the worker, so the next feed finds (or doesn't find) one again. */
export function resetFeedWorker() {
  worker = undefined;
  pending.clear();
}
