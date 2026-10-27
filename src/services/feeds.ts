import { cadence } from '../../shared/feed';
import type { HttpResponse } from '../../shared/types';
import { parseFeedAsync } from '../feed-parse';
import { hueFor, sameEpisode, type Episode, type Show } from '../data';
import { platform } from '../platform';

/** The show a feed describes. Its episodes carry no show notes (see notes.ts): those come back separately, by guid. */
export async function showFromFeed(url: string, xml: string, id: string, etag?: string, lastModified?: string): Promise<{ show: Show; newFeedUrl?: string; notes: Map<string, string> }> {
  const f = await parseFeedAsync(xml);
  const notes = new Map<string, string>();
  const eps = f.episodes.map(({ description, ...ep }) => {
    if (description) notes.set(ep.guid, description);
    return ep;
  });
  const show: Show = {
    id, title: f.title, author: f.author, hue: hueFor(f.title), cat: f.category, freq: cadence(f.episodes),
    desc: f.description, feedUrl: url, imageUrl: f.imageUrl, link: f.link, eps,
    etag, lastModified, subscribedAt: Date.now(),
  };
  return { show, newFeedUrl: f.newFeedUrl && f.newFeedUrl !== url ? f.newFeedUrl : undefined, notes };
}

/** `https://user:pass@host/feed` → the bare URL plus the credentials. */
export function splitCredentials(url: string): { url: string; user: string; password: string } | null {
  try {
    const u = new URL(url);
    if (!u.username && !u.password) return null;
    const cred = { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
    u.username = '';
    u.password = '';
    return { url: u.toString(), ...cred };
  } catch {
    return null;
  }
}

/** What the user typed, trimmed; credentials written into the address are saved apart and left out of it. */
export async function takeCredentials(typed: string): Promise<string> {
  const url = typed.trim();
  const cred = splitCredentials(url);
  if (!cred) return url;
  await platform.setFeedAuth(cred.url, cred.user, cred.password);
  return cred.url;
}

export type FeedUpdate =
  | { kind: 'unchanged' }
  | { kind: 'auth' }
  | { kind: 'updated'; show: Show; notes: Map<string, string>; movedTo?: string; newFeedUrl?: string };

/** Asks a subscribed feed whether it changed (with the validators from last time) and parses it when it did. Throws when it can't be read. */
export async function fetchFeedUpdate(show: Pick<Show, 'id' | 'feedUrl' | 'etag' | 'lastModified'>): Promise<FeedUpdate> {
  const headers: Record<string, string> = {};
  if (show.etag) headers['If-None-Match'] = show.etag;
  if (show.lastModified) headers['If-Modified-Since'] = show.lastModified;
  const res = await platform.http(show.feedUrl, { headers });
  if (res.status === 401) return { kind: 'auth' };
  if (res.status === 304) return { kind: 'unchanged' };
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const { show: updated, newFeedUrl, notes } = await showFromFeed(show.feedUrl, res.text, show.id, res.etag, res.lastModified);
  return { kind: 'updated', show: updated, notes, movedTo: res.movedTo, newFeedUrl };
}

export type NewFeed = { kind: 'auth' } | { kind: 'ok'; res: HttpResponse; feedUrl: string };

/** Fetches a feed that isn't subscribed to yet; `feedUrl` is where it lives now, when it has moved. Throws with a message fit to show. */
export async function fetchNewFeed(url: string): Promise<NewFeed> {
  const res = await platform.http(url);
  if (res.status === 401) return { kind: 'auth' };
  if (res.status !== 200) throw new Error(`the server responded with HTTP ${res.status}`);
  return { kind: 'ok', res, feedUrl: res.movedTo ?? url };
}

/**
 * A subscribed show's episodes after a refresh: the feed's, with the object we already had for an episode that didn't change
 * (so what is cached per episode and per list stays valid), and the durations the player measured when the feed carries none.
 * Feeds often list only their latest episodes. One the feed has dropped stays while `isReferenced` says something refers to it
 * (a downloaded file, play history, the queue, the playing episode), so those keep resolving.
 *
 * `eps` is null when nothing differs from `live`; `added` are the episodes new to us, `changed` the new objects that replace an
 * old one or are new (their show notes need saving).
 */
export function mergeEpisodes(live: Episode[], listed: Episode[], isReferenced: (guid: string) => boolean): { eps: Episode[] | null; added: Episode[]; changed: Episode[] } {
  const prev = new Map(live.map((e) => [e.guid, e]));
  const added = listed.filter((e) => !prev.has(e.guid));
  const changed: Episode[] = [];
  const current = listed.map((e) => {
    const old = prev.get(e.guid);
    const next = { ...e, duration: e.duration || old?.duration || 0 };
    if (old && sameEpisode(old, next)) return old;
    changed.push(next);
    return next;
  });
  const guids = new Set(listed.map((e) => e.guid));
  const dropped = live.filter((e) => !guids.has(e.guid) && isReferenced(e.guid));
  const merged = dropped.length ? [...current, ...dropped].sort((a, b) => b.pubDate - a.pubDate) : current;
  const unchanged = merged.length === live.length && merged.every((e, i) => e === live[i]);
  return { eps: unchanged ? null : merged, added, changed };
}
