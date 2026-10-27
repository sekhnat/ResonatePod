import { art, epKey, fmt, mono, type Episode, type Show } from './data';
import { dlRuleLabel } from './settings-labels';
import { dlByKey, downloadsBlocked, epInfo, findShow, getEp, ruleFor, type EpState, type Filter, type Sort, type State } from './store';

export type EpStatus = 'cloud' | 'downloaded' | 'played' | 'downloading';

const STATUS: Record<EpStatus, [icon: string, color: string, label: string]> = {
  cloud: ['ph ph-cloud', 'var(--color-neutral-600)', 'Not downloaded'],
  downloaded: ['ph-fill ph-check-circle', 'var(--color-neutral-400)', 'Downloaded'],
  played: ['ph ph-check', 'var(--color-neutral-700)', 'Played'],
  downloading: ['ph ph-circle-notch', 'var(--color-accent)', 'Downloading'],
};

export interface EpisodeRow {
  key: string;
  title: string;
  showTitle: string;
  showId: string;
  art: string;
  mono: string;
  imageUrl?: string;
  /** The detail line ("Today · 72 min · 12:03 left · 66 MB"), with the saved position for any time left. */
  meta: string;
  /** What comes before and after the time left in `meta`, for liveMeta. */
  head: string;
  tail: string;
  durMin: number;
  /** Publication time, ms since epoch; 0 when undated. */
  pubDate: number;
  /** Seconds; 0 when unknown. */
  dur: number;
  status: EpStatus;
  stIcon: string;
  stColor: string;
  stLabel: string;
  isNew: boolean;
  isCur: boolean;
  isPlaying: boolean;
  played: boolean;
  downloaded: boolean;
  downloading: boolean;
  progress: number;
  file?: string;
}

/**
 * The row for an episode. It doesn't read the live playback position (that changes four times a second, and
 * rows are built for whole lists): the playing episode shows its saved position until RowMeta/RowProgress,
 * which read the playhead, take over.
 */
export function episodeRow(s: Pick<State, 'shows' | 'eps' | 'dl' | 'cur' | 'playing'>, key: string): EpisodeRow | null {
  const e = epInfo(s, key);
  if (!e) return null;
  const st = getEp(s, key);
  const isCur = s.cur === key;
  const dlItem = dlByKey(s.dl).get(key);
  const played = st.played && !isCur;
  const status: EpStatus = dlItem && !dlItem.error ? 'downloading' : played ? 'played' : st.file ? 'downloaded' : 'cloud';
  const [stIcon, stColor, stLabel] = STATUS[status];
  const pos = st.pos;
  const head = [e.date];
  if (e.durMin) head.push(`${e.durMin} min`);
  const tail: string[] = [];
  if (e.sizeMb) tail.push(`${e.sizeMb} MB`);
  if (e.ep.enclosureType.startsWith('video/')) tail.push('Video');
  if (dlItem?.error) tail.push('Download failed');
  else if (dlItem && dlItem.total) tail.push(`${Math.round((dlItem.received / dlItem.total) * 100)}%`);
  const left = (isCur || (!played && pos > 30)) && e.dur ? [`${fmt(e.dur - pos)} left`] : [];
  return {
    key,
    title: e.title,
    showTitle: e.show.title,
    showId: e.show.id,
    art: art(e.show.hue),
    mono: mono(e.show.title),
    imageUrl: e.ep.imageUrl ?? e.show.imageUrl,
    meta: [...head, ...left, ...tail].join(' · '),
    head: head.join(' · '),
    tail: tail.join(' · '),
    durMin: e.durMin,
    pubDate: e.ep.pubDate,
    dur: e.dur,
    status, stIcon, stColor, stLabel,
    isNew: st.inbox && !st.played,
    isCur,
    isPlaying: isCur && s.playing,
    played,
    downloaded: !!st.file,
    downloading: !!dlItem && !dlItem.error,
    progress: e.dur ? pos / e.dur : 0,
    file: st.file,
  };
}

/** The detail line of the playing episode's row at a live position. */
export const liveMeta = (e: Pick<EpisodeRow, 'head' | 'tail' | 'dur'>, pos: number) =>
  [e.head, `${fmt(e.dur - pos)} left`, e.tail].filter(Boolean).join(' · ');

/** For building rows when what they would say about downloads doesn't matter (sorting and filtering). */
export const NO_DOWNLOADS: State['dl'] = [];

export const rowsFor = (s: Pick<State, 'shows' | 'eps' | 'dl' | 'cur' | 'playing'>, keys: string[]) => keys.map((k) => episodeRow(s, k)).filter((r): r is EpisodeRow => !!r);

/** The few fields ordering and filtering look at, so a list can be put in order without building its rows. */
export type Orderable = Pick<EpisodeRow, 'key' | 'title' | 'pubDate' | 'dur' | 'played' | 'downloaded'>;

export const orderable = (show: Show, ep: Episode, st: EpState, cur: string | null): Orderable => {
  const key = epKey(show.id, ep.guid);
  return { key, title: ep.title, pubDate: ep.pubDate, dur: ep.duration, played: st.played && cur !== key, downloaded: !!st.file };
};

export const applyFilter = <T extends Pick<Orderable, 'played' | 'downloaded'>>(rows: T[], f: Filter): T[] =>
  rows.filter((r) => f === 'All' || (f === 'Unplayed' && !r.played) || (f === 'Downloaded' && r.downloaded));

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Orders by `by`, with unknown values (0) last in either direction. */
const byValue = (by: (r: Orderable) => number, dir: 1 | -1) => (a: Orderable, b: Orderable) => {
  const x = by(a), y = by(b);
  return !x === !y ? dir * (x - y) : x ? -1 : 1;
};

/** Sorts a copy of `rows`; ties fall back to newest first. */
export function applySort<T extends Orderable>(rows: T[], sort: Sort): T[] {
  const newest = (a: Orderable, b: Orderable) => b.pubDate - a.pubDate;
  const primary: Record<Sort, (a: Orderable, b: Orderable) => number> = {
    'Newest first': byValue((r) => r.pubDate, -1),
    'Oldest first': byValue((r) => r.pubDate, 1),
    'Longest first': byValue((r) => r.dur, -1),
    'Shortest first': byValue((r) => r.dur, 1),
    'Title A–Z': (a, b) => collator.compare(a.title, b.title),
    'Title Z–A': (a, b) => collator.compare(b.title, a.title),
    'Unplayed first': (a, b) => Number(a.played) - Number(b.played),
  };
  return [...rows].sort((a, b) => primary[sort](a, b) || newest(a, b));
}

type Library = Pick<State, 'shows' | 'eps'>;

/**
 * Remembers the last answer for the last library it was asked about. `shows` and `eps` are replaced, never edited,
 * so the same two objects mean the same answer; the sidebar and header ask on every render. Callers get the shared
 * result and must not modify it.
 */
function perLibrary<R>(compute: (s: Library) => R): (s: Library) => R {
  let shows: Library['shows'] | undefined;
  let eps: Library['eps'] | undefined;
  let value: R;
  return (s) => {
    if (s.shows !== shows || s.eps !== eps) { value = compute(s); shows = s.shows; eps = s.eps; }
    return value;
  };
}

/** Episodes flagged as new, newest first across shows. */
export const inboxKeys = perLibrary((s) => {
  const out: { key: string; at: number }[] = [];
  for (const sh of s.shows) for (const e of sh.eps) { const key = epKey(sh.id, e.guid); if (s.eps[key]?.inbox) out.push({ key, at: e.pubDate }); }
  return out.sort((a, b) => b.at - a.at).map((x) => x.key);
});

// One show's count, kept while neither its episodes nor the state records have been replaced. A page asks for a single
// show, so it must not pay for counting all of them; the sidebar asks for every show and pays once per change.
const unplayedCache = new Map<string, { episodes: Episode[]; state: Library['eps']; n: number }>();

export const unplayedFor = (s: Library, showId: string) => {
  const sh = findShow(s, showId);
  if (!sh) return 0;
  const hit = unplayedCache.get(showId);
  if (hit && hit.episodes === sh.eps && hit.state === s.eps) return hit.n;
  let n = 0;
  for (const e of sh.eps) { const st = s.eps[epKey(sh.id, e.guid)]; if (st?.inbox && !st.played) n++; }
  unplayedCache.set(showId, { episodes: sh.eps, state: s.eps, n });
  return n;
};

export const totalUnplayed = perLibrary((s) => s.shows.reduce((a, sh) => a + unplayedFor(s, sh.id), 0));

export function ruleLabel(s: State, showId: string) {
  const r = ruleFor(s, showId);
  const what = dlRuleLabel(r.value).toLowerCase();
  return `Auto-download ${what}${r.global ? ' (global)' : ''}`;
}

const MB = 1048576;

export function dlSummary(s: Pick<State, 'dl' | 'dlPaused' | 'tg' | 'metered'>) {
  const active = s.dl.filter((d) => !d.error);
  const failed = s.dl.length - active.length;
  const failedLabel = failed ? `${failed} failed` : '';
  if (!active.length) return failedLabel || 'Nothing downloading';
  const left = active.reduce((a, d) => a + Math.max(0, d.total - d.received), 0);
  const unknown = active.some((d) => !d.total);
  const state = downloadsBlocked(s) ? ' · paused' : '';
  return `${active.length} active · ${unknown ? 'about ' : ''}${Math.round(left / MB)} MB remaining${state}${failed ? ` · ${failedLabel}` : ''}`;
}

export const fmtSpeed = (bps: number) => (bps >= MB ? `${(bps / MB).toFixed(1)} MB/s` : `${Math.round(bps / 1024)} KB/s`);

export function agoLabel(ts: number) {
  if (!ts) return 'never';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m <= 0) return 'just now';
  if (m === 1) return '1 minute ago';
  if (m < 60) return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  return h === 1 ? '1 hour ago' : h < 24 ? `${h} hours ago` : new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const clockLabel = (ts: number) => (ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'never');
