// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DownloadManager, targetPath } from './downloads';
import type { DownloadEvent, DownloadJob } from '../shared/types';

const BODY = Buffer.alloc(300_000, 7);
let server: Server;
let base = '';
const ranges: (string | undefined)[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    ranges.push(req.headers.range);
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    const start = m ? +m[1] : 0;
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

const job = (folder: string, key = 'kp:1'): DownloadJob => ({ key, url: `${base}/ep.mp3?x=1`, folder, showTitle: 'Kernel: Panic/Hour', title: 'Wayland?', pubDate: Date.UTC(2026, 9, 19), mime: 'audio/mpeg' });
const until = (m: DownloadManager, pred: (e: DownloadEvent) => boolean) => new Promise<DownloadEvent>((ok) => m.on('event', (e: DownloadEvent) => { if (pred(e)) ok(e); }));

describe('DownloadManager', () => {
  it('names files safely under the show folder', () => {
    expect(targetPath(job('/tmp/pods'))).toBe('/tmp/pods/Kernel Panic Hour/2026-10-19 - Wayland.mp3');
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
    await until(m, (e) => e.type === 'progress');
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
});
