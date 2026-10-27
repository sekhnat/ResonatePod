import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { cadence, parseFeed } from '../shared/feed';
import { fileStem, safeName, shortHash } from '../shared/filename';
import { parseJsonChapters, parseTranscript } from '../shared/meta';
import { GpodderClient, syncOnce, type EpisodeAction } from '../shared/gpodder';
import type { DownloadEvent } from '../shared/types';
import {
  chaptersFor, epKey, episodeInfo, hueFor, lastAtOrBefore, parseKey, sameEpisode, type Episode, type EpisodeInfo, type EpisodeMeta, type Show,
} from './data';
import type { OpmlFeed } from './lib/opml';
import { defaultCountry, gpodderResult, resolveFeedUrl, type DirectoryResult, type SourceChoice } from './lib/directory';
import { SMALL_BODY_BYTES, platform } from './platform';
import { getPlayhead, setPlayhead } from './playhead';
import { dropNotes, holdNotes } from './notes';

export type Screen = 'inbox' | 'shows' | 'show' | 'queue' | 'downloads' | 'discover' | 'settings';
export type Filter = 'All' | 'Unplayed' | 'Downloaded';
export const SORTS = ['Newest first', 'Oldest first', 'Longest first', 'Shortest first', 'Title A–Z', 'Title Z–A', 'Unplayed first'] as const;
export type Sort = (typeof SORTS)[number];
/** Sort scope for the Inbox; show ids never contain ':' so it can't collide. */
export const INBOX_SORT = ':inbox';

export interface EpState {
  played: boolean;
  /** Resume position in seconds. */
  pos: number;
  inbox: boolean;
  file?: string;
  fileBytes?: number;
  playedAt?: number;
  lastPlayed?: number;
}
export interface ActiveDl {
  key: string;
  received: number;
  total: number;
  speed: number;
  /** Set while waiting to retry automatically (ms since epoch). */
  retryAt?: number;
  /** A transfer is under way (not waiting for a slot, waiting to retry, or failed). */
  active?: boolean;
  /** Set once retries are exhausted; the row stays until retried or removed. */
  error?: string;
}
export interface DoneDl { key: string; when: number }
export interface Override { dl?: string; speed?: string; trim?: string; intro?: string }
export type Sleep =
  | { mode: 'off' }
  | { mode: 'timer'; minutes: number; remaining: number }
  | { mode: 'chapter' }
  | { mode: 'episode' };
export type DialogKind = 'unsubscribe' | 'folder' | 'storage' | 'sync' | 'shortcuts' | 'about' | 'move' | 'feedAuth' | 'podcastIndex';
export interface DirectoryPrefs {
  /** Apple storefront for charts and search, e.g. "gb". */
  country: string;
  source: SourceChoice;
  /** A Podcast Index key is saved (the key itself lives in secrets). */
  podcastIndex: boolean;
}
export interface Toast { id: number; text: string }
export interface Toggles { auto: boolean; metered: boolean; silence: boolean; notify: boolean; deletePlayed: boolean; autostart: boolean }
export interface SegValues { keep: string; par: string; speed: string; del: string; skip: string }
export interface SyncState {
  server: string;
  user: string;
  device: string;
  subsSince: number;
  actionsSince: number;
  known: string[];
  pending: EpisodeAction[];
  lastSynced: number;
}

export interface Data {
  shows: Show[];
  eps: Record<string, EpState>;
  cur: string | null;
  speed: number;
  volume: number;
  muted: boolean;
  queue: string[];
  dlDone: DoneDl[];
  /** Downloads queued, running or failed; restarted (resuming from the .part file) on launch. */
  dlPending: string[];
  dlPaused: boolean;
  ovr: Record<string, Override>;
  /** Episode sort per show id (and INBOX_SORT); absent means newest first. */
  sorts: Record<string, Sort>;
  tg: Toggles;
  sv: SegValues;
  folder: string;
  storageLimitGb: number;
  sync: SyncState;
  lastChecked: number;
  trimSaved: number;
  directory: DirectoryPrefs;
}

interface Ui {
  hydrated: boolean;
  playing: boolean;
  dl: ActiveDl[];
  meta: Record<string, EpisodeMeta>;
  /** The current episode has a picture (video podcast). */
  video: boolean;
  /** Folder change waiting on the "move downloaded files?" dialog. */
  pendingMove: { from: string; to: string } | null;
  /** Feed that needs a username and password (the show, when already subscribed). */
  authFor: { url: string; showId?: string } | null;
  metered: boolean | null;
  /** Size of everything in the download folder, from the last scan (null before one). Information only: the limit counts tracked files. */
  folderBytes: number | null;
  /** Silence-trim time saved since the last checkpoint; kept out of the persisted data so it doesn't trigger a save every second. */
  trimPending: number;
  screen: Screen;
  history: { screen: Screen; showId: string }[];
  showId: string;
  filter: Filter;
  cat: string;
  discoverQuery: string;
  npOpen: boolean;
  npFull: boolean;
  cfgOpen: boolean;
  palette: boolean;
  query: string;
  menu: 'main' | 'sleep-bar' | null;
  dialog: DialogKind | null;
  refreshing: boolean;
  syncing: boolean;
  adding: number;
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
  onTime(pos: number): void;
  onDuration(dur: number): void;
  onEnded(): void;
  onPlayError(message: string): void;
  addTrimSaved(sec: number): void;
  loadMeta(key: string): Promise<void>;

  startDownload(key: string): void;
  cancelDownload(key: string): void;
  /** Saves the playback position into the episode record (written to disk with the library). */
  checkpoint(): void;
  moveDownloads(from: string, to: string): Promise<void>;
  signInFeed(url: string, user: string, password: string, showId?: string): Promise<'ok' | 'denied' | 'failed'>;
  deleteFile(key: string, quiet?: boolean): Promise<void>;
  toggleDlPause(): void;
  onDownloadEvent(e: DownloadEvent): void;
  updateUsage(): Promise<void>;
  cleanupStorage(opts?: { quiet?: boolean }): Promise<void>;

  addToQueue(key: string): void;
  removeFromQueue(key: string): void;
  moveQueue(from: number, to: number): void;
  clearQueue(): void;

  markPlayed(key: string, played: boolean): void;
  markAllPlayed(): void;
  refresh(): Promise<void>;

  addFeed(url: string, opts?: { quiet?: boolean }): Promise<string | null>;
  importFeeds(feeds: OpmlFeed[]): Promise<number>;
  unsubscribe(id: string, quiet?: boolean): void;

  setOverride(showId: string, k: keyof Override, v: string): void;
  resetOverride(showId: string): void;
  setSort(scope: string, sort: Sort): void;
  setToggle(k: keyof Toggles): void;
  setSeg(k: keyof SegValues, v: string): void;
  setPrefs(patch: Partial<Pick<Data, 'folder' | 'storageLimitGb'>>): void;

  setDirectory(patch: Partial<DirectoryPrefs>): void;
  setPodcastIndexKey(key: { key: string; secret: string } | null): Promise<void>;
  /** gpodder.net's personal recommendations for the sync account; [] without sync or support. */
  gpodderSuggestions(): Promise<DirectoryResult[]>;

  configureSync(server: string, user: string, password: string): Promise<boolean>;
  disconnectSync(): void;
  runSync(): Promise<void>;
}

export type State = Data & Ui & Actions;

export const sortFor = (s: State, scope: string): Sort => s.sorts[scope] ?? 'Newest first';

// ---------- player bridge (set by the audio engine) ----------

export interface Player { seek(pos: number): void }
let player: Player | null = null;
export const setPlayer = (p: Player | null) => { player = p; };

// ---------- helpers ----------

export const parseSpeed = (s: string) => parseFloat(s.replace('×', ''));
export const skipAmounts = (skip: string): [number, number] => {
  const [b, f] = skip.replace(' s', '').split('/').map((x) => parseInt(x, 10));
  return [b, f];
};
const SPEEDS = [1, 1.2, 1.5, 2];
const DAY = 86400000;
const GB = 1024 ** 3;

export const findShow = (s: Pick<Data, 'shows'>, id: string) => s.shows.find((x) => x.id === id);

// Lookups by key are indexed, and each index lives as long as the array it was built from, so it is rebuilt
// only when that array is replaced (state is never mutated in place).
const showsById = new WeakMap<Show[], Map<string, Show>>();
const epsByGuid = new WeakMap<Episode[], Map<string, Episode>>();
// An episode's info is built once; the date label ("Today", "Yesterday") is the only part that ages, so it is keyed by the day.
const infoCache = new WeakMap<Episode, { show: Show; day: string; info: EpisodeInfo }>();
let dayStamp = '';
let dayChecked = 0;
const today = () => {
  const now = Date.now();
  if (Math.abs(now - dayChecked) > 30_000) { dayChecked = now; dayStamp = new Date(now).toDateString(); } // either way: the clock can be set back
  return dayStamp;
};
/** A map from `key(item)` to the first item with it, like `find` would give. */
const indexBy = <T,>(items: T[], key: (x: T) => string) => {
  const m = new Map<string, T>();
  for (const x of items) { const k = key(x); if (!m.has(k)) m.set(k, x); }
  return m;
};

// The active-download list is replaced on every progress event, so it is indexed once per array
// instead of being scanned for each row (or each episode a download rule looks at).
const dlIndex = new WeakMap<ActiveDl[], Map<string, ActiveDl>>();
export const dlByKey = (dl: ActiveDl[]) => {
  let m = dlIndex.get(dl);
  if (!m) dlIndex.set(dl, (m = indexBy(dl, (d) => d.key)));
  return m;
};

export const epInfo = (s: Pick<Data, 'shows'>, key: string | null): EpisodeInfo | null => {
  if (!key) return null;
  const [id, guid] = parseKey(key);
  let shows = showsById.get(s.shows);
  if (!shows) showsById.set(s.shows, (shows = indexBy(s.shows, (x) => x.id)));
  const show = shows.get(id);
  if (!show) return null;
  let byGuid = epsByGuid.get(show.eps);
  if (!byGuid) epsByGuid.set(show.eps, (byGuid = indexBy(show.eps, (e) => e.guid)));
  const ep = byGuid.get(guid);
  if (!ep) return null;
  const day = today();
  const hit = infoCache.get(ep);
  if (hit && hit.show === show && hit.day === day) return hit.info;
  const info = episodeInfo(show, ep);
  infoCache.set(ep, { show, day, info });
  return info;
};

export const getEp = (s: Pick<Data, 'eps'>, key: string): EpState => s.eps[key] ?? { played: false, pos: 0, inbox: false };

const isDefaultEp = (st: EpState) =>
  !st.played && !st.pos && !st.inbox && !st.file && st.fileBytes == null && st.playedAt == null && st.lastPlayed == null;

/**
 * `eps` with `key` set to `st`, or without it when `st` says nothing the default doesn't. State is kept sparse: an
 * episode nobody has touched has no record (getEp supplies the default), so a library of thousands of episodes only
 * stores what has happened to a few of them.
 */
export const withEp = (eps: Data['eps'], key: string, st: EpState): Data['eps'] => {
  const next = { ...eps };
  if (isDefaultEp(st)) delete next[key];
  else next[key] = st;
  return next;
};

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

export const currentChapter = (ch: { at: number }[], pos: number) => lastAtOrBefore(ch, pos, (c) => c.at);

export const chaptersOf = (s: Pick<Ui, 'meta'>, info: EpisodeInfo) => chaptersFor(info, s.meta[info.key]);

export function sleepLabel(sleep: Sleep) {
  switch (sleep.mode) {
    case 'off': return 'Off';
    case 'chapter': return 'End of chapter';
    case 'episode': return 'End of episode';
    case 'timer': return `${Math.ceil(sleep.remaining / 60)} min`;
  }
}

/** Effective download pause: the user's toggle, or a metered connection when that preference is on. */
export const downloadsBlocked = (s: Pick<Data, 'dlPaused' | 'tg'> & Pick<Ui, 'metered'>) => s.dlPaused || (s.tg.metered && s.metered === true);

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'feed';
const isoNow = () => new Date().toISOString().slice(0, 19);

// How many of a show's episodes would be saved under each file name, kept until the show's episode list changes.
const stemCounts = new WeakMap<Episode[], Map<string, number>>();
const stemsOf = (show: Show) => {
  let counts = stemCounts.get(show.eps);
  if (!counts) {
    counts = new Map();
    for (const e of show.eps) { const k = fileStem(e.pubDate, e.title); counts.set(k, (counts.get(k) ?? 0) + 1); }
    stemCounts.set(show.eps, counts);
  }
  return counts;
};

/** Whether another episode would land on this one's file name: same show folder, day and title. */
const sharesFileName = (s: Pick<Data, 'shows'>, info: EpisodeInfo) => {
  const folder = safeName(info.show.title);
  const stem = fileStem(info.ep.pubDate, info.title);
  return s.shows.some((sh) => safeName(sh.title) === folder && (stemsOf(sh).get(stem) ?? 0) > (sh.id === info.show.id ? 1 : 0));
};

/** Which episodes a show's auto-download rule wants on disk but aren't there yet. */
export function autoDownloadKeys(s: Pick<Data, 'shows' | 'eps' | 'ovr' | 'tg' | 'sv'> & Pick<Ui, 'dl'>, showId: string): string[] {
  const show = findShow(s, showId);
  if (!show) return [];
  const rule = ruleFor(s, showId).value;
  if (rule === 'Off') return [];
  const n = rule === 'All' ? show.eps.length : parseInt(rule.replace('Latest ', ''), 10);
  const downloading = dlByKey(s.dl);
  return show.eps.slice(0, n).map((e) => epKey(showId, e.guid)).filter((k) => {
    const st = getEp(s, k);
    return !st.file && !st.played && !downloading.has(k);
  });
}

let trackedFor: Data['eps'] | undefined;
let trackedSum = 0;

/**
 * What the downloaded episodes Resonate knows about take up: the sizes recorded when each finished downloading.
 * This is what the storage limit counts. Walking the folder would also count partial files, other programs'
 * files and the files of shows that were unsubscribed from, none of which cleanup can delete.
 */
export function trackedBytes(eps: Data['eps']): number {
  if (eps !== trackedFor) {
    trackedSum = 0;
    for (const e of Object.values(eps)) if (e.file) trackedSum += e.fileBytes ?? 0;
    trackedFor = eps;
  }
  return trackedSum;
}

/** Files to delete under the "delete played" and storage-limit preferences, oldest played first. */
export function cleanupKeys(s: Pick<Data, 'eps' | 'sv' | 'storageLimitGb' | 'cur'>, now = Date.now()): string[] {
  const played = Object.entries(s.eps)
    .filter(([k, e]) => e.file && e.played && k !== s.cur)
    .sort((a, b) => (a[1].playedAt ?? 0) - (b[1].playedAt ?? 0));
  const out = new Set<string>();
  const maxAge = s.sv.del === '1 day' ? DAY : s.sv.del === '1 week' ? 7 * DAY : 0;
  if (maxAge) for (const [k, e] of played) if (now - (e.playedAt ?? now) > maxAge) out.add(k);
  let used = trackedBytes(s.eps) - [...out].reduce((a, k) => a + (s.eps[k].fileBytes ?? 0), 0);
  const limit = s.storageLimitGb * GB;
  for (const [k, e] of played) {
    if (used <= limit) break;
    if (out.has(k)) continue;
    out.add(k);
    used -= e.fileBytes ?? 0;
  }
  return [...out];
}

/** The show a feed describes. Its episodes carry no show notes (see notes.ts): those come back separately, by guid. */
function showFromFeed(url: string, xml: string, id: string, etag?: string, lastModified?: string): { show: Show; newFeedUrl?: string; notes: Map<string, string> } {
  const f = parseFeed(xml);
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

// ---------- initial state ----------

/** What is saved: the library (shows, episode state) and these named settings. */
export const initialData: Data = {
  shows: [],
  eps: {},
  cur: null,
  speed: 1.2,
  volume: 0.8,
  muted: false,
  queue: [],
  dlDone: [],
  dlPending: [],
  dlPaused: false,
  ovr: {},
  sorts: {},
  tg: { auto: true, metered: true, silence: true, notify: false, deletePlayed: true, autostart: false },
  sv: { keep: '3', par: '2', speed: '1.2×', del: '1 week', skip: '15 / 30 s' },
  folder: '~/Podcasts',
  storageLimitGb: 40,
  sync: { server: '', user: '', device: '', subsSince: 0, actionsSince: 0, known: [], pending: [], lastSynced: 0 },
  lastChecked: 0,
  trimSaved: 0,
  directory: { country: defaultCountry(), source: 'all', podcastIndex: false },
};

const initialUi: Ui = {
  hydrated: false,
  playing: false,
  dl: [],
  meta: {},
  video: false,
  pendingMove: null,
  authFor: null,
  metered: null,
  folderBytes: null,
  trimPending: 0,
  screen: 'inbox',
  history: [],
  showId: '',
  filter: 'All',
  cat: 'Popular',
  discoverQuery: '',
  npOpen: true,
  npFull: false,
  cfgOpen: false,
  palette: false,
  query: '',
  menu: null,
  dialog: null,
  refreshing: false,
  syncing: false,
  adding: 0,
  sleep: { mode: 'off' },
  toasts: [],
};

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
                const { show: upd, newFeedUrl, notes } = showFromFeed(sh.feedUrl, res.text, sh.id, res.etag, res.lastModified);
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
          const { show: parsed, notes } = showFromFeed(feedUrl, res.text, '', res.etag, res.lastModified);
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
