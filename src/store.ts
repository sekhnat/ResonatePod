import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DISCOVER, SEED_DOWNLOADED, SEED_PLAYED, SEED_PROGRESS, SEED_UNPLAYED, SHOWS,
  chaptersFor, epKey, episodeInfo, parseKey, type EpisodeInfo, type Show,
} from './data';
import { titleFromUrl, type OpmlFeed } from './lib/opml';

export type Screen = 'inbox' | 'shows' | 'show' | 'queue' | 'downloads' | 'discover' | 'settings';
export const SCREENS: Screen[] = ['inbox', 'shows', 'show', 'queue', 'downloads', 'discover', 'settings'];
export type Filter = 'All' | 'Unplayed' | 'Downloaded';

export interface EpState { played: boolean; progress: number; downloaded: boolean; inbox: boolean }
export interface ActiveDl { key: string; p: number; mb: number }
export interface DoneDl { key: string; when: string }
export interface Override { dl?: string; speed?: string; trim?: string; intro?: string }
export type Sleep =
  | { mode: 'off' }
  | { mode: 'timer'; minutes: number; remaining: number }
  | { mode: 'chapter' }
  | { mode: 'episode' };
export type DialogKind = 'unsubscribe' | 'folder' | 'storage' | 'sync' | 'shortcuts' | 'about';
export interface Toast { id: number; text: string }

export interface Toggles { auto: boolean; metered: boolean; silence: boolean; notify: boolean; deletePlayed: boolean }
export interface SegValues { keep: string; par: string; speed: string; del: string; skip: string }

interface Data {
  shows: Show[];
  eps: Record<string, EpState>;
  cur: string;
  pos: number;
  playing: boolean;
  speed: number;
  volume: number;
  muted: boolean;
  queue: string[];
  dl: ActiveDl[];
  dlDone: DoneDl[];
  dlPaused: boolean;
  ovr: Record<string, Override>;
  tg: Toggles;
  sv: SegValues;
  folder: string;
  storageLimitGb: number;
  usedMb: number;
  syncServer: string;
  lastSynced: string;
  lastChecked: number;
  trimSaved: number;
}

interface Ui {
  screen: Screen;
  history: { screen: Screen; showId: string }[];
  showId: string;
  filter: Filter;
  cat: string;
  discoverQuery: string;
  npOpen: boolean;
  npFull: boolean;
  cfgOpen: boolean;
  trayOpen: boolean;
  trayPinned: boolean;
  windowHidden: boolean;
  palette: boolean;
  query: string;
  menu: 'main' | 'sleep-bar' | 'sleep-tray' | null;
  dialog: DialogKind | null;
  refreshing: boolean;
  sleep: Sleep;
  toasts: Toast[];
}

interface Actions {
  go(screen: Screen, extra?: Partial<Ui>): void;
  goBack(): void;
  openShow(id: string): void;
  set(patch: Partial<Ui>): void;
  toast(text: string): void;
  dismissToast(id: number): void;

  play(key: string): void;
  togglePlay(): void;
  seek(pos: number): void;
  skipBack(): void;
  skipFwd(): void;
  prevChapter(): void;
  nextChapter(): void;
  cycleSpeed(): void;
  setSpeed(speed: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  setSleep(sleep: Sleep): void;
  tick(): void;

  startDownload(key: string): void;
  cancelDownload(key: string): void;
  deleteFile(key: string): void;
  toggleDlPause(): void;

  addToQueue(key: string): void;
  removeFromQueue(key: string): void;
  moveQueue(from: number, to: number): void;
  clearQueue(): void;

  markPlayed(key: string, played: boolean): void;
  markAllPlayed(): void;
  refresh(): void;

  toggleDiscover(title: string): void;
  addFeed(url: string, title?: string): string | null;
  importFeeds(feeds: OpmlFeed[]): number;
  unsubscribe(id: string): void;

  setOverride(showId: string, k: keyof Override, v: string): void;
  resetOverride(showId: string): void;
  setToggle(k: keyof Toggles): void;
  setSeg(k: keyof SegValues, v: string): void;
  setPrefs(patch: Partial<Pick<Data, 'folder' | 'storageLimitGb' | 'syncServer'>>): void;
}

export type State = Data & Ui & Actions;

// ---------- helpers ----------

export const parseSpeed = (s: string) => parseFloat(s.replace('×', ''));
export const skipAmounts = (skip: string): [number, number] => {
  const [b, f] = skip.replace(' s', '').split('/').map((x) => parseInt(x, 10));
  return [b, f];
};
const SPEEDS = [1, 1.2, 1.5, 2];

export const findShow = (s: Pick<Data, 'shows'>, id: string) => s.shows.find((x) => x.id === id);

export const epInfo = (s: Pick<Data, 'shows'>, key: string): EpisodeInfo | null => {
  const [id, idx] = parseKey(key);
  const show = findShow(s, id);
  return show && idx < show.eps.length ? episodeInfo(show, idx) : null;
};

export const getEp = (s: Pick<Data, 'eps'>, key: string): EpState =>
  s.eps[key] ?? { played: false, progress: 0, downloaded: false, inbox: false };

/** Effective auto-download rule for a show: an override, or the global preference. */
export const ruleFor = (s: Pick<Data, 'ovr' | 'tg' | 'sv'>, showId: string) => {
  const o = s.ovr[showId]?.dl ?? 'Global';
  if (o !== 'Global') return { value: o, global: false };
  return { value: s.tg.auto ? (s.sv.keep === 'All' ? 'All' : `Latest ${s.sv.keep}`) : 'Off', global: true };
};

export const trimOn = (s: Pick<Data, 'ovr' | 'tg'>, showId: string) => {
  const o = s.ovr[showId]?.trim ?? 'Global';
  return o === 'Global' ? s.tg.silence : o === 'On';
};

const speedFor = (s: Data, showId: string) => {
  const o = s.ovr[showId]?.speed ?? 'Global';
  return parseSpeed(o === 'Global' ? s.sv.speed : o);
};

const introFor = (s: Data, showId: string) => {
  const o = s.ovr[showId]?.intro ?? 'Off';
  return o === 'Off' ? 0 : parseInt(o, 10);
};

const nowLabel = () => {
  const d = new Date();
  return `Today, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'feed';

const seedEps = () => {
  const eps: Record<string, EpState> = {};
  for (const sh of SHOWS) {
    sh.eps.forEach((_, i) => {
      eps[epKey(sh.id, i)] = { played: SEED_PLAYED[i], progress: SEED_PROGRESS[i], downloaded: SEED_DOWNLOADED[i], inbox: i < SEED_UNPLAYED[sh.id] };
    });
  }
  // Completed downloads in the seed history are on disk.
  for (const k of ['ct:0', 'mf:0', 'se:0']) eps[k].downloaded = true;
  return eps;
};

/** Which downloads to start so a show satisfies its auto-download rule. */
const autoDownloads = (s: Data, showId: string): ActiveDl[] => {
  const show = findShow(s, showId);
  if (!show) return [];
  const rule = ruleFor(s, showId).value;
  if (rule === 'Off') return [];
  const n = rule === 'All' ? show.eps.length : parseInt(rule.replace('Latest ', ''), 10);
  const out: ActiveDl[] = [];
  for (let i = 0; i < Math.min(n, show.eps.length); i++) {
    const key = epKey(showId, i);
    const st = getEp(s, key);
    if (st.downloaded || st.played || s.dl.some((d) => d.key === key)) continue;
    out.push({ key, p: 0, mb: episodeInfo(show, i).sizeMb });
  }
  return out;
};

const newShowEps = (show: Show) => {
  const eps: Record<string, EpState> = {};
  show.eps.forEach((_, i) => { eps[epKey(show.id, i)] = { played: false, progress: 0, downloaded: false, inbox: i === 0 }; });
  return eps;
};

// ---------- initial state ----------

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const flag = (name: string, dflt: boolean) => (params.has(name) ? params.get(name) !== 'false' : dflt);
const startScreen = (SCREENS as string[]).includes(params.get('screen') ?? '') ? (params.get('screen') as Screen) : 'show';

const initialData: Data = {
  shows: SHOWS,
  eps: seedEps(),
  cur: 'kp:1',
  pos: 1834,
  playing: true,
  speed: 1.2,
  volume: 0.7,
  muted: false,
  queue: ['kp:1', 'ct:0', 'sa:1', 'mf:0', 'se:1'],
  dl: [{ key: 'sa:0', p: 0.42, mb: 53 }, { key: 'fn:0', p: 0.08, mb: 40 }, { key: 'ns:0', p: 0, mb: 31 }],
  dlDone: [{ key: 'ct:0', when: 'Today, 07:12' }, { key: 'mf:0', when: 'Today, 07:10' }, { key: 'ns:1', when: 'Yesterday' }, { key: 'se:0', when: 'Oct 22' }],
  dlPaused: false,
  ovr: { kp: { dl: 'Latest 3', speed: 'Global', trim: 'Global', intro: 'Off' } },
  tg: { auto: true, metered: true, silence: true, notify: false, deletePlayed: true },
  sv: { keep: '3', par: '2', speed: '1.2×', del: '1 week', skip: '15 / 30 s' },
  folder: '~/Podcasts',
  storageLimitGb: 40,
  usedMb: 14540,
  syncServer: 'sync.example.org',
  lastSynced: '09:41',
  lastChecked: Date.now() - 4 * 60 * 1000,
  trimSaved: 252,
};

const initialUi: Ui = {
  screen: startScreen,
  history: [],
  showId: 'kp',
  filter: 'All',
  cat: 'Popular',
  discoverQuery: '',
  npOpen: flag('nowPlaying', true),
  npFull: false,
  cfgOpen: false,
  trayOpen: flag('tray', true),
  trayPinned: false,
  windowHidden: false,
  palette: false,
  query: '',
  menu: null,
  dialog: null,
  refreshing: false,
  sleep: { mode: 'off' },
  toasts: [],
};

let toastId = 0;

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...initialData,
      ...initialUi,

      go: (screen, extra) =>
        set((s) => ({ screen, history: [...s.history, { screen: s.screen, showId: s.showId }], palette: false, menu: null, npFull: false, ...extra })),
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
        set((s) => ({ toasts: [...s.toasts, { id, text }] }));
        setTimeout(() => get().dismissToast(id), 3200);
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      play: (key) => {
        const s = get();
        if (s.cur === key) { set({ playing: !s.playing, palette: false }); return; }
        const next = epInfo(s, key);
        if (!next) return;
        const prev = epInfo(s, s.cur);
        const eps = { ...s.eps };
        if (prev) eps[s.cur] = { ...getEp(s, s.cur), progress: Math.min(1, s.pos / prev.dur) };
        const st = getEp(s, key);
        let pos = st.progress < 1 ? st.progress * next.dur : 0;
        if (pos === 0) pos = introFor(s, next.show.id);
        set({ eps, cur: key, pos, playing: true, palette: false, speed: speedFor(s, next.show.id) });
      },
      togglePlay: () => set((s) => ({ playing: !s.playing })),
      seek: (pos) => {
        const cur = epInfo(get(), get().cur);
        if (cur) set({ pos: Math.max(0, Math.min(cur.dur, pos)) });
      },
      skipBack: () => get().seek(get().pos - skipAmounts(get().sv.skip)[0]),
      skipFwd: () => get().seek(get().pos + skipAmounts(get().sv.skip)[1]),
      prevChapter: () => {
        const s = get();
        const cur = epInfo(s, s.cur);
        if (!cur) return;
        const ch = chaptersFor(cur);
        const ci = currentChapter(ch, s.pos);
        set({ pos: ch[Math.max(0, s.pos - ch[ci].at > 3 ? ci : ci - 1)].at });
      },
      nextChapter: () => {
        const s = get();
        const cur = epInfo(s, s.cur);
        if (!cur) return;
        const ch = chaptersFor(cur);
        const ci = currentChapter(ch, s.pos);
        if (ci < ch.length - 1) set({ pos: ch[ci + 1].at });
      },
      cycleSpeed: () => set((s) => ({ speed: SPEEDS[(SPEEDS.indexOf(s.speed) + 1) % SPEEDS.length] })),
      setSpeed: (speed) => set({ speed, palette: false }),
      setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)), muted: false }),
      toggleMute: () => set((s) => ({ muted: !s.muted })),
      setSleep: (sleep) => {
        set({ sleep, menu: null, palette: false });
        if (sleep.mode !== 'off') get().toast(`Sleep timer: ${sleepLabel(sleep).toLowerCase()}`);
      },

      tick: () => {
        const s = get();
        const cur = epInfo(s, s.cur);
        const patch: Partial<State> = {};

        // Playback clock
        if (cur && s.playing) {
          const ch = chaptersFor(cur);
          const before = currentChapter(ch, s.pos);
          const pos = Math.min(cur.dur, s.pos + s.speed);
          patch.pos = pos;
          if (trimOn(s, cur.show.id)) patch.trimSaved = s.trimSaved + 0.07 * s.speed;
          if (s.sleep.mode === 'chapter' && currentChapter(ch, pos) !== before) {
            patch.playing = false;
            patch.sleep = { mode: 'off' };
          }
          if (s.sleep.mode === 'timer') {
            const remaining = s.sleep.remaining - 1;
            patch.sleep = remaining > 0 ? { ...s.sleep, remaining } : { mode: 'off' };
            if (remaining <= 0) patch.playing = false;
          }
        }

        // Downloads
        let dl = s.dl;
        if (!s.dlPaused && dl.length) {
          const par = parseInt(s.sv.par, 10);
          let active = 0;
          dl = dl.map((d) => {
            if (d.p >= 1 || active >= par) return d;
            active++;
            return { ...d, p: Math.min(1, d.p + 1.8 / d.mb) };
          });
          const done = dl.filter((d) => d.p >= 1);
          if (done.length) {
            const eps = { ...s.eps };
            done.forEach((d) => { eps[d.key] = { ...getEp(s, d.key), downloaded: true }; });
            patch.eps = eps;
            patch.usedMb = s.usedMb + done.reduce((a, d) => a + d.mb, 0);
            patch.dlDone = [...done.map((d) => ({ key: d.key, when: nowLabel() })), ...s.dlDone];
            dl = dl.filter((d) => d.p < 1);
          }
          patch.dl = dl;
        }
        set(patch);

        // End of episode: mark played, then advance the queue.
        if (cur && patch.pos !== undefined && patch.pos >= cur.dur) {
          const after = get();
          const eps = { ...after.eps, [cur.key]: { ...getEp(after, cur.key), played: true, progress: 1 } };
          const queue = after.queue.filter((k) => k !== cur.key);
          set({ eps, queue });
          if (after.sleep.mode === 'episode' || !queue.length) {
            set({ playing: false, sleep: { mode: 'off' } });
          } else {
            get().play(queue[0]);
          }
        }
      },

      startDownload: (key) => {
        const s = get();
        const info = epInfo(s, key);
        if (!info || s.dl.some((d) => d.key === key)) return;
        set({ dl: [...s.dl, { key, p: 0, mb: info.sizeMb }] });
      },
      cancelDownload: (key) => set((s) => ({ dl: s.dl.filter((d) => d.key !== key) })),
      deleteFile: (key) => {
        const s = get();
        const info = epInfo(s, key);
        if (!info) return;
        set({ eps: { ...s.eps, [key]: { ...getEp(s, key), downloaded: false } }, usedMb: Math.max(0, s.usedMb - info.sizeMb) });
        s.toast(`Deleted “${info.title}” from disk`);
      },
      toggleDlPause: () => set((s) => ({ dlPaused: !s.dlPaused })),

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
        set((s) => ({ eps: { ...s.eps, [key]: { ...getEp(s, key), played, progress: played ? 1 : 0 } } })),
      markAllPlayed: () =>
        set((s) => {
          const eps = { ...s.eps };
          for (const [k, v] of Object.entries(eps)) if (v.inbox && !v.played && k !== s.cur) eps[k] = { ...v, played: true, progress: 1 };
          return { eps };
        }),
      refresh: () => {
        if (get().refreshing) return;
        set({ refreshing: true });
        setTimeout(() => {
          const s = get();
          const queued = s.shows.flatMap((sh) => autoDownloads(s, sh.id));
          set({ refreshing: false, lastChecked: Date.now(), dl: [...s.dl, ...queued] });
          s.toast(queued.length ? `Feeds refreshed · ${queued.length} episode${queued.length > 1 ? 's' : ''} queued by auto-download` : 'Feeds refreshed · everything is up to date');
        }, 2200);
      },

      toggleDiscover: (title) => {
        const s = get();
        const entry = DISCOVER.find((d) => d.title === title);
        if (!entry) return;
        const id = `d-${slug(title)}`;
        if (findShow(s, id)) { get().unsubscribe(id); return; }
        const show: Show = {
          id, title: entry.title, author: entry.author, hue: entry.hue, cat: entry.cat, freq: entry.freq,
          desc: entry.blurb, feedUrl: `https://${slug(title)}.example/feed.xml`, eps: entry.eps, durs: entry.durs,
        };
        set({ shows: [...s.shows, show], eps: { ...s.eps, ...newShowEps(show) } });
        set((x) => ({ dl: [...x.dl, ...autoDownloads(x, id)] }));
        s.toast(`Subscribed to ${show.title}`);
      },
      addFeed: (url, title) => {
        const s = get();
        const clean = url.trim();
        if (s.shows.some((x) => x.feedUrl === clean)) { s.toast('You are already subscribed to that feed'); return null; }
        const name = title || titleFromUrl(clean);
        let id = `u-${slug(name)}`;
        while (findShow(get(), id)) id += '-';
        const show: Show = {
          id, title: name, author: new URL(clean).hostname, hue: Math.round(Math.random() * 360), cat: 'Uncategorised', freq: 'Unknown',
          desc: `Added from ${clean}. Episodes appear here after the feed is fetched.`, feedUrl: clean, eps: [], durs: [],
        };
        set((x) => ({ shows: [...x.shows, show] }));
        return id;
      },
      importFeeds: (feeds) => {
        let n = 0;
        for (const f of feeds) if (get().addFeed(f.xmlUrl, f.title)) n++;
        return n;
      },
      unsubscribe: (id) => {
        const s = get();
        const show = findShow(s, id);
        if (!show) return;
        if (s.shows.length === 1) { s.toast('Resonate needs at least one subscription'); return; }
        const shows = s.shows.filter((x) => x.id !== id);
        const patch: Partial<State> = {
          shows,
          queue: s.queue.filter((k) => parseKey(k)[0] !== id),
          dl: s.dl.filter((d) => parseKey(d.key)[0] !== id),
          cfgOpen: false,
          dialog: null,
        };
        if (parseKey(s.cur)[0] === id) {
          const nextShow = shows.find((x) => x.eps.length) ?? shows[0];
          Object.assign(patch, { cur: epKey(nextShow.id, 0), pos: 0, playing: false });
        }
        if (s.showId === id) Object.assign(patch, { showId: shows[0].id, screen: s.screen === 'show' ? 'shows' : s.screen });
        set(patch);
        s.toast(`Unsubscribed from ${show.title}`);
      },

      setOverride: (showId, k, v) => set((s) => ({ ovr: { ...s.ovr, [showId]: { ...s.ovr[showId], [k]: v } } })),
      resetOverride: (showId) =>
        set((s) => {
          const ovr = { ...s.ovr };
          delete ovr[showId];
          return { ovr };
        }),
      setToggle: (k) => set((s) => ({ tg: { ...s.tg, [k]: !s.tg[k] } })),
      setSeg: (k, v) => set((s) => ({ sv: { ...s.sv, [k]: v } })),
      setPrefs: (patch) => set(patch),
    }),
    {
      name: 'resonate-state-v1',
      partialize: (s) => {
        const data: Partial<Data> = {};
        for (const k of Object.keys(initialData) as (keyof Data)[]) (data as Record<string, unknown>)[k] = s[k];
        return { ...data, playing: false };
      },
    },
  ),
);

export function currentChapter(ch: { at: number }[], pos: number) {
  return Math.max(0, ch.reduce((a, c, i) => (c.at <= pos ? i : a), 0));
}

export function sleepLabel(sleep: Sleep) {
  switch (sleep.mode) {
    case 'off': return 'Off';
    case 'chapter': return 'End of chapter';
    case 'episode': return 'End of episode';
    case 'timer': return `${Math.ceil(sleep.remaining / 60)} min`;
  }
}
