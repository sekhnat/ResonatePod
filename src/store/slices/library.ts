import { epKey, pool, sameJson, SHOW_STRUCTS, type Show } from '../../data';
import { resolveFeedUrl } from '../../lib/directory';
import { fetchFeedUpdate, fetchNewFeed, mergeEpisodes, showFromFeed, takeCredentials } from '../../services/feeds';
import { platform } from '../../platform';
import { setPlayhead } from '../../playhead';
import { dropNotes, holdNotes } from '../../notes';
import { slug } from '../helpers';
import { autoDownloadKeys, dlByKey, findShow, getEp, withEp } from '../selectors';
import { type EpState, type Slice, type State } from '../types';

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
        // Feeds that arrive close together are merged in one store update, not one each: every update runs the
        // selectors and redraws the lists and the sidebar. Waiting a moment still shows new episodes as they come in.
        const arrived: { sh: Show; r: Extract<Awaited<ReturnType<typeof fetchFeedUpdate>>, { kind: 'updated' }> }[] = [];
        let settleTimer: ReturnType<typeof setTimeout> | undefined;
        const settle = () => {
          clearTimeout(settleTimer);
          settleTimer = undefined;
          const batch = arrived.splice(0);
          if (!batch.length) return;
          const s = get();
          let { eps, shows: current } = s;
          let epsCopied = false;
          for (const { sh, r } of batch) {
            try {
              const { show: upd, notes } = r;
              const live = findShow({ shows: current }, sh.id);
              if (!live) continue; // unsubscribed while it was being fetched
              // Follow the feed when it has moved: a permanent redirect, or itunes:new-feed-url.
              const target = r.movedTo ?? r.newFeedUrl;
              if (target && !current.some((x) => x.feedUrl === target)) {
                upd.feedUrl = target;
                // A validator from the old address means nothing to the new one.
                if (!r.movedTo) { upd.etag = undefined; upd.lastModified = undefined; }
                moved.push(upd.title);
              }
              const referenced = (guid: string) => {
                const key = epKey(sh.id, guid);
                return key in eps || s.cur === key || s.queue.includes(key) || s.dlPending.includes(key) || dlByKey(s.dl).has(key);
              };
              const merge = mergeEpisodes(live.eps, upd.eps, referenced);
              fresh += merge.added.length;
              if (merge.added.length && !epsCopied) { eps = { ...eps }; epsCopied = true; }
              for (const e of merge.added) eps[epKey(sh.id, e.guid)] = { played: false, pos: 0, inbox: true };
              for (const e of merge.changed) holdNotes(sh.id, e.guid, notes.get(e.guid)); // a new or changed episode's notes are saved with it
              // Lists that say the same as before stay the same objects, so the show isn't written again for them.
              for (const k of SHOW_STRUCTS) if (sameJson(live[k], upd[k])) (upd as unknown as Record<string, unknown>)[k] = live[k];
              current = current.map((x) => (x.id === sh.id ? { ...x, ...upd, hue: x.hue, subscribedAt: x.subscribedAt, eps: merge.eps ?? x.eps } : x));
            } catch {
              failed++;
            }
          }
          set({ eps, shows: current });
        };
        try {
          await pool(shows, 4, async (sh) => {
            try {
              const r = await fetchFeedUpdate(sh);
              if (r.kind === 'auth') { needAuth++; return; }
              if (r.kind === 'unchanged') return;
              arrived.push({ sh, r });
              settleTimer ??= setTimeout(settle, 150);
            } catch {
              failed++;
            }
          });
          settle();
        } finally {
          clearTimeout(settleTimer);
        }
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
      let clean = await takeCredentials(url);
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
        const got = await fetchNewFeed(clean);
        if (got.kind === 'auth') {
          if (!opts.quiet) set({ dialog: 'feedAuth', authFor: { url: clean } });
          return null;
        }
        const { res, feedUrl } = got;
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
