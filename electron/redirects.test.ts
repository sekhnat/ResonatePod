// @vitest-environment node
import type { ClientRequest, IncomingMessage } from 'electron';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { followRedirects, type RedirectOptions, type Transport } from './redirects';

/** The part of Electron's ClientRequest the redirect logic touches. */
class FakeRequest extends EventEmitter {
  headers: Record<string, string> = {};
  written: string[] = [];
  ended = false;
  aborted = false;
  followed = 0;
  constructor(readonly url: string, readonly method: string) { super(); }
  setHeader(name: string, value: string) { this.headers[name] = value; }
  write(chunk: string) { this.written.push(chunk); }
  end() { this.ended = true; }
  abort() { this.aborted = true; }
  followRedirect() { this.followed++; }
  redirect(status: number, to: string) { this.emit('redirect', status, 'GET', to, {}); }
}

const LOGINS: Record<string, string> = { 'https://feeds.example': 'Basic feeds', 'https://cdn.example': 'Basic cdn' };
const authFor = (url: string): Record<string, string> => { try { const a = LOGINS[new URL(url).origin]; return a ? { Authorization: a } : {}; } catch { return {}; } };

let requests: FakeRequest[];
let responses: IncomingMessage[];
let errors: Error[];
const transport: Transport = (o) => { const r = new FakeRequest(o.url, o.method); requests.push(r); return r as unknown as ClientRequest; };
const start = (o: Partial<RedirectOptions> = {}) => followRedirects(transport, {
  url: 'https://feeds.example/rss', userAgent: 'Resonate/test', authFor,
  onResponse: (res) => responses.push(res), onError: (err) => errors.push(err), ...o,
});

beforeEach(() => { requests = []; responses = []; errors = []; });

describe('followRedirects', () => {
  it('sends the user agent, the caller\'s headers and the login for the origin', () => {
    start({ headers: { Range: 'bytes=0-9' } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: 'https://feeds.example/rss', method: 'GET', ended: true });
    expect(requests[0].headers).toEqual({ 'User-Agent': 'Resonate/test', Authorization: 'Basic feeds', Range: 'bytes=0-9' });
  });

  it('follows a redirect within the origin in place', () => {
    start();
    requests[0].redirect(302, 'https://feeds.example/other');
    expect(requests[0].followed).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].aborted).toBe(false);
  });

  it('starts a new request for another origin, with that origin\'s login and none of the caller\'s', () => {
    start({ headers: { Authorization: 'Basic caller', Accept: 'text/xml' } });
    expect(requests[0].headers.Authorization).toBe('Basic caller'); // the caller's own, for the origin it asked
    requests[0].redirect(301, 'https://cdn.example/rss');
    expect(requests[0].aborted).toBe(true);
    expect(requests[0].followed).toBe(0);
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toBe('https://cdn.example/rss');
    expect(requests[1].headers).toEqual({ 'User-Agent': 'Resonate/test', Authorization: 'Basic cdn', Accept: 'text/xml' });
  });

  it('sends no login to an origin that has none saved, and not the caller\'s either', () => {
    start({ headers: { Authorization: 'Basic caller' } });
    requests[0].redirect(302, 'https://tracker.example/x');
    expect(requests[1].headers).toEqual({ 'User-Agent': 'Resonate/test' });
  });

  it('ignores whatever a request it has dropped says afterwards', () => {
    start();
    const first = requests[0];
    first.redirect(302, 'https://cdn.example/a');
    first.emit('error', new Error('socket closed'));
    first.emit('response', { statusCode: 200 });
    first.redirect(302, 'https://cdn.example/b');
    expect(errors).toEqual([]);
    expect(responses).toEqual([]);
    expect(requests).toHaveLength(2);
  });

  it('passes on the response and the errors of the current request', () => {
    start();
    const res = { statusCode: 200 } as IncomingMessage;
    requests[0].emit('response', res);
    expect(responses).toEqual([res]);
    requests[0].emit('error', new Error('boom'));
    expect(errors.map((e) => e.message)).toEqual(['boom']);
  });

  it('gives up after eight redirects', () => {
    start();
    for (let i = 1; i <= 8; i++) requests[0].redirect(302, `https://feeds.example/${i}`);
    expect(errors).toEqual([]);
    requests[0].redirect(302, 'https://feeds.example/9');
    expect(errors.map((e) => e.message)).toEqual(['too many redirects']);
    expect(requests[0].followed).toBe(8);
  });

  it('lets the caller refuse a redirect, which ends the exchange with its error', () => {
    const seen: unknown[] = [];
    start({ onRedirect: (r) => { seen.push(r); return r.sameOrigin ? undefined : new Error('another site'); } });
    requests[0].redirect(307, 'https://feeds.example/same');
    requests[0].redirect(301, 'https://cdn.example/other');
    expect(seen).toEqual([
      { status: 307, to: 'https://feeds.example/same', sameOrigin: true },
      { status: 301, to: 'https://cdn.example/other', sameOrigin: false },
    ]);
    expect(requests[0].followed).toBe(1);
    expect(requests).toHaveLength(1); // the refused one was not opened
    expect(errors.map((e) => e.message)).toEqual(['another site']);
  });

  it('sends the method and the body with the first request only', () => {
    start({ method: 'POST', body: 'a=1' });
    expect(requests[0]).toMatchObject({ method: 'POST', written: ['a=1'] });
    requests[0].redirect(302, 'https://cdn.example/x');
    expect(requests[1].written).toEqual([]);
  });

  it('rewrites every address it requests', () => {
    start({ toFetch: (u) => u.replace('https://', 'http://127.0.0.1/') });
    requests[0].redirect(302, 'https://cdn.example/x');
    expect(requests.map((r) => r.url)).toEqual(['http://127.0.0.1/feeds.example/rss', 'http://127.0.0.1/cdn.example/x']);
    // ...but the logins and the origin checks go by the address the caller knows.
    expect(requests[1].headers.Authorization).toBe('Basic cdn');
  });

  it('aborts the request that is current when asked to', () => {
    const exchange = start();
    requests[0].redirect(302, 'https://cdn.example/x');
    const abort = vi.spyOn(requests[1], 'abort');
    exchange.abort();
    expect(abort).toHaveBeenCalledOnce();
  });
});
