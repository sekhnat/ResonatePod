import { app, net } from 'electron';
import { Readable } from 'node:stream';
import type { HttpRequest } from '../shared/types';
import { authFor, credentialsReady } from './credentials';
import { followRedirects, type Transport } from './redirects';

const userAgent = () => `Resonate/${app.getVersion()}`;
const transport: Transport = (options) => net.request(options);

// Test hook: RESONATE_URL_REWRITE='{"https://itunes.apple.com":"http://127.0.0.1:8080/apple"}'
// points outside services at a local fixture server (used by the e2e test only).
const rewrites = Object.entries((() => { try { return JSON.parse(process.env.RESONATE_URL_REWRITE ?? '{}') as Record<string, string>; } catch { return {}; } })());
export const rewrite = (url: string) => {
  for (const [from, to] of rewrites) if (url.startsWith(from)) return to + url.slice(from.length);
  return url;
};

/**
 * A GET that hands back the final answer as a web Response (the body streams), with redirects followed by
 * followRedirects. `toFetch` rewrites a URL just before it is requested.
 */
export async function fetchFollowing(url: string, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}, toFetch = (u: string) => u): Promise<Response> {
  await credentialsReady();
  return new Promise((resolve, reject) => {
    let answered = false;
    const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (init.signal?.aborted) { reject(aborted()); return; }
    const exchange = followRedirects(transport, {
      url, headers: init.headers, toFetch, userAgent: userAgent(), authFor,
      onResponse: (res) => {
        answered = true;
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
        // A response with no body to have must not be given one.
        const body = [101, 204, 205, 304].includes(res.statusCode) ? null : (Readable.toWeb(res as unknown as Readable) as ReadableStream);
        resolve(new Response(body, { status: res.statusCode, statusText: res.statusMessage, headers }));
      },
      // Once the answer is on its way, a failure belongs to the body's stream, not to this promise.
      onError: (err) => { if (!answered) { exchange.abort(); reject(err); } },
    });
    init.signal?.addEventListener('abort', () => { exchange.abort(); if (!answered) reject(aborted()); }, { once: true });
  });
}

export interface TextResponse { status: number; text: string; header(name: string): string | undefined; finalUrl: string; permanent: boolean }

// A server that stops answering must not hold a refresh worker forever: give up when nothing has
// arrived for the idle time, or when the whole exchange outlasts the total time.
const HTTP_IDLE_MS = Number(process.env.RESONATE_HTTP_TIMEOUT_MS) || 20_000;
const HTTP_TOTAL_MS = Number(process.env.RESONATE_HTTP_TIMEOUT_MS) || 60_000;
// Bodies are buffered whole, so a runaway response must be cut off rather than held in memory.
const HTTP_MAX_BYTES = 50 * 1024 * 1024;

/** Requests the page may still cancel, by the name it gave them. */
const cancellers = new Map<string, () => void>();
export const cancelRequest = (id: string) => { cancellers.get(String(id))?.(); };

/**
 * GET/POST whose answer is read whole as text, with redirects followed by followRedirects, so we know whether every
 * hop was permanent. A POST isn't followed to another origin at all.
 */
export async function request(url: string, req: HttpRequest, id?: string): Promise<TextResponse> {
  await credentialsReady();
  return new Promise((resolve, reject) => {
    let finalUrl = url;
    let permanent = true;
    let redirects = 0;
    let settled = false;
    let idle: NodeJS.Timeout | undefined;
    const finish = (err: Error | null, value?: TextResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(total);
      if (id) cancellers.delete(id);
      if (err) { exchange.abort(); reject(err); } else resolve(value!);
    };
    const timedOut = () => finish(new Error('timed out'));
    const total = setTimeout(timedOut, HTTP_TOTAL_MS);
    if (id) cancellers.set(id, () => finish(new Error('cancelled')));
    const touch = () => { clearTimeout(idle); idle = setTimeout(timedOut, HTTP_IDLE_MS); };
    touch();
    const cap = Math.min(req.maxBytes ?? HTTP_MAX_BYTES, HTTP_MAX_BYTES);

    const exchange = followRedirects(transport, {
      url, method: req.method, headers: req.headers, body: req.body, toFetch: rewrite, userAgent: userAgent(), authFor,
      onRedirect: ({ status, to, sameOrigin }) => {
        redirects++;
        if (status !== 301 && status !== 308) permanent = false;
        if (!sameOrigin && (req.method ?? 'GET') !== 'GET') return new Error('the server redirected to another site');
        finalUrl = to;
        touch();
      },
      onResponse: (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        touch();
        if (Number(res.headers['content-length']) > cap) { finish(new Error('response too large')); return; }
        res.on('data', (c) => {
          received += c.length;
          if (received > cap) { finish(new Error('response too large')); return; }
          chunks.push(c);
          touch();
        });
        res.on('end', () => finish(null, {
          status: res.statusCode,
          text: Buffer.concat(chunks).toString('utf8'),
          header: (n) => { const v = res.headers[n.toLowerCase()]; return Array.isArray(v) ? v[0] : v; },
          finalUrl,
          permanent: redirects > 0 && permanent,
        }));
        res.on('error', (err) => finish(err));
      },
      onError: (err) => finish(err),
    });
  });
}

