import { fileStem, safeName } from '../../shared/filename';
import { chaptersFor, epKey, episodeInfo, lastAtOrBefore, parseKey, type Episode, type EpisodeInfo, type Show } from '../data';
import type { DlRule } from '../../shared/settings';
import type { ActiveDl, Data, EpState, Sleep, State, Sort, Ui } from './types';

export const sortFor = (s: State, scope: string): Sort => s.sorts[scope] ?? 'Newest first';

// ---------- helpers ----------

const DAY = 86400000;
export const GB = 1024 ** 3;

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

export const ruleFor = (s: Pick<Data, 'ovr' | 'tg' | 'sv'>, showId: string): { value: DlRule; global: boolean } => {
  const o = s.ovr[showId]?.dl;
  if (o !== undefined) return { value: o, global: false };
  return { value: s.tg.auto ? s.sv.keep : 'off', global: true };
};

export const trimOn = (s: Pick<Data, 'ovr' | 'tg'>, showId: string) => s.ovr[showId]?.trim ?? s.tg.silence;

export const speedFor = (s: Data, showId: string) => s.ovr[showId]?.speed ?? s.sv.speed;

export const introFor = (s: Data, showId: string) => s.ovr[showId]?.intro ?? 0;

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
export const sharesFileName = (s: Pick<Data, 'shows'>, info: EpisodeInfo) => {
  const folder = safeName(info.show.title);
  const stem = fileStem(info.ep.pubDate, info.title);
  return s.shows.some((sh) => safeName(sh.title) === folder && (stemsOf(sh).get(stem) ?? 0) > (sh.id === info.show.id ? 1 : 0));
};

/** Which episodes a show's auto-download rule wants on disk but aren't there yet. */
export function autoDownloadKeys(s: Pick<Data, 'shows' | 'eps' | 'ovr' | 'tg' | 'sv'> & Pick<Ui, 'dl'>, showId: string): string[] {
  const show = findShow(s, showId);
  if (!show) return [];
  const rule = ruleFor(s, showId).value;
  if (rule === 'off') return [];
  const n = rule === 'all' ? show.eps.length : rule;
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
  const maxAge = s.sv.del === 'day' ? DAY : s.sv.del === 'week' ? 7 * DAY : 0;
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
