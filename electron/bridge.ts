import type { HttpRequest } from '../shared/types';

// Headers the page has no business setting on a feed or API request: they would let it pose as a browser tab on some
// other site (cookies, origin, referer), name the destination itself (host), or take over the framing of the exchange.
const FORBIDDEN = new Set(['host', 'cookie', 'origin', 'referer', 'proxy-authorization', 'connection', 'content-length', 'transfer-encoding']);

/**
 * Whether the page may make this request through the http bridge: a web address, a GET or a POST (a POST carrying a
 * body and a GET not), and headers of the kind feeds and directory APIs take. Throws what is wrong with it.
 */
export function checkRequest(url: unknown, req: unknown): asserts req is HttpRequest | undefined {
  let parsed: URL;
  try { parsed = new URL(String(url)); } catch { throw new Error('that is not a web address'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`${parsed.protocol} addresses are not fetched`);
  if (req === undefined || req === null) return;
  if (typeof req !== 'object') throw new Error('the request is malformed');
  const { method = 'GET', headers, body, maxBytes } = req as Record<string, unknown>;
  if (method !== 'GET' && method !== 'POST') throw new Error(`${String(method)} requests are not made`);
  if (body !== undefined && typeof body !== 'string') throw new Error('the request body must be text');
  if (method === 'GET' && body) throw new Error('a GET has no body');
  if (maxBytes !== undefined && (typeof maxBytes !== 'number' || !(maxBytes > 0))) throw new Error('the size limit must be a positive number');
  if (headers !== undefined) {
    if (!headers || typeof headers !== 'object') throw new Error('the headers are malformed');
    for (const [name, value] of Object.entries(headers)) {
      if (typeof value !== 'string') throw new Error(`the ${name} header must be text`);
      if (FORBIDDEN.has(name.toLowerCase())) throw new Error(`the ${name} header can’t be set`);
    }
  }
}
