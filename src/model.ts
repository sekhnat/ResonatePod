import { art, fmt, mono } from './data';
import { epInfo, getEp, ruleFor, type Filter, type State } from './store';

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
  meta: string;
  durMin: number;
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
}

export function episodeRow(s: State, key: string): EpisodeRow | null {
  const e = epInfo(s, key);
  if (!e) return null;
  const st = getEp(s, key);
  const isCur = s.cur === key;
  const dlItem = s.dl.find((d) => d.key === key);
  const played = st.played && !isCur;
  const status: EpStatus = dlItem ? 'downloading' : played ? 'played' : st.downloaded ? 'downloaded' : 'cloud';
  const [stIcon, stColor, stLabel] = STATUS[status];
  return {
    key,
    title: e.title,
    showTitle: e.show.title,
    showId: e.show.id,
    art: art(e.show.hue),
    mono: mono(e.show.title),
    meta: `${e.date} · ${e.durMin} min${isCur ? ` · ${fmt(e.dur - s.pos)} left` : ''} · ${e.sizeMb} MB` + (dlItem ? ` · ${Math.round(dlItem.p * 100)}%` : ''),
    durMin: e.durMin,
    status, stIcon, stColor, stLabel,
    isNew: st.inbox && !st.played,
    isCur,
    isPlaying: isCur && s.playing,
    played,
    downloaded: st.downloaded,
    downloading: !!dlItem,
    progress: isCur ? s.pos / e.dur : st.progress,
  };
}

export const rowsFor = (s: State, keys: string[]) => keys.map((k) => episodeRow(s, k)).filter((r): r is EpisodeRow => !!r);

export const applyFilter = (rows: EpisodeRow[], f: Filter) =>
  rows.filter((r) => f === 'All' || (f === 'Unplayed' && !r.played) || (f === 'Downloaded' && r.downloaded));

/** Episodes flagged as new, newest first across shows (as the inbox lists them). */
export function inboxKeys(s: State) {
  const maxEps = Math.max(0, ...s.shows.map((x) => x.eps.length));
  const keys: string[] = [];
  for (let i = 0; i < maxEps; i++) for (const sh of s.shows) if (i < sh.eps.length && s.eps[`${sh.id}:${i}`]?.inbox) keys.push(`${sh.id}:${i}`);
  return keys;
}

export const unplayedFor = (s: State, showId: string) => {
  const sh = s.shows.find((x) => x.id === showId);
  return sh ? sh.eps.filter((_, i) => { const e = s.eps[`${showId}:${i}`]; return e?.inbox && !e.played; }).length : 0;
};

export const totalUnplayed = (s: State) => s.shows.reduce((a, sh) => a + unplayedFor(s, sh.id), 0);

export function ruleLabel(s: State, showId: string) {
  const r = ruleFor(s, showId);
  if (r.value === 'Off') return r.global ? 'Auto-download off (global)' : 'Auto-download off';
  if (r.global) return r.value === 'All' ? 'Auto-download all (global)' : `Auto-download ${r.value.toLowerCase()} (global)`;
  return r.value === 'All' ? 'Auto-download all' : `Auto-download ${r.value.toLowerCase()}`;
}

export function dlSummary(s: State) {
  const done = s.dl.reduce((a, d) => a + d.mb * d.p, 0);
  const tot = s.dl.reduce((a, d) => a + d.mb, 0);
  return s.dl.length ? `${s.dl.length} active · ${Math.round(tot - done)} MB remaining` : 'Nothing downloading';
}

export function minutesAgo(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000);
  return m <= 0 ? 'just now' : m === 1 ? '1 minute ago' : `${m} minutes ago`;
}
