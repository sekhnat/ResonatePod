import { art, epKey, fmt, mono } from './data';
import { downloadsBlocked, epInfo, getEp, ruleFor, type Filter, type State } from './store';

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
  file?: string;
}

export function episodeRow(s: State, key: string): EpisodeRow | null {
  const e = epInfo(s, key);
  if (!e) return null;
  const st = getEp(s, key);
  const isCur = s.cur === key;
  const dlItem = s.dl.find((d) => d.key === key);
  const played = st.played && !isCur;
  const status: EpStatus = dlItem && !dlItem.error ? 'downloading' : played ? 'played' : st.file ? 'downloaded' : 'cloud';
  const [stIcon, stColor, stLabel] = STATUS[status];
  const pos = isCur ? s.pos : st.pos;
  const parts = [e.date];
  if (e.durMin) parts.push(`${e.durMin} min`);
  if (isCur && e.dur) parts.push(`${fmt(e.dur - s.pos)} left`);
  else if (!played && pos > 30 && e.dur) parts.push(`${fmt(e.dur - pos)} left`);
  if (e.sizeMb) parts.push(`${e.sizeMb} MB`);
  if (e.ep.enclosureType.startsWith('video/')) parts.push('Video');
  if (dlItem?.error) parts.push('Download failed');
  else if (dlItem && dlItem.total) parts.push(`${Math.round((dlItem.received / dlItem.total) * 100)}%`);
  return {
    key,
    title: e.title,
    showTitle: e.show.title,
    showId: e.show.id,
    art: art(e.show.hue),
    mono: mono(e.show.title),
    imageUrl: e.ep.imageUrl ?? e.show.imageUrl,
    meta: parts.join(' · '),
    durMin: e.durMin,
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

export const rowsFor = (s: State, keys: string[]) => keys.map((k) => episodeRow(s, k)).filter((r): r is EpisodeRow => !!r);

export const applyFilter = (rows: EpisodeRow[], f: Filter) =>
  rows.filter((r) => f === 'All' || (f === 'Unplayed' && !r.played) || (f === 'Downloaded' && r.downloaded));

/** Episodes flagged as new, newest first across shows. */
export function inboxKeys(s: State) {
  const out: { key: string; at: number }[] = [];
  for (const sh of s.shows) for (const e of sh.eps) { const key = epKey(sh.id, e.guid); if (s.eps[key]?.inbox) out.push({ key, at: e.pubDate }); }
  return out.sort((a, b) => b.at - a.at).map((x) => x.key);
}

export const unplayedFor = (s: State, showId: string) => {
  const sh = s.shows.find((x) => x.id === showId);
  return sh ? sh.eps.filter((e) => { const st = s.eps[epKey(showId, e.guid)]; return st?.inbox && !st.played; }).length : 0;
};

export const totalUnplayed = (s: State) => s.shows.reduce((a, sh) => a + unplayedFor(s, sh.id), 0);

export function ruleLabel(s: State, showId: string) {
  const r = ruleFor(s, showId);
  if (r.value === 'Off') return r.global ? 'Auto-download off (global)' : 'Auto-download off';
  if (r.global) return r.value === 'All' ? 'Auto-download all (global)' : `Auto-download ${r.value.toLowerCase()} (global)`;
  return r.value === 'All' ? 'Auto-download all' : `Auto-download ${r.value.toLowerCase()}`;
}

const MB = 1048576;

export function dlSummary(s: State) {
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
