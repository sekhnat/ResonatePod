import { platform } from '../../platform';
import * as apple from './apple';
import * as fyyd from './fyyd';
import * as gpodder from './gpodder';
import * as podcastindex from './podcastindex';
import type { PodcastIndexKey } from './podcastindex';
import type { DirectoryResult, Source } from './types';

export type { DirectoryResult, Source } from './types';
export type { PodcastIndexKey } from './podcastindex';
export { appleId } from './apple';
export { toResult as gpodderResult } from './gpodder';

export type SourceChoice = 'all' | Source;

export const SOURCES: Record<Source, { label: string; short: string; weight: number }> = {
  apple: { label: 'Apple Podcasts', short: 'Apple', weight: 1 },
  podcastindex: { label: 'Podcast Index', short: 'PI', weight: 1 },
  gpodder: { label: 'gpodder.net', short: 'gpodder', weight: 0.8 },
  fyyd: { label: 'fyyd', short: 'fyyd', weight: 0.8 },
};

const TIMEOUT_MS = 8000;

/** Apple storefronts offered in the Region menu. */
export const COUNTRIES = [
  'us', 'gb', 'ca', 'au', 'nz', 'ie', 'in', 'za', 'de', 'at', 'ch', 'fr', 'be', 'nl', 'lu', 'es', 'pt', 'it', 'se', 'no', 'dk',
  'fi', 'is', 'pl', 'cz', 'sk', 'hu', 'ro', 'gr', 'tr', 'il', 'ae', 'sa', 'eg', 'br', 'mx', 'ar', 'cl', 'co', 'pe', 'jp', 'kr',
  'tw', 'hk', 'sg', 'my', 'th', 'id', 'ph', 'vn', 'ua',
];

export function defaultCountry(lang = typeof navigator !== 'undefined' ? navigator.language : 'en-US') {
  const cc = /[-_]([a-z]{2})$/i.exec(lang)?.[1]?.toLowerCase();
  return cc && COUNTRIES.includes(cc) ? cc : 'us';
}

export function countryName(cc: string) {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc.toUpperCase()) ?? cc.toUpperCase(); } catch { return cc.toUpperCase(); }
}

/** Feed URLs that differ only by scheme, `www.`, host case or a trailing slash are the same feed. */
export function normalizeFeedUrl(url: string) {
  try {
    const u = new URL(url.trim());
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.port ? `:${u.port}` : ''}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

const withTimeout = <T>(p: Promise<T>, ms = TIMEOUT_MS) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);

export async function podcastIndexKey(): Promise<PodcastIndexKey | null> {
  const raw = await platform.getSecret('podcastindex').catch(() => null);
  if (!raw) return null;
  try {
    const k = JSON.parse(raw) as PodcastIndexKey;
    return k.key && k.secret ? k : null;
  } catch {
    return null;
  }
}

/**
 * Merges ranked lists the way AntennaPod's CombinedSearcher does: each result scores
 * weight / (position + 1) per directory that returned it, summed by feed URL.
 */
export function mergeRanked(lists: { source: Source; results: DirectoryResult[] }[]): DirectoryResult[] {
  const byUrl = new Map<string, { r: DirectoryResult; score: number }>();
  for (const { source, results } of lists) {
    const w = SOURCES[source].weight;
    results.forEach((r, i) => {
      const key = normalizeFeedUrl(r.feedUrl);
      const cur = byUrl.get(key);
      if (!cur) { byUrl.set(key, { r: { ...r, sources: [...r.sources] }, score: w / (i + 1) }); return; }
      cur.score += w / (i + 1);
      // Keep the first directory's record (callers pass the most trusted first); fill its gaps from the others.
      const k = cur.r;
      cur.r = {
        ...k,
        sources: [...k.sources, ...r.sources.filter((s) => !k.sources.includes(s))],
        artworkUrl: k.artworkUrl ?? r.artworkUrl,
        author: k.author || r.author,
        blurb: k.blurb || r.blurb,
        subscribers: k.subscribers ?? r.subscribers,
        episodeCount: k.episodeCount ?? r.episodeCount,
        genre: k.genre !== 'Podcast' ? k.genre : r.genre,
      };
    });
  }
  return [...byUrl.values()].sort((a, b) => b.score - a.score).map((x) => x.r);
}

export interface SearchOutcome {
  results: DirectoryResult[];
  /** Episode matches (Apple only). */
  episodes: DirectoryResult[];
  answered: Source[];
  failed: { source: Source; message: string }[];
}

export interface SearchOptions { country: string; genre?: string; source: SourceChoice }

/** Searches one directory, or all of them at once (only those that can answer: Podcast Index needs a key). */
export async function searchDirectories(term: string, opts: SearchOptions): Promise<SearchOutcome> {
  const piKey = opts.source === 'all' || opts.source === 'podcastindex' ? await podcastIndexKey() : null;
  const runners: Record<Source, () => Promise<DirectoryResult[]>> = {
    apple: () => apple.search(term, { country: opts.country, genre: opts.genre }),
    gpodder: () => gpodder.search(term),
    fyyd: () => fyyd.search(term),
    podcastindex: () => (piKey ? podcastindex.search(term, piKey) : Promise.reject(new Error('add an API key in Preferences'))),
  };
  const chosen: Source[] = opts.source === 'all' ? (['apple', 'podcastindex', 'gpodder', 'fyyd'] as Source[]).filter((s) => s !== 'podcastindex' || piKey) : [opts.source];
  const wantEpisodes = opts.source === 'all' || opts.source === 'apple';
  const [settled, eps] = await Promise.all([
    Promise.allSettled(chosen.map((s) => withTimeout(runners[s]()))),
    wantEpisodes ? withTimeout(apple.episodes(term, { country: opts.country })).catch(() => []) : Promise.resolve([]),
  ]);
  const lists: { source: Source; results: DirectoryResult[] }[] = [];
  const failed: SearchOutcome['failed'] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') lists.push({ source: chosen[i], results: r.value });
    else failed.push({ source: chosen[i], message: (r.reason as Error)?.message ?? 'failed' });
  });
  return { results: mergeRanked(lists), episodes: eps, answered: lists.map((l) => l.source), failed };
}

/** Browsing without a search: Apple's chart for the region, or gpodder.net's most subscribed. */
export function browse(opts: SearchOptions): Promise<DirectoryResult[]> {
  return opts.source === 'gpodder' ? gpodder.top(opts.genre) : apple.top(opts.country, opts.genre);
}

export interface Suggestions { results: DirectoryResult[]; sources: string[] }

/**
 * What AntennaPod suggests (Apple's top chart for your region, minus shows you follow),
 * led by gpodder.net's personal picks when sync is connected.
 */
export async function suggestions(opts: {
  country: string;
  subscribed: { feedUrl: string; title: string }[];
  personal?: () => Promise<DirectoryResult[]>;
  limit?: number;
}): Promise<Suggestions> {
  const followedUrls = new Set(opts.subscribed.map((s) => normalizeFeedUrl(s.feedUrl)));
  const followedTitles = new Set(opts.subscribed.map((s) => s.title.trim().toLowerCase()));
  const [chart, personal] = await Promise.all([
    withTimeout(apple.top(opts.country, undefined, 25)).catch(() => null),
    opts.personal ? withTimeout(opts.personal()).catch(() => null) : Promise.resolve(null),
  ]);
  if (!chart && !personal?.length) throw new Error('Couldn’t reach the podcast directories');
  const sources = [...(personal?.length ? ['your gpodder.net account'] : []), ...(chart ? [`Apple top chart · ${countryName(opts.country)}`] : [])];
  const seen = new Set<string>();
  const results = [...(personal ?? []), ...(chart ?? [])].filter((r) => {
    const key = normalizeFeedUrl(r.feedUrl);
    if (seen.has(key) || followedUrls.has(key) || followedTitles.has(r.title.trim().toLowerCase())) return false;
    seen.add(key);
    return true;
  });
  return { results: results.slice(0, opts.limit ?? 12), sources };
}

/** Apple Podcasts page links become the show's feed; anything else passes through. */
export async function resolveFeedUrl(url: string): Promise<string> {
  return apple.appleId(url) ? apple.lookupFeed(url) : url;
}
