import { cadence } from '../../../shared/feed';
import { parseFeedAsync } from '../../feed-parse';
import { epKey, hueFor, pool, sameEpisode, type Episode, type Show } from '../../data';
import { resolveFeedUrl } from '../../lib/directory';
import { platform } from '../../platform';
import { setPlayhead } from '../../playhead';
import { dropNotes, holdNotes } from '../../notes';
import { slug } from '../helpers';
import { autoDownloadKeys, dlByKey, findShow, getEp, withEp } from '../selectors';
import { type EpState, type Slice, type State } from '../types';

/** The show a feed describes. Its episodes carry no show notes (see notes.ts): those come back separately, by guid. */
async function showFromFeed(url: string, xml: string, id: string, etag?: string, lastModified?: string): Promise<{ show: Show; newFeedUrl?: string; notes: Map<string, string> }> {
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
function splitCredentials(url: string): { url: string; user: string; password: string } | null {
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


export const createLibrarySlice: Slice<'markPlayed' | 'markAllPlayed' | 'refresh' | 'addFeed' | 'importFeeds' | 'unsubscribe' | 'signInFeed'> = (set, get) => {
  return {
    markPlayed: (key, played) =>
      set((s) => ({ eps: withEp(s.eps, key, { ...getEp(s, key), played, pos: 0, playedAt: played ? Date.now() : undefined }) })),
    markAllPlayed: () =>
      set((s) => {
        const eps = { ...s.eps };
        const now = Date.now();
        for (const [k, v] of Object.entries(eps)) if (v.inbox && !v.played && k !== s.cur) eps[k] = { ...v, played: true, pos: 0, playedAt: now };
        return { eps };
      }),
    refresh: async () => {
      if (get().refreshing) return;
      set({ refreshing: true });
      try {
        let fresh = 0;
        let failed = 0;
        let needAuth = 0;
        const moved: string[] = [];
        const shows = get().shows;
        await pool(shows, 4, async (sh) => {
          try {
            const headers: Record<string, string> = {};
            if (sh.etag) headers['If-None-Match'] = sh.etag;
            if (sh.lastModified) headers['If-Modified-Since'] = sh.lastModified;
            const res = await platform.http(sh.feedUrl, { headers });
            if (res.status === 401) { needAuth++; return; }
            if (res.status === 304) return;
            if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
            const { show: upd, newFeedUrl, notes } = await showFromFeed(sh.feedUrl, res.text, sh.id, res.etag, res.lastModified);
            const s = get();
            const live = findShow(s, sh.id);
            if (!live) return;
            // Follow the feed when it has moved: a permanent redirect, or itunes:new-feed-url.
            const target = res.movedTo ?? newFeedUrl;
            if (target && !s.shows.some((x) => x.feedUrl === target)) {
              upd.feedUrl = target;
              // A validator from the old address means nothing to the new one.
              if (!res.movedTo) { upd.etag = undefined; upd.lastModified = undefined; }
              moved.push(upd.title);
            }
            const prev = new Map(live.eps.map((e) => [e.guid, e]));
            const added = upd.eps.filter((e) => !prev.has(e.guid));
            fresh += added.length;
            const eps = added.length ? { ...s.eps } : s.eps;
            for (const e of added) eps[epKey(sh.id, e.guid)] = { played: false, pos: 0, inbox: true };
            // Keep durations the player measured when the feed doesn't carry one, and the very same object for an
            // episode that didn't change, so what is cached per episode (and per list) stays valid across refreshes.
            const current: Episode[] = upd.eps.map((e) => {
              const old = prev.get(e.guid);
              const next = { ...e, duration: e.duration || old?.duration || 0 };
              if (old && sameEpisode(old, next)) return old;
              holdNotes(sh.id, e.guid, notes.get(e.guid)); // a new or changed episode's notes are saved with it
              return next;
            });
            // Feeds often list only their latest episodes. One the feed has dropped stays while anything refers to it
            // (a downloaded file, play history, the queue, the playing episode), so those keep resolving.
            const listed = new Set(upd.eps.map((e) => e.guid));
            const dropped = live.eps.filter((e) => {
              if (listed.has(e.guid)) return false;
              const key = epKey(sh.id, e.guid);
              return key in s.eps || s.cur === key || s.queue.includes(key) || s.dlPending.includes(key) || dlByKey(s.dl).has(key);
            });
            const merged = dropped.length ? [...current, ...dropped].sort((a, b) => b.pubDate - a.pubDate) : current;
            const unchanged = merged.length === live.eps.length && merged.every((e, i) => e === live.eps[i]);
            set({ eps, shows: s.shows.map((x) => (x.id === sh.id ? { ...x, ...upd, hue: x.hue, subscribedAt: x.subscribedAt, eps: unchanged ? x.eps : merged } : x)) });
          } catch {
            failed++;
          }
        });
        const s = get();
        const queued = s.shows.flatMap((sh) => autoDownloadKeys(s, sh.id));
        set({ refreshing: false, lastChecked: Date.now() });
        if (platform.isDesktop) queued.forEach((k) => get().startDownload(k));
        const parts = [fresh ? `${fresh} new episode${fresh > 1 ? 's' : ''}` : 'no new episodes'];
        if (queued.length && platform.isDesktop) parts.push(`${queued.length} downloading`);
        if (failed) parts.push(`${failed} feed${failed > 1 ? 's' : ''} failed`);
        if (needAuth) parts.push(`${needAuth} feed${needAuth > 1 ? 's need' : ' needs'} a password`);
        if (shows.length) s.toast(`Feeds refreshed · ${parts.join(' · ')}`);
        for (const title of moved) s.toast(`${title} moved to a new address`);
        if (fresh && s.tg.notify && typeof Notification !== 'undefined') new Notification('Resonate', { body: `${fresh} new episode${fresh > 1 ? 's' : ''}` });
        void get().cleanupStorage({ quiet: true });
        if (s.sync.server) void get().runSync();
      } finally {
        // Whatever threw above, the next refresh must be able to start.
        if (get().refreshing) set({ refreshing: false });
      }
    },
    addFeed: async (url, opts = {}) => {
      let clean = url.trim();
      const cred = splitCredentials(clean);
      if (cred) { clean = cred.url; await platform.setFeedAuth(clean, cred.user, cred.password); }
      const s = get();
      // Apple Podcasts page links stand for the show's real feed.
      try {
        clean = await resolveFeedUrl(clean);
      } catch (err) {
        if (!opts.quiet) s.toast(`Couldn’t add that show: ${(err as Error).message}`);
        return null;
      }
      const already = (u: string) => {
        const existing = get().shows.find((x) => x.feedUrl === u);
        if (existing && !opts.quiet) s.toast(`You’re already subscribed to ${existing.title}`);
        return existing?.id;
      };
      const known = already(clean);
      if (known) return known;
      set((x) => ({ adding: x.adding + 1 }));
      try {
        const res = await platform.http(clean);
        if (res.status === 401) {
          if (!opts.quiet) set({ dialog: 'feedAuth', authFor: { url: clean } });
          return null;
        }
        if (res.status !== 200) throw new Error(`the server responded with HTTP ${res.status}`);
        const feedUrl = res.movedTo ?? clean;
        const dup = res.movedTo && already(feedUrl);
        if (dup) return dup;
        const { show: parsed, notes } = await showFromFeed(feedUrl, res.text, '', res.etag, res.lastModified);
        let id = slug(parsed.title);
        while (findShow(get(), id)) id += '-';
        const show = { ...parsed, id };
        for (const [guid, text] of notes) holdNotes(id, guid, text);
        const eps = { ...get().eps };
        // Only the newest episode is new; the others have nothing to record yet (see withEp).
        if (show.eps.length) eps[epKey(id, show.eps[0].guid)] = { played: false, pos: 0, inbox: true };
        set((x) => ({ shows: [...x.shows, show], eps }));
        if (platform.isDesktop) autoDownloadKeys(get(), id).forEach((k) => get().startDownload(k));
        if (!opts.quiet) s.toast(`Subscribed to ${show.title}`);
        return id;
      } catch (err) {
        if (!opts.quiet) s.toast(`Couldn’t add that feed: ${(err as Error).message}`);
        return null;
      } finally {
        set((x) => ({ adding: x.adding - 1 }));
      }
    },
    importFeeds: async (feeds) => {
      let n = 0;
      await pool(feeds, 3, async (f) => { if (await get().addFeed(f.xmlUrl, { quiet: true })) n++; });
      return n;
    },
    unsubscribe: (id, quiet) => {
      const s = get();
      const show = findShow(s, id);
      if (!show) return;
      const prefix = `${id}:`;
      dropNotes(id);
      const shows = s.shows.filter((x) => x.id !== id);
      s.dl.filter((d) => d.key.startsWith(prefix)).forEach((d) => platform.download.cancel(d.key));
      // Downloaded files stay on disk (the dialog says so); their records go with the show.
      const eps: Record<string, EpState> = {};
      for (const [k, v] of Object.entries(s.eps)) if (!k.startsWith(prefix)) eps[k] = v;
      const ovr = { ...s.ovr };
      delete ovr[id];
      const sorts = { ...s.sorts };
      delete sorts[id];
      // Forget feed credentials once no remaining show lives on that server.
      const origin = (u: string) => { try { return new URL(u).origin; } catch { return u; } };
      if (!shows.some((x) => origin(x.feedUrl) === origin(show.feedUrl))) void platform.setFeedAuth(show.feedUrl, null, null);
      const patch: Partial<State> = {
        shows, eps, ovr, sorts,
        queue: s.queue.filter((k) => !k.startsWith(prefix)),
        dl: s.dl.filter((d) => !d.key.startsWith(prefix)),
        dlPending: s.dlPending.filter((k) => !k.startsWith(prefix)),
        cfgOpen: false,
        dialog: null,
      };
      if (s.cur?.startsWith(prefix)) { Object.assign(patch, { cur: null, playing: false }); setPlayhead(0); }
      if (s.showId === id) Object.assign(patch, { showId: shows[0]?.id ?? '', screen: s.screen === 'show' ? 'shows' : s.screen });
      set(patch);
      if (!quiet) s.toast(`Unsubscribed from ${show.title}`);
    },
    signInFeed: async (url, user, password, showId) => {
      await platform.setFeedAuth(url, user, password);
      const res = await platform.http(url).catch(() => null);
      if (res?.status === 401) { await platform.setFeedAuth(url, null, null); return 'denied'; }
      if (showId) { void get().refresh(); return 'ok'; }
      const id = await get().addFeed(url);
      if (!id) return 'failed';
      set({ discoverQuery: '' });
      get().openShow(id);
      return 'ok';
    },
  };
};
