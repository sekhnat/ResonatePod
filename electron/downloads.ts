import { EventEmitter } from 'node:events';
import { createWriteStream, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { DownloadEvent, DownloadJob } from '../shared/types';

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export const expandHome = (p: string) => (p === '~' || p.startsWith('~/') ? path.join(homedir(), p.slice(1)) : p);

// A name made only of dots ("." or "..") would walk out of its folder, so it counts as no name at all.
const safe = (s: string) => {
  const name = s.replace(/[/\\:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return /^\.*$/.test(name) ? 'untitled' : name;
};

const EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'video/mp4': 'mp4', 'video/x-m4v': 'm4v', 'video/quicktime': 'mov', 'video/webm': 'webm' };

/** A job that can't succeed however often it is tried, as opposed to a network hiccup. */
export class JobError extends Error {}

export function targetPath(job: DownloadJob) {
  let pathname: string;
  try { pathname = new URL(job.url).pathname; } catch { throw new JobError('the episode has no valid download address'); }
  const fromUrl = /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(pathname)?.[1];
  const ext = (fromUrl ?? EXT[job.mime] ?? 'mp3').toLowerCase();
  const published = new Date(job.pubDate).getTime();
  const date = job.pubDate && Number.isFinite(published) ? new Date(published).toISOString().slice(0, 10) : 'undated';
  return path.join(expandHome(job.folder), safe(job.showTitle), `${date} - ${safe(job.title)}.${ext}`);
}

interface Queued { job: DownloadJob; attempt: number }
interface Running extends Queued { ctrl: AbortController }

export interface DownloadOptions {
  /** Waits before each automatic retry; the length is the number of retries. */
  retryDelays?: number[];
  /** Abort and retry when no data arrives for this long. */
  stallMs?: number;
}

class HttpError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); }
}

/** Network errors, stalls, timeouts, rate limits and server errors are worth retrying; other HTTP errors and bad jobs are not. */
const retryable = (err: unknown) => !(err instanceof JobError) && (!(err instanceof HttpError) || err.status === 408 || err.status === 429 || err.status >= 500);

/**
 * Downloads episodes with a concurrency limit. Partial data goes to `<file>.part`;
 * pausing aborts the request but keeps the part file so resuming sends a Range request.
 * Failures that look temporary are retried with backoff, resuming from the part file.
 */
export class DownloadManager extends EventEmitter {
  private queue: Queued[] = [];
  private running = new Map<string, Running>();
  private waiting = new Map<string, { item: Queued; timer: ReturnType<typeof setTimeout> }>();
  private concurrency = 2;
  private paused = false;
  private retryDelays: number[];
  private stallMs: number;

  constructor(private fetchImpl: Fetch = fetch, opts: DownloadOptions = {}) {
    super();
    this.retryDelays = opts.retryDelays ?? [5_000, 15_000, 45_000, 120_000, 300_000];
    this.stallMs = opts.stallMs ?? 60_000;
  }

  emitEvent(e: DownloadEvent) { this.emit('event', e); }

  start(job: DownloadJob) {
    if (this.running.has(job.key) || this.queue.some((q) => q.job.key === job.key)) return;
    // A retry that was waiting out its delay goes first: it has already waited, and has data on disk.
    const retrying = this.waiting.has(job.key);
    this.clearWait(job.key);
    const item = { job, attempt: 0 };
    if (retrying) this.queue.unshift(item);
    else this.queue.push(item);
    this.pump();
  }

  cancel(key: string) {
    this.queue = this.queue.filter((q) => q.job.key !== key);
    const w = this.waiting.get(key);
    this.clearWait(key);
    const r = this.running.get(key);
    if (r) {
      this.running.delete(key);
      r.ctrl.abort('cancel');
    }
    const job = r?.job ?? w?.item.job;
    if (job) {
      try { fs.rm(targetPath(job) + '.part', { force: true }).catch(() => {}); } catch { /* no usable path, so no part file */ }
    }
    this.pump();
  }

  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      for (const [key, r] of this.running) { r.ctrl.abort('pause'); this.queue.unshift({ job: r.job, attempt: r.attempt }); this.running.delete(key); this.emitEvent({ type: 'requeue', key }); }
    }
    this.pump();
  }

  setConcurrency(n: number) {
    this.concurrency = Math.max(1, n);
    while (this.running.size > this.concurrency) {
      const [key, r] = [...this.running].pop()!;
      r.ctrl.abort('pause');
      this.running.delete(key);
      this.queue.unshift({ job: r.job, attempt: r.attempt });
      this.emitEvent({ type: 'requeue', key });
    }
    this.pump();
  }

  /** Keys in order: running first, then queued, then waiting to retry. */
  pending() { return [...this.running.keys(), ...this.queue.map((q) => q.job.key), ...this.waiting.keys()]; }

  private clearWait(key: string) {
    const w = this.waiting.get(key);
    if (w) { clearTimeout(w.timer); this.waiting.delete(key); }
  }

  private pump() {
    while (!this.paused && this.running.size < this.concurrency && this.queue.length) {
      const item = this.queue.shift()!;
      const r: Running = { ...item, ctrl: new AbortController() };
      this.running.set(item.job.key, r);
      this.run(r).catch((err) => this.failed(r, err));
    }
  }

  private failed(r: Running, err: unknown) {
    const stalled = r.ctrl.signal.aborted && r.ctrl.signal.reason === 'stall';
    if (r.ctrl.signal.aborted && !stalled) return; // paused or cancelled
    if (this.running.get(r.job.key) !== r) return;
    this.running.delete(r.job.key);
    const message = stalled ? 'the connection stalled' : (err as Error).message;
    const delay = this.retryDelays[r.attempt];
    if (retryable(err) && delay != null) {
      const item = { job: r.job, attempt: r.attempt + 1 };
      // Due again: it has waited its turn already, so it goes ahead of jobs that haven't started.
      const timer = setTimeout(() => { this.waiting.delete(r.job.key); this.queue.unshift(item); this.emitEvent({ type: 'requeue', key: r.job.key }); this.pump(); }, delay);
      this.waiting.set(r.job.key, { item, timer });
      this.emitEvent({ type: 'retry', key: r.job.key, attempt: item.attempt, at: Date.now() + delay, message });
    } else {
      this.emitEvent({ type: 'error', key: r.job.key, message });
    }
    this.pump();
  }

  private async run(r: Running) {
    const dest = targetPath(r.job);
    const part = dest + '.part';
    let lastData = Date.now();
    const dog = setInterval(() => { if (Date.now() - lastData > this.stallMs) r.ctrl.abort('stall'); }, Math.min(5000, Math.max(10, this.stallMs / 4)));
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const have = await fs.stat(part).then((s) => s.size, () => 0);
      const res = await this.fetchImpl(r.job.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: r.ctrl.signal });
      if (res.status === 416 && have) {
        // The part file doesn't match what the server has now; start over.
        await fs.rm(part, { force: true });
        throw new Error('the server rejected the resume');
      }
      if (!res.ok && res.status !== 206) throw new HttpError(res.status);
      lastData = Date.now();
      const resumed = res.status === 206 && have > 0;
      let received = resumed ? have : 0;
      const len = Number(res.headers.get('content-length') ?? 0);
      const fromRange = Number(/\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? 0);
      const total = fromRange || (len ? len + received : 0);
      this.emitEvent({ type: 'progress', key: r.job.key, received, total, speed: 0 });
      const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' });
      const reader = res.body!.getReader();
      let lastEmit = 0;
      let window = { t: Date.now(), bytes: received };
      let speed = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!out.write(value)) await new Promise((ok) => out.once('drain', ok));
          received += value.byteLength;
          const now = Date.now();
          lastData = now;
          if (now - window.t >= 1000) { speed = ((received - window.bytes) * 1000) / (now - window.t); window = { t: now, bytes: received }; }
          if (now - lastEmit > 250) { lastEmit = now; this.emitEvent({ type: 'progress', key: r.job.key, received, total, speed }); }
        }
      } finally {
        await new Promise<void>((ok) => out.end(ok));
      }
      if (r.ctrl.signal.aborted) return;
      if (total && received < total) throw new Error('the connection closed early');
      await fs.rename(part, dest);
      this.running.delete(r.job.key);
      this.emitEvent({ type: 'done', key: r.job.key, path: dest, bytes: received });
      this.pump();
    } finally {
      clearInterval(dog);
    }
  }
}

export async function diskUsage(folder: string): Promise<number> {
  const root = expandHome(folder);
  let total = 0;
  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) total += (await fs.stat(p).catch(() => ({ size: 0 }))).size;
    }
  };
  await walk(root);
  return total;
}

/**
 * Moves downloaded files from one download folder to another, keeping their
 * place relative to the folder (`<Show>/<file>`). Files outside `from` are left
 * alone. Falls back to copy + delete across file systems. Returns what moved.
 */
export async function moveFiles(from: string, to: string, files: string[]): Promise<{ from: string; to: string }[]> {
  const src = expandHome(from);
  const dst = expandHome(to);
  const moved: { from: string; to: string }[] = [];
  for (const f of files) {
    const rel = path.relative(src, f);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const target = path.join(dst, rel);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.rename(f, target);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        await fs.copyFile(f, target);
        await fs.rm(f);
      }
      moved.push({ from: f, to: target });
      await fs.rmdir(path.dirname(f)).catch(() => {}); // only succeeds once the show folder is empty
    } catch {
      // Missing or unreadable: leave its record pointing where it was.
    }
  }
  return moved;
}
