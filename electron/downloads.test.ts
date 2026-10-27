// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DownloadManager, moveFiles, targetPath } from './downloads';
import type { DownloadEvent, DownloadJob } from '../shared/types';

const BODY = Buffer.alloc(300_000, 7);
let server: Server;
let base = '';
const ranges: (string | undefined)[] = [];
const hits: Record<string, number> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    ranges.push(req.headers.range);
    const route = req.url!.split('?')[0];
    const hit = (hits[route] = (hits[route] ?? 0) + 1);
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    const start = m ? +m[1] : 0;
    // /flaky: drops the connection part-way, then answers 503, then works.
    if (route === '/flaky' && hit === 1) { res.writeHead(200, { 'Content-Length': BODY.length }); res.write(BODY.subarray(0, 100_000)); setTimeout(() => res.destroy(), 30); return; }
    if (route === '/flaky' && hit === 2) { res.writeHead(503).end(); return; }
    // /stall: sends a little, then goes quiet.
    if (route === '/stall' && hit === 1) { res.writeHead(200, { 'Content-Length': BODY.length }); res.write(BODY.subarray(0, 50_000)); return; }
    const chunk = BODY.subarray(start);
    res.writeHead(m ? 206 : 200, { 'Content-Length': chunk.length, 'Content-Type': 'audio/mpeg' });
    // Trickle so tests can pause mid-way.
    let i = 0;
    const iv = setInterval(() => {
      if (res.destroyed) return clearInterval(iv);
      res.write(chunk.subarray(i, i + 20_000));
      i += 20_000;
      if (i >= chunk.length) { clearInterval(iv); res.end(); }
    }, 15);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const job = (folder: string, key = 'kp:1', route = '/ep.mp3'): DownloadJob => ({ key, url: `${base}${route}?x=1`, folder, showTitle: 'Kernel: Panic/Hour', title: 'Wayland?', pubDate: Date.UTC(2026, 9, 19), mime: 'audio/mpeg' });
const until = (m: DownloadManager, pred: (e: DownloadEvent) => boolean) => new Promise<DownloadEvent>((ok) => m.on('event', (e: DownloadEvent) => { if (pred(e)) ok(e); }));

describe('DownloadManager', () => {
  it('names files safely under the show folder', () => {
    expect(targetPath(job('/tmp/pods'))).toBe('/tmp/pods/Kernel Panic Hour/2026-10-19 - Wayland.mp3');
  });

  it('names a file even when the publish date is unusable', () => {
    for (const pubDate of [NaN, Infinity, 8.64e15 + 1, 0]) {
      expect(targetPath({ ...job('/tmp/pods'), pubDate })).toBe('/tmp/pods/Kernel Panic Hour/undated - Wayland.mp3');
    }
  });

  it('reports a bad download address once, without retrying it', async () => {
    const m = new DownloadManager(async () => { throw new Error('fetch should not be reached'); }, { retryDelays: [10, 10] });
    const events: DownloadEvent[] = [];
    m.on('event', (e: DownloadEvent) => events.push(e));
    const failed = until(m, (e) => e.type === 'error');
    m.start({ ...job('/tmp/pods'), url: 'not a url' });
    expect(await failed).toMatchObject({ type: 'error', message: 'the episode has no valid download address' });
    await new Promise((ok) => setTimeout(ok, 50));
    expect(events.map((e) => e.type)).toEqual(['error']);
    expect(() => m.cancel('kp:1')).not.toThrow();
  });

  it('gives two episodes that share a day and title different files', () => {
    const a = targetPath({ ...job('/tmp/pods'), suffix: 'a1b2c3' });
    const b = targetPath({ ...job('/tmp/pods'), suffix: 'd4e5f6' });
    expect(a).toBe('/tmp/pods/Kernel Panic Hour/2026-10-19 - Wayland [a1b2c3].mp3');
    expect(new Set([a, b, targetPath(job('/tmp/pods'))]).size).toBe(3);
    expect(targetPath({ ...job('/tmp/pods'), suffix: '../../x' })).toBe('/tmp/pods/Kernel Panic Hour/2026-10-19 - Wayland [x].mp3');
  });

  it('keeps a dots-only show title inside the download folder', () => {
    for (const showTitle of ['..', '.', '...', ' .. ']) {
      expect(targetPath({ ...job('/tmp/pods'), showTitle })).toBe('/tmp/pods/untitled/2026-10-19 - Wayland.mp3');
    }
    expect(targetPath({ ...job('/tmp/pods'), showTitle: '.hidden..show' })).toBe('/tmp/pods/.hidden..show/2026-10-19 - Wayland.mp3');
  });

  it('downloads to disk with progress events', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'res-'));
    const m = new DownloadManager();
    const progress: number[] = [];
    m.on('event', (e: DownloadEvent) => { if (e.type === 'progress') progress.push(e.received); });
    m.start(job(dir));
    const done = await until(m, (e) => e.type === 'done');
    expect(done).toMatchObject({ type: 'done', bytes: BODY.length });
    if (done.type === 'done') expect(readFileSync(done.path).equals(BODY)).toBe(true);
    expect(progress.length).toBeGreaterThan(0);
  });

  it('resumes a paused download with a Range request', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'res-'));
    const m = new DownloadManager();
    m.start(job(dir, 'kp:2'));
    await until(m, (e) => e.type === 'progress' && e.received > 0);
    m.setPaused(true);
    await new Promise((r) => setTimeout(r, 50));
    const part = targetPath(job(dir, 'kp:2')) + '.part';
    expect(existsSync(part)).toBe(true);
    ranges.length = 0;
    m.setPaused(false);
    const done = await until(m, (e) => e.type === 'done');
    expect(ranges[0]).toMatch(/^bytes=\d+-$/);
    if (done.type === 'done') expect(readFileSync(done.path).equals(BODY)).toBe(true);
  });

  it('respects the concurrency limit and cancels cleanly', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'res-'));
    const m = new DownloadManager();
    m.setConcurrency(1);
    m.start(job(dir, 'a:1'));
    m.start(job(dir, 'b:1'));
    expect(m.pending()).toEqual(['a:1', 'b:1']);
    m.cancel('a:1');
    const done = await until(m, (e) => e.type === 'done');
    expect(done.key).toBe('b:1');
  });

  it('reports HTTP errors', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'res-'));
    writeFileSync(path.join(dir, 'x'), '');
    const m = new DownloadManager(async () => new Response('nope', { status: 404 }));
    m.start(job(dir, 'z:1'));
    expect(await until(m, (e) => e.type === 'error')).toMatchObject({ key: 'z:1', message: 'HTTP 404' });
  });

  it('retries after a dropped connection and a 503, resuming from the part file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'res-'));
    const m = new DownloadManager(fetch, { retryDelays: [20, 20, 20] });
    const retries: DownloadEvent[] = [];
    m.on('event', (e: DownloadEvent) => { if (e.type === 'retry') retries.push(e); });
    ranges.length = 0;
    m.start(job(dir, 'f:1', '/flaky'));
    const done = await until(m, (e) => e.type === 'done' || e.type === 'error');
    expect(done.type).toBe('done');
    expect(retries.map((r) => r.type === 'retry' && r.attempt)).toEqual([1, 2]);
    expect(ranges.slice(1).every((r) => r === 'bytes=100000-')).toBe(true);
    if (done.type === 'done') expect(readFileSync(done.path).equals(BODY)).toBe(true);
  });

  it('gives up on client errors without retrying, and after the last retry', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'res-'));
    let calls = 0;
    const m404 = new DownloadManager(async () => { calls++; return new Response('', { status: 404 }); }, { retryDelays: [10] });
    m404.start(job(dir, 'n:1'));
    await until(m404, (e) => e.type === 'error');
    expect(calls).toBe(1);
    calls = 0;
    const m500 = new DownloadManager(async () => { calls++; return new Response('', { status: 500 }); }, { retryDelays: [10, 10] });
    m500.start(job(dir, 'n:2'));
    expect(await until(m500, (e) => e.type === 'error')).toMatchObject({ message: 'HTTP 500' });
    expect(calls).toBe(3);
  });

  it('aborts and retries a stalled download', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'res-'));
    const m = new DownloadManager(fetch, { retryDelays: [10], stallMs: 200 });
    m.start(job(dir, 's:1', '/stall'));
    expect(await until(m, (e) => e.type === 'retry')).toMatchObject({ message: 'the connection stalled' });
    const done = await until(m, (e) => e.type === 'done');
    if (done.type === 'done') expect(readFileSync(done.path).equals(BODY)).toBe(true);
  });

  it('tells the UI when a due retry is queued for a slot, and runs it before untouched jobs', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'res-'));
    const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
    const calls: Record<string, number> = {};
    const fakeFetch = async (url: string) => {
      const id = new URL(url).pathname.slice(1);
      calls[id] = (calls[id] ?? 0) + 1;
      if (id === 'a' && calls[id] === 1) throw new Error('socket hang up');
      if (id === 'b') await sleep(150); // keeps the only slot busy past a's retry delay
      return new Response('data', { status: 200, headers: { 'Content-Length': '4' } });
    };
    const m = new DownloadManager(fakeFetch as never, { retryDelays: [20] });
    m.setConcurrency(1);
    const events: string[] = [];
    m.on('event', (e: DownloadEvent) => { if (e.type !== 'progress') events.push(`${e.type} ${e.key}`); });
    for (const id of ['a', 'b', 'c']) m.start({ ...job(dir, id), url: `http://x/${id}` });
    await new Promise<void>((ok) => m.on('event', (e: DownloadEvent) => { if (e.type === 'done' && e.key === 'c') ok(); }));
    // a failed first and is due again while b holds the slot: the UI hears it is queued, and a runs before c.
    expect(events).toEqual(['retry a', 'requeue a', 'done b', 'done a', 'done c']);
  });

  it('takes the total size from Content-Range when resuming', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'res-'));
    const j = job(dir, 'c:1');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.dirname(targetPath(j)), { recursive: true });
    writeFileSync(targetPath(j) + '.part', Buffer.alloc(10, 1));
    const m = new DownloadManager(async () => new Response(new Uint8Array(10).fill(2), { status: 206, headers: { 'content-range': 'bytes 10-19/20', 'content-length': '10' } }));
    const first = until(m, (e) => e.type === 'progress');
    m.start(j);
    expect(await first).toMatchObject({ received: 10, total: 20 });
    const done = await until(m, (e) => e.type === 'done');
    if (done.type === 'done') expect([...readFileSync(done.path)]).toEqual([...Array(10).fill(1), ...Array(10).fill(2)]);
  });

  it('moves downloaded files to a new folder, keeping show sub-folders', async () => {
    const { mkdirSync, readdirSync } = await import('node:fs');
    const root = mkdtempSync(path.join(tmpdir(), 'res-'));
    const a = path.join(root, 'old', 'Show A', 'ep.mp3');
    mkdirSync(path.dirname(a), { recursive: true });
    writeFileSync(a, 'a');
    const outside = path.join(root, 'elsewhere.mp3');
    writeFileSync(outside, 'x');
    const moved = await moveFiles(path.join(root, 'old'), path.join(root, 'new'), [a, outside, path.join(root, 'old', 'gone.mp3')]);
    expect(moved).toEqual([{ from: a, to: path.join(root, 'new', 'Show A', 'ep.mp3') }]);
    expect(readFileSync(moved[0].to, 'utf8')).toBe('a');
    expect(readdirSync(path.join(root, 'old'))).toEqual([]);
    expect(existsSync(outside)).toBe(true);
  });
});
