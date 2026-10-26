import type { HttpRequest, HttpResponse } from './types';

/** gpodder.net API v2 client (also served by compatible servers such as oPodSync). */

export type Http = (url: string, req?: HttpRequest) => Promise<HttpResponse>;

export interface GpodderAccount { server: string; user: string; password: string; device: string }

export interface EpisodeAction {
  podcast: string;
  episode: string;
  action: 'play' | 'download' | 'delete' | 'new';
  timestamp: string;
  started?: number;
  position?: number;
  total?: number;
}

export class GpodderError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const b64 = (s: string) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s).toString('base64'));

export function baseUrl(server: string) {
  const s = server.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(s) ? s : `https://${s}`;
}

export class GpodderClient {
  constructor(private acct: GpodderAccount, private http: Http) {}

  private async call<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
    const { server, user, password } = this.acct;
    const res = await this.http(`${baseUrl(server)}${path}`, {
      method,
      headers: { Authorization: `Basic ${b64(`${user}:${password}`)}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new GpodderError('The server rejected the username or password', 401);
    if (res.status < 200 || res.status >= 300) throw new GpodderError(`Sync server responded with HTTP ${res.status}`, res.status);
    return (res.text ? JSON.parse(res.text) : {}) as T;
  }

  private get u() { return encodeURIComponent(this.acct.user); }
  private get d() { return encodeURIComponent(this.acct.device); }

  login() { return this.call<unknown>(`/api/2/auth/${this.u}/login.json`, 'POST'); }

  registerDevice(caption: string) {
    return this.call<unknown>(`/api/2/devices/${this.u}/${this.d}.json`, 'POST', { caption, type: 'desktop' });
  }

  getSubscriptions(since: number) {
    return this.call<{ add: string[]; remove: string[]; timestamp: number }>(`/api/2/subscriptions/${this.u}/${this.d}.json?since=${since}`);
  }

  putSubscriptions(add: string[], remove: string[]) {
    return this.call<{ timestamp: number }>(`/api/2/subscriptions/${this.u}/${this.d}.json`, 'POST', { add, remove });
  }

  getActions(since: number) {
    return this.call<{ actions: EpisodeAction[]; timestamp: number }>(`/api/2/episodes/${this.u}.json?since=${since}`);
  }

  putActions(actions: EpisodeAction[]) {
    return this.call<{ timestamp: number }>(`/api/2/episodes/${this.u}.json`, 'POST', actions);
  }

  /** Podcasts the server recommends for this account (gpodder.net only; others answer 404). */
  suggestions(n: number) {
    return this.call<GpodderPodcast[]>(`/suggestions/${n}.json`);
  }
}

/** A podcast as gpodder.net's directory endpoints describe it. */
export interface GpodderPodcast {
  url: string;
  title: string;
  author?: string;
  description?: string;
  subscribers?: number;
  logo_url?: string | null;
  scaled_logo_url?: string | null;
  website?: string | null;
  mygpo_link?: string;
}

export interface SyncInput {
  /** Feed URLs subscribed locally right now. */
  local: string[];
  /** Feed URLs as of the last successful sync. */
  known: string[];
  subsSince: number;
  actionsSince: number;
  pending: EpisodeAction[];
}

export interface SyncResult {
  addLocally: string[];
  removeLocally: string[];
  remoteActions: EpisodeAction[];
  subsSince: number;
  actionsSince: number;
  known: string[];
}

/** One full two-way sync round. Pure apart from the client calls, so it is easy to test. */
export async function syncOnce(c: GpodderClient, input: SyncInput): Promise<SyncResult> {
  const remote = await c.getSubscriptions(input.subsSince);
  const localSet = new Set(input.local);
  const firstSync = input.subsSince === 0;
  const removedRemotely = new Set(remote.remove);
  const addLocally = remote.add.filter((u) => !localSet.has(u));
  const removeLocally = firstSync ? [] : remote.remove.filter((u) => localSet.has(u));

  const knownSet = new Set(input.known);
  const addRemote = input.local.filter((u) => !knownSet.has(u) && !removedRemotely.has(u));
  const removeRemote = firstSync ? [] : input.known.filter((u) => !localSet.has(u));
  let subsSince = remote.timestamp;
  if (addRemote.length || removeRemote.length) subsSince = (await c.putSubscriptions(addRemote, removeRemote)).timestamp;

  if (input.pending.length) await c.putActions(input.pending);
  const acts = await c.getActions(input.actionsSince);

  const known = [...new Set([...input.local.filter((u) => !removeLocally.includes(u)), ...addLocally])];
  return { addLocally, removeLocally, remoteActions: acts.actions, subsSince, actionsSince: acts.timestamp, known };
}
