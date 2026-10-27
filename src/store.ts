import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { cadence } from '../shared/feed';
import { parseFeedAsync } from './feed-parse';
import { shortHash } from '../shared/filename';
import { parseJsonChapters, parseTranscript } from '../shared/meta';
import { GpodderClient, syncOnce, type EpisodeAction } from '../shared/gpodder';
import { hueFor, epKey, sameEpisode, type EpisodeMeta, type Episode, type EpisodeInfo, type Show } from './data';
import { gpodderResult, resolveFeedUrl, type DirectoryResult } from './lib/directory';
import { SMALL_BODY_BYTES, platform } from './platform';
import { getPlayhead, setPlayhead } from './playhead';
import { dropNotes, holdNotes } from './notes';
import { initialData, initialUi } from './store/initial';
import {
  GB, autoDownloadKeys, chaptersOf, cleanupKeys, currentChapter, dlByKey, epInfo, findShow, getEp, introFor, sharesFileName,
  skipAmounts, sleepLabel, speedFor, trackedBytes, withEp,
} from './store/selectors';
import { slug } from './store/helpers';
import type { ActiveDl, EpState, State } from './store/types';
export * from './store/types';
export * from './store/selectors';
export { initialData } from './store/initial';

// ---------- player bridge (set by the audio engine) ----------

export interface Player { seek(pos: number): void }
let player: Player | null = null;
export const setPlayer = (p: Player | null) => { player = p; };

const SPEEDS = [1, 1.2, 1.5, 2];
const isoNow = () => new Date().toISOString().slice(0, 19);

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

/** Chapters from the feed's chapters file, else from inside the media file. */
async function loadChapters(info: EpisodeInfo, file: string | undefined) {
  const { chaptersUrl, inlineChapters, enclosureUrl } = info.ep;
  if (chaptersUrl) {
    const r = await platform.http(chaptersUrl, { maxBytes: SMALL_BODY_BYTES }).catch(() => null);
    const ch = r?.status === 200 ? (() => { try { return parseJsonChapters(r.text); } catch { return []; } })() : [];
    if (ch.length) return ch;
  }
  if (inlineChapters?.length) return undefined;
  return (await platform.embeddedChapters(file, enclosureUrl).catch(() => null)) ?? undefined;
}

const MAX_PENDING_ACTIONS = 5000;

let toastId = 0;
let lastChapterIdx = -1;
let playStartedAt: number | null = null;

// subscribeWithSelector lets the engine and the tray listen to just the fields they act on.
export const useStore = create<State>()(
  subscribeWithSelector((set, get) => {
    /** Queues a gpodder play action for the current episode, when sync is set up. */
    const recordPlay = () => {
      const s = get();
      const info = epInfo(s, s.cur);
      const started = playStartedAt;
      playStartedAt = null;
      if (!info || !s.sync.server || started === null) return;
      const action: EpisodeAction = {
        podcast: info.show.feedUrl, episode: info.ep.enclosureUrl, action: 'play', timestamp: isoNow(),
        started: Math.floor(started), position: Math.floor(getPlayhead()), total: Math.floor(info.dur || getPlayhead()),
      };
      // A newer session of an episode replaces the older one, so a long offline spell stays small;
      // the cap is only a backstop for someone who plays thousands of different episodes without syncing.
      const sameEpisode = (a: EpisodeAction) => a.action === 'play' && a.podcast === action.podcast && a.episode === action.episode;
      set({ sync: { ...s.sync, pending: [...s.sync.pending.filter((a) => !sameEpisode(a)), action].slice(-MAX_PENDING_ACTIONS) } });
    };

    const saveCurPos = (): Record<string, EpState> => {
      const s = get();
      if (!s.cur) return s.eps;
      return { ...s.eps, [s.cur]: { ...getEp(s, s.cur), pos: getPlayhead(), lastPlayed: Date.now() } };
    };

    return {
      ...initialData,
      ...initialUi,

      go: (screen, extra) =>
        set((s) => ({ screen, history: [...s.history, { screen: s.screen, showId: s.showId }].slice(-50), palette: false, menu: null, npFull: false, ...extra })),
      goBack: () =>
        set((s) => {
          const h = [...s.history];
          const p = h.pop();
          return p ? { screen: p.screen, showId: findShow(s, p.showId) ? p.showId : s.showId, history: h } : {};
        }),
      openShow: (id) => get().go('show', { showId: id }),
      set: (patch) => set(patch),
      toast: (text) => {
        const id = ++toastId;
        set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text }] }));
        setTimeout(() => get().dismissToast(id), 3800);
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      play: (key) => {
        const s = get();
        if (s.cur === key) { get().togglePlay(); set({ palette: false }); return; }
        const next = epInfo(s, key);
        if (!next) return;
        if (s.playing) recordPlay();
        const eps = saveCurPos();
        const st = getEp(s, key);
        let pos = st.played || (next.dur && st.pos >= next.dur - 5) ? 0 : st.pos;
        if (pos === 0) pos = introFor(s, next.show.id);
        lastChapterIdx = -1;
        playStartedAt = pos;
        setPlayhead(pos); // before `cur` changes, so the engine loads the episode at this position
        set({ eps, cur: key, playing: true, palette: false, speed: speedFor(s, next.show.id) });
        void get().loadMeta(key);
      },
      togglePlay: () => {
        const s = get();
        if (!s.cur) return;
        if (s.playing) { recordPlay(); set({ playing: false, eps: saveCurPos() }); }
        else { playStartedAt = getPlayhead(); set({ playing: true }); }
      },
      seek: (pos) => {
        const s = get();
        const cur = epInfo(s, s.cur);
        if (!cur) return;
        const p = Math.max(0, cur.dur ? Math.min(cur.dur, pos) : pos);
        setPlayhead(p);
        player?.seek(p);
      },
      skipBack: () => get().seek(getPlayhead() - skipAmounts(get().sv.skip)[0]),
      skipFwd: () => get().seek(getPlayhead() + skipAmounts(get().sv.skip)[1]),
      prevChapter: () => {
        const s = get();
        const cur = epInfo(s, s.cur);
        if (!cur) return;
        const ch = chaptersOf(s, cur);
        const pos = getPlayhead();
        const ci = currentChapter(ch, pos);
        get().seek(ch[Math.max(0, pos - ch[ci].at > 3 ? ci : ci - 1)].at);
      },
      nextChapter: () => {
        const s = get();
        const cur = epInfo(s, s.cur);
        if (!cur) return;
        const ch = chaptersOf(s, cur);
        const ci = currentChapter(ch, getPlayhead());
        if (ci < ch.length - 1) get().seek(ch[ci + 1].at);
      },
      // The next faster preset from wherever the speed is now (a show can set one that isn't a preset), wrapping to the slowest.
      cycleSpeed: () => set((s) => ({ speed: SPEEDS.find((p) => p > s.speed + 1e-9) ?? SPEEDS[0] })),
      setSpeed: (speed) => set({ speed, palette: false }),
      setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)), muted: false }),
      toggleMute: () => set((s) => ({ muted: !s.muted })),
      setSleep: (sleep) => {
        set({ sleep, menu: null, palette: false });
        if (sleep.mode !== 'off') get().toast(`Sleep timer: ${sleepLabel(sleep).toLowerCase()}`);
      },

      tick: () => {
        const s = get();
        if (!s.playing || s.sleep.mode !== 'timer') return;
        const remaining = s.sleep.remaining - 1;
        if (remaining > 0) set({ sleep: { ...s.sleep, remaining } });
        else { set({ sleep: { mode: 'off' } }); get().togglePlay(); }
      },
      onTime: (pos) => {
        const s = get();
        setPlayhead(pos);
        const cur = epInfo(s, s.cur);
        if (!cur) return;
        const ci = currentChapter(chaptersOf(s, cur), pos);
        if (s.sleep.mode === 'chapter' && lastChapterIdx >= 0 && ci !== lastChapterIdx && s.playing) {
          set({ sleep: { mode: 'off' } });
          get().togglePlay();
        }
        lastChapterIdx = ci;
      },
      onDuration: (dur) => {
        const s = get();
        const cur = epInfo(s, s.cur);
        if (!cur || !Number.isFinite(dur) || dur <= 0 || Math.abs(cur.dur - dur) < 2) return;
        const d = Math.round(dur);
        set({ shows: s.shows.map((sh) => (sh.id !== cur.show.id ? sh : { ...sh, eps: sh.eps.map((e) => (e.guid === cur.ep.guid ? { ...e, duration: d } : e)) })) });
      },
      onEnded: () => {
        const s = get();
        const cur = epInfo(s, s.cur);
        if (!cur) return;
        recordPlay();
        const now = Date.now();
        const eps = { ...s.eps, [cur.key]: { ...getEp(s, cur.key), played: true, pos: 0, playedAt: now, lastPlayed: now } };
        const queue = s.queue.filter((k) => k !== cur.key);
        set({ eps, queue });
        if (s.sleep.mode === 'episode' || !queue.length) {
          set({ playing: false, sleep: { mode: 'off' } });
        } else {
          get().play(queue[0]);
        }
      },
      onPlayError: (message) => {
        set({ playing: false });
        get().toast(`Can’t play this episode: ${message}`);
      },
      addTrimSaved: (sec) => set((s) => ({ trimPending: s.trimPending + sec })),
      loadMeta: async (key) => {
        const s = get();
        const info = epInfo(s, key);
        if (!info || s.meta[key]) return;
        const meta: EpisodeMeta = {};
        set({ meta: { ...get().meta, [key]: meta } });
        const { transcriptUrl, transcriptType } = info.ep;
        await Promise.all([
          loadChapters(info, getEp(s, key).file).then((ch) => { meta.chapters = ch; }),
          transcriptUrl && platform.http(transcriptUrl, { maxBytes: SMALL_BODY_BYTES }).then((r) => {
            const t = r.status === 200 ? parseTranscript(r.text, transcriptType) : null;
            meta.transcript = t?.lines ?? null;
            meta.transcriptTimed = t?.timed;
          }).catch(() => { meta.transcript = null; }),
        ]);
        if (get().meta[key] === meta) set({ meta: { ...get().meta, [key]: { ...meta } } });
      },

      startDownload: (key) => {
        const s = get();
        const info = epInfo(s, key);
        const existing = s.dl.find((d) => d.key === key);
        if (!info || (existing && !existing.error && !existing.retryAt) || getEp(s, key).file) return;
        if (!platform.isDesktop) { s.toast('Downloading needs the Resonate desktop app'); return; }
        set({
          dl: existing ? s.dl.map((d) => (d.key === key ? { ...d, error: undefined, retryAt: undefined, active: false } : d)) : [...s.dl, { key, received: 0, total: info.ep.sizeBytes, speed: 0 }],
          dlPending: s.dlPending.includes(key) ? s.dlPending : [...s.dlPending, key],
        });
        platform.download.start({ key, url: info.ep.enclosureUrl, folder: s.folder, showTitle: info.show.title, title: info.title, pubDate: info.ep.pubDate, mime: info.ep.enclosureType, suffix: sharesFileName(s, info) ? shortHash(key) : undefined });
      },
      cancelDownload: (key) => {
        platform.download.cancel(key);
        set((s) => ({ dl: s.dl.filter((d) => d.key !== key), dlPending: s.dlPending.filter((k) => k !== key) }));
      },
      checkpoint: () => {
        const s = get();
        if (s.trimPending > 0) set({ trimSaved: s.trimSaved + s.trimPending, trimPending: 0 });
        if (s.cur && Math.abs(getEp(s, s.cur).pos - getPlayhead()) >= 1) set({ eps: saveCurPos() });
      },
      moveDownloads: async (from, to) => {
        const files = Object.values(get().eps).map((e) => e.file).filter((f): f is string => !!f);
        set({ pendingMove: null, dialog: null });
        if (!files.length) return;
        get().toast(`Moving downloaded episodes to ${to}…`);
        const moved = await platform.moveFiles(from, to, files).catch(() => []);
        const map = new Map(moved.map((m) => [m.from, m.to]));
        set((x) => ({ eps: Object.fromEntries(Object.entries(x.eps).map(([k, v]) => [k, v.file && map.has(v.file) ? { ...v, file: map.get(v.file) } : v])) }));
        get().toast(moved.length ? `Moved ${moved.length} episode${moved.length > 1 ? 's' : ''} to ${to}` : 'No files were moved');
        void get().updateUsage();
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
      deleteFile: async (key, quiet) => {
        const s = get();
        const st = getEp(s, key);
        if (!st.file) return;
        await platform.deleteFile(st.file).catch(() => {});
        const now = get();
        set({ eps: withEp(now.eps, key, { ...getEp(now, key), file: undefined, fileBytes: undefined }) });
        if (!quiet) s.toast(`Deleted “${epInfo(s, key)?.title ?? 'episode'}” from disk`);
      },
      toggleDlPause: () => set((s) => ({ dlPaused: !s.dlPaused })),
      onDownloadEvent: (e) => {
        const s = get();
        const patch = (p: Partial<ActiveDl>) => set({ dl: s.dl.map((d) => (d.key === e.key ? { ...d, ...p } : d)) });
        if (e.type === 'progress') {
          const d = s.dl.find((x) => x.key === e.key);
          patch({ received: e.received, total: e.total || d?.total || 0, speed: e.speed, retryAt: undefined, active: true });
        } else if (e.type === 'retry') {
          patch({ retryAt: e.at, speed: 0, active: false });
        } else if (e.type === 'requeue') {
          patch({ retryAt: undefined, speed: 0, active: false });
        } else if (e.type === 'done') {
          set({
            dl: s.dl.filter((d) => d.key !== e.key),
            dlPending: s.dlPending.filter((k) => k !== e.key),
            eps: { ...s.eps, [e.key]: { ...getEp(s, e.key), file: e.path, fileBytes: e.bytes } },
            dlDone: [{ key: e.key, when: Date.now() }, ...s.dlDone.filter((d) => d.key !== e.key)].slice(0, 50),
          });
          // Streaming may not have allowed reading chapters from the file; try the local copy.
          if (e.key === s.cur && !s.meta[e.key]?.chapters?.length) {
            const meta = { ...get().meta };
            delete meta[e.key];
            set({ meta });
            void get().loadMeta(e.key);
          }
          void get().cleanupStorage({ quiet: true });
        } else {
          patch({ error: e.message, retryAt: undefined, speed: 0, active: false });
          s.toast(`Download failed: ${epInfo(s, e.key)?.title ?? 'episode'} (${e.message})`);
        }
      },
      updateUsage: async () => {
        if (!platform.isDesktop) return;
        const bytes = await platform.diskUsage(get().folder).catch(() => null);
        if (bytes != null) set({ folderBytes: bytes });
      },
      cleanupStorage: async (opts = {}) => {
        const s = get();
        const keys = cleanupKeys({ ...s, sv: s.tg.deletePlayed ? s.sv : { ...s.sv, del: 'Never' } });
        for (const k of keys) await get().deleteFile(k, true);
        if (keys.length) s.toast(`Freed space: removed ${keys.length} played episode${keys.length > 1 ? 's' : ''}`);
        if (!opts.quiet && trackedBytes(get().eps) > s.storageLimitGb * GB) s.toast('Storage limit reached — delete episodes or raise the limit in Preferences');
      },

      addToQueue: (key) => {
        const s = get();
        const info = epInfo(s, key);
        if (!info) return;
        if (s.queue.includes(key)) { s.toast('Already in the queue'); return; }
        set({ queue: [...s.queue, key] });
        s.toast(`Added “${info.title}” to the queue`);
      },
      removeFromQueue: (key) => set((s) => ({ queue: s.queue.filter((k) => k !== key) })),
      moveQueue: (from, to) =>
        set((s) => {
          const q = [...s.queue];
          const [item] = q.splice(from, 1);
          q.splice(to, 0, item);
          return { queue: q };
        }),
      clearQueue: () => set((s) => ({ queue: s.queue.filter((k) => k === s.cur) })),

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
          const work = [...shows];
          const worker = async () => {
            for (let sh = work.shift(); sh; sh = work.shift()) {
              try {
                const headers: Record<string, string> = {};
                if (sh.etag) headers['If-None-Match'] = sh.etag;
                if (sh.lastModified) headers['If-Modified-Since'] = sh.lastModified;
                const res = await platform.http(sh.feedUrl, { headers });
                if (res.status === 401) { needAuth++; continue; }
                if (res.status === 304) continue;
                if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
                const { show: upd, newFeedUrl, notes } = await showFromFeed(sh.feedUrl, res.text, sh.id, res.etag, res.lastModified);
                const s = get();
                const live = findShow(s, sh.id);
                if (!live) continue;
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
            }
          };
          await Promise.all([worker(), worker(), worker(), worker()]);
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
        const work = [...feeds];
        const worker = async () => { for (let f = work.shift(); f; f = work.shift()) if (await get().addFeed(f.xmlUrl, { quiet: true })) n++; };
        await Promise.all([worker(), worker(), worker()]);
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

      setOverride: (showId, k, v) => set((s) => ({ ovr: { ...s.ovr, [showId]: { ...s.ovr[showId], [k]: v } } })),
      resetOverride: (showId) =>
        set((s) => {
          const ovr = { ...s.ovr };
          delete ovr[showId];
          return { ovr };
        }),
      setSort: (scope, sort) =>
        set((s) => {
          const sorts = { ...s.sorts };
          if (sort === 'Newest first') delete sorts[scope];
          else sorts[scope] = sort;
          return { sorts };
        }),
      setToggle: (k) => set((s) => ({ tg: { ...s.tg, [k]: !s.tg[k] } })),
      setSeg: (k, v) => set((s) => ({ sv: { ...s.sv, [k]: v } })),
      setPrefs: (patch) => set(patch),

      setDirectory: (patch) => set((s) => ({ directory: { ...s.directory, ...patch } })),
      setPodcastIndexKey: async (key) => {
        await platform.setSecret('podcastindex', key ? JSON.stringify(key) : null);
        set((s) => ({ directory: { ...s.directory, podcastIndex: !!key, source: !key && s.directory.source === 'podcastindex' ? 'all' : s.directory.source } }));
      },
      gpodderSuggestions: async () => {
        const s = get();
        if (!s.sync.server) return [];
        const password = (await platform.getSecret('gpodder')) ?? '';
        const client = new GpodderClient({ server: s.sync.server, user: s.sync.user, password, device: s.sync.device }, platform.http);
        const list = await client.suggestions(12).catch(() => []);
        return (Array.isArray(list) ? list : []).map((p) => gpodderResult(p)).filter((r): r is DirectoryResult => !!r);
      },

      configureSync: async (server, user, password) => {
        const device = get().sync.device || `resonate-${slug(platform.hostname)}-${Math.random().toString(36).slice(2, 6)}`;
        const client = new GpodderClient({ server, user, password, device }, platform.http);
        try {
          await client.login();
          await client.registerDevice(`Resonate on ${platform.hostname}`);
        } catch (err) {
          get().toast(`Sync: ${(err as Error).message}`);
          return false;
        }
        await platform.setSecret('gpodder', password);
        set({ sync: { server, user, device, subsSince: 0, actionsSince: 0, known: [], pending: [], lastSynced: 0 } });
        await get().runSync();
        return true;
      },
      disconnectSync: () => {
        void platform.setSecret('gpodder', null);
        set((s) => ({ sync: { ...initialData.sync, device: s.sync.device } }));
        get().toast('Sync turned off');
      },
      runSync: async () => {
        const s = get();
        if (!s.sync.server || s.syncing) return;
        set({ syncing: true });
        try {
          const password = (await platform.getSecret('gpodder')) ?? '';
          const client = new GpodderClient({ server: s.sync.server, user: s.sync.user, password, device: s.sync.device }, platform.http);
          const pending = s.sync.pending;
          const sent = new Set(pending);
          const r = await syncOnce(client, { local: s.shows.map((x) => x.feedUrl), known: s.sync.known, subsSince: s.sync.subsSince, actionsSince: s.sync.actionsSince, pending });
          for (const url of r.addLocally) await get().addFeed(url, { quiet: true });
          for (const url of r.removeLocally) { const sh = get().shows.find((x) => x.feedUrl === url); if (sh) get().unsubscribe(sh.id, true); }
          // Apply remote play positions that are newer than ours.
          const now = get();
          const byUrl = new Map<string, string>();
          for (const sh of now.shows) for (const e of sh.eps) byUrl.set(e.enclosureUrl, epKey(sh.id, e.guid));
          const eps = { ...now.eps };
          for (const a of r.remoteActions) {
            const key = byUrl.get(a.episode);
            if (!key || a.action !== 'play' || key === now.cur || a.position == null) continue;
            const when = Date.parse(a.timestamp.endsWith('Z') ? a.timestamp : a.timestamp + 'Z');
            const st = eps[key] ?? getEp(now, key);
            if ((st.lastPlayed ?? 0) >= when) continue;
            const done = !!a.total && a.position >= a.total - 30;
            eps[key] = { ...st, pos: done ? 0 : a.position, played: done || st.played, playedAt: done ? when : st.playedAt, lastPlayed: when };
          }
          set((x) => ({
            eps,
            sync: { ...x.sync, subsSince: r.subsSince, actionsSince: r.actionsSince, known: x.shows.map((sh) => sh.feedUrl), pending: x.sync.pending.filter((a) => !sent.has(a)), lastSynced: Date.now() },
          }));
        } catch (err) {
          get().toast(`Sync failed: ${(err as Error).message}`);
        } finally {
          set({ syncing: false });
        }
      },
    };
  }),
);
