import type { ClientRequest, IncomingMessage } from 'electron';
import { hopHeaders, originOf } from './hops';

/** Electron's net.request (a test passes its own). */
export type Transport = (options: { url: string; method: string; redirect: 'manual' }) => ClientRequest;

export interface RedirectOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Sent with the first request only: a POST isn't followed to another origin, and a same-origin redirect is resent by Electron. */
  body?: string;
  /** Rewrites a URL just before it is requested (the end-to-end test points outside services at a local server). */
  toFetch?: (url: string) => string;
  userAgent: string;
  authFor: (url: string) => Record<string, string>;
  /** Called for each redirect before it is followed. An Error it returns ends the exchange: it goes to onError. */
  onRedirect?: (redirect: { status: number; to: string; sameOrigin: boolean }) => Error | void;
  onResponse: (res: IncomingMessage) => void;
  /** The exchange failed. The caller aborts: the request that is current at that moment is the handle's. */
  onError: (err: Error) => void;
}

const MAX_HOPS = 8;

/**
 * Sends a request and follows its redirects itself, hop by hop. Each hop gets only the headers its origin may have
 * (see hopHeaders): net.fetch follows redirects with the headers it started with, so the login for the first origin
 * would go to wherever the server points it, a CDN or a tracker, and it can't be told to stop (a "manual" redirect
 * makes it throw). A redirect within the origin is followed in place; one to another origin is a new request, and the
 * old one is dropped. Both of the app's HTTP paths (text for feeds and the directory, streams for media and downloads)
 * go through here, so this is the one place that decides what travels to which origin.
 */
export function followRedirects(transport: Transport, o: RedirectOptions): { abort(): void } {
  const method = o.method ?? 'GET';
  let r: ClientRequest | undefined;
  let current = o.url;
  let hops = 0;

  const open = (target: string, body?: string) => {
    const mine = transport({ url: (o.toFetch ?? ((u) => u))(target), method, redirect: 'manual' });
    r = mine;
    for (const [k, v] of Object.entries(hopHeaders(o.headers, o.url, target, o.userAgent, o.authFor))) mine.setHeader(k, v);
    mine.on('redirect', (status, _method, to) => {
      if (r !== mine) return;
      if (++hops > MAX_HOPS) { o.onError(new Error('too many redirects')); return; }
      const sameOrigin = originOf(to) === originOf(current);
      const refused = o.onRedirect?.({ status, to, sameOrigin });
      if (refused) { o.onError(refused); return; }
      current = to;
      if (sameOrigin) { mine.followRedirect(); return; }
      open(to); // another origin: a request of its own, with only the headers that origin may have
      mine.abort();
    });
    mine.on('response', (res) => { if (r === mine) o.onResponse(res); });
    mine.on('error', (err) => { if (r === mine) o.onError(err); });
    if (body) mine.write(body);
    mine.end();
  };
  open(o.url, o.body);
  return { abort: () => r?.abort() };
}
