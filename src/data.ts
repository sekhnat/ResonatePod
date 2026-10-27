import type { Chapter, Episode, TranscriptLine } from '../shared/types';

export type { Chapter, Episode, TranscriptLine };

export interface Show {
  id: string;
  title: string;
  author: string;
  /** Hue for the monogram placeholder when there's no artwork. */
  hue: number;
  cat: string;
  freq: string;
  desc: string;
  feedUrl: string;
  imageUrl?: string;
  link?: string;
  /** Newest first. */
  eps: Episode[];
  etag?: string;
  lastModified?: string;
  subscribedAt: number;
}

export const CATS = ['Popular', 'Technology', 'Science', 'History', 'Arts', 'Society', 'Books'];

export const art = (h: number) => `linear-gradient(140deg, oklch(0.46 0.07 ${h}), oklch(0.27 0.04 ${h}))`;

export const hueFor = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

export const mono = (t: string) =>
  t.replace(/&/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};

export const epKey = (showId: string, guid: string) => `${showId}:${guid}`;

const sameChapters = (a?: Chapter[], b?: Chapter[]) => a === b || (!!a && !!b && a.length === b.length && a.every((c, i) => c.at === b[i].at && c.t === b[i].t));

/** Whether two parses of an episode say the same thing (every field, chapters compared by value). */
export function sameEpisode(a: Episode, b: Episode) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Episode>) {
    if (k === 'inlineChapters' ? !sameChapters(a[k], b[k]) : a[k] !== b[k]) return false;
  }
  return true;
}

/** Show ids never contain ':', so split on the first one (GUIDs often contain colons). */
export const parseKey = (key: string): [string, string] => {
  const at = key.indexOf(':');
  return [key.slice(0, at), key.slice(at + 1)];
};

export function dateLabel(ms: number, now = Date.now()) {
  if (!ms) return 'Undated';
  const d = new Date(ms);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === today.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString('en-US', opts);
}

export interface EpisodeInfo {
  key: string;
  show: Show;
  ep: Episode;
  title: string;
  /** Seconds; 0 when unknown. */
  dur: number;
  durMin: number;
  date: string;
  sizeMb: number;
}

export const episodeInfo = (show: Show, ep: Episode): EpisodeInfo => ({
  key: epKey(show.id, ep.guid),
  show,
  ep,
  title: ep.title,
  dur: ep.duration,
  durMin: Math.round(ep.duration / 60),
  date: dateLabel(ep.pubDate),
  sizeMb: Math.round((ep.sizeBytes || ep.duration * 16000) / 1048576),
});

export interface EpisodeMeta {
  chapters?: Chapter[];
  /** undefined while loading, null when there is none. */
  transcript?: TranscriptLine[] | null;
  /** False for HTML or plain-text transcripts without timestamps. */
  transcriptTimed?: boolean;
}

export const chaptersFor = (ep: EpisodeInfo, meta?: EpisodeMeta): Chapter[] =>
  meta?.chapters?.length ? meta.chapters : ep.ep.inlineChapters?.length ? ep.ep.inlineChapters : [{ t: 'Full episode', at: 0 }];
