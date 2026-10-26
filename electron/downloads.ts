import { EventEmitter } from 'node:events';
import { createWriteStream, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { DownloadEvent, DownloadJob } from '../shared/types';

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export const expandHome = (p: string) => (p === '~' || p.startsWith('~/') ? path.join(homedir(), p.slice(1)) : p);

const safe = (s: string) => s.replace(/[/\\:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled';

const EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'video/mp4': 'mp4' };

export function targetPath(job: DownloadJob) {
  const fromUrl = /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(new URL(job.url).pathname)?.[1];
  const ext = (fromUrl ?? EXT[job.mime] ?? 'mp3').toLowerCase();
  const date = job.pubDate ? new Date(job.pubDate).toISOString().slice(0, 10) : 'undated';
  return path.join(expandHome(job.folder), safe(job.showTitle), `${date} - ${safe(job.title)}.${ext}`);
}

interface Running { job: DownloadJob; ctrl: AbortController }

/**
 * Downloads episodes with a concurrency limit. Partial data goes to `<file>.part`;
 * pausing aborts the request but keeps the part file so resuming sends a Range request.
 */
export class DownloadManager extends EventEmitter {
  private queue: DownloadJob[] = [];
  private running = new Map<string, Running>();
  private concurrency = 2;
  private paused = false;

  constructor(private fetchImpl: Fetch = fetch) { super(); }

  emitEvent(e: DownloadEvent) { this.emit('event', e); }

  start(job: DownloadJob) {
    if (this.running.has(job.key) || this.queue.some((j) => j.key === job.key)) return;
    this.queue.push(job);
    this.pump();
  }

  cancel(key: string) {
    this.queue = this.queue.filter((j) => j.key !== key);
    const r = this.running.get(key);
    if (r) {
      this.running.delete(key);
      r.ctrl.abort('cancel');
      fs.rm(targetPath(r.job) + '.part', { force: true }).catch(() => {});
    }
    this.pump();
  }

  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      for (const [key, r] of this.running) { r.ctrl.abort('pause'); this.queue.unshift(r.job); this.running.delete(key); }
    }
    this.pump();
  }

  setConcurrency(n: number) {
    this.concurrency = Math.max(1, n);
    while (this.running.size > this.concurrency) {
      const [key, r] = [...this.running].pop()!;
      r.ctrl.abort('pause');
      this.running.delete(key);
      this.queue.unshift(r.job);
    }
    this.pump();
  }

  /** Keys in order: running first, then queued. */
  pending() { return [...this.running.keys(), ...this.queue.map((j) => j.key)]; }

  private pump() {
    while (!this.paused && this.running.size < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      const r: Running = { job, ctrl: new AbortController() };
      this.running.set(job.key, r);
      this.run(r).catch((err) => {
        if (r.ctrl.signal.aborted) return;
        this.running.delete(job.key);
        this.emitEvent({ type: 'error', key: job.key, message: (err as Error).message });
        this.pump();
      });
    }
  }

  private async run(r: Running) {
    const dest = targetPath(r.job);
    const part = dest + '.part';
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const have = await fs.stat(part).then((s) => s.size, () => 0);
    const res = await this.fetchImpl(r.job.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: r.ctrl.signal });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
    const resumed = res.status === 206 && have > 0;
    let received = resumed ? have : 0;
    const len = Number(res.headers.get('content-length') ?? 0);
    const total = len ? len + received : 0;
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
        if (now - window.t >= 1000) { speed = ((received - window.bytes) * 1000) / (now - window.t); window = { t: now, bytes: received }; }
        if (now - lastEmit > 250) { lastEmit = now; this.emitEvent({ type: 'progress', key: r.job.key, received, total, speed }); }
      }
    } finally {
      await new Promise<void>((ok) => out.end(ok));
    }
    if (r.ctrl.signal.aborted) return;
    await fs.rename(part, dest);
    this.running.delete(r.job.key);
    this.emitEvent({ type: 'done', key: r.job.key, path: dest, bytes: received });
    this.pump();
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
