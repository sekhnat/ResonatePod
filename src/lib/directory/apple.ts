import { DirectoryError, firstSentence, getJson, type DirectoryResult } from './types';

/**
 * Apple Podcasts through the iTunes Search API (no key needed):
 * https://performance-partners.apple.com/search-api
 */

const BASE = 'https://itunes.apple.com';
const LABEL = 'Apple Podcasts';

export const GENRES: Record<string, number | undefined> = {
  Popular: undefined, Technology: 1318, Science: 1533, History: 1487, Arts: 1301, Society: 1324, Books: 1482,
};

interface ItunesPodcast {
  collectionId: number;
  collectionName: string;
  artistName?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  feedUrl?: string;
  primaryGenreName?: string;
  trackCount?: number;
}

interface ItunesEpisode {
  trackId: number;
  trackName: string;
  collectionId: number;
  collectionName: string;
  artistName?: string;
  feedUrl?: string;
  artworkUrl600?: string;
  artworkUrl160?: string;
  releaseDate?: string;
  description?: string;
}

const toResult = (p: ItunesPodcast, blurb?: string): DirectoryResult | null =>
  p.feedUrl
    ? {
        id: `apple:${p.collectionId}`,
        title: p.collectionName,
        author: p.artistName ?? '',
        artworkUrl: p.artworkUrl600 ?? p.artworkUrl100,
        feedUrl: p.feedUrl,
        genre: p.primaryGenreName ?? 'Podcast',
        blurb: blurb || p.artistName || '',
        sources: ['apple'],
        episodeCount: p.trackCount,
      }
    : null;

const notNull = <T>(x: T | null | undefined): x is T => x != null;
const genreParam = (genre?: string) => (genre && GENRES[genre] ? `&genreId=${GENRES[genre]}` : '');

export async function search(term: string, opts: { country: string; genre?: string; limit?: number }): Promise<DirectoryResult[]> {
  const url = `${BASE}/search?media=podcast&entity=podcast&limit=${opts.limit ?? 50}&country=${opts.country}&term=${encodeURIComponent(term)}${genreParam(opts.genre)}`;
  const data = await getJson<{ results: ItunesPodcast[] }>(url, LABEL);
  return data.results.map((p) => toResult(p)).filter(notNull);
}

/** Episodes whose title or notes match; each result is the episode's show. */
export async function episodes(term: string, opts: { country: string; limit?: number }): Promise<DirectoryResult[]> {
  const url = `${BASE}/search?media=podcast&entity=podcastEpisode&limit=${opts.limit ?? 10}&country=${opts.country}&term=${encodeURIComponent(term)}`;
  const data = await getJson<{ results: ItunesEpisode[] }>(url, LABEL);
  return data.results
    .filter((e) => e.feedUrl)
    .map((e) => ({
      id: `apple-ep:${e.trackId}`,
      title: e.collectionName,
      author: e.artistName ?? '',
      artworkUrl: e.artworkUrl600 ?? e.artworkUrl160,
      feedUrl: e.feedUrl!,
      genre: 'Episode',
      blurb: firstSentence(e.description ?? ''),
      sources: ['apple'],
      episode: { title: e.trackName, date: e.releaseDate ? Date.parse(e.releaseDate) || 0 : 0 },
    }));
}

interface ChartEntry { id: { attributes: { 'im:id': string } }; summary?: { label: string } }

/** The top podcasts chart for a country (the list AntennaPod suggests from), overall or for one genre. */
export async function top(country: string, genre?: string, limit = 30): Promise<DirectoryResult[]> {
  const g = genre ? GENRES[genre] : undefined;
  const chart = await getJson<{ feed: { entry?: ChartEntry[] | ChartEntry } }>(
    `${BASE}/${country}/rss/toppodcasts/limit=${limit}${g ? `/genre=${g}` : ''}/explicit=true/json`, LABEL);
  // A chart with one entry comes back as an object, not an array.
  const raw = chart.feed.entry;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!entries.length) return [];
  const blurbs = new Map(entries.map((e) => [e.id.attributes['im:id'], e.summary?.label ?? '']));
  const ids = entries.map((e) => e.id.attributes['im:id']);
  const data = await getJson<{ results: ItunesPodcast[] }>(`${BASE}/lookup?entity=podcast&country=${country}&id=${ids.join(',')}`, LABEL);
  const byId = new Map(data.results.map((p) => [String(p.collectionId), p]));
  return ids
    .map((id) => byId.get(id))
    .map((p) => p && toResult(p, firstSentence(blurbs.get(String(p.collectionId)) ?? '')))
    .filter(notNull);
}

/** The show id in an Apple Podcasts page link, e.g. https://podcasts.apple.com/gb/podcast/name/id123456. */
export function appleId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (!/(^|\.)(podcasts|itunes)\.apple\.com$/.test(u.hostname)) return null;
    return /\/id(\d+)/.exec(u.pathname)?.[1] ?? u.searchParams.get('id') ?? null;
  } catch {
    return null;
  }
}

/** Turns an Apple Podcasts link into the show's RSS feed. */
export async function lookupFeed(url: string): Promise<string> {
  const id = appleId(url);
  if (!id) throw new DirectoryError('That isn’t an Apple Podcasts link');
  const data = await getJson<{ results: ItunesPodcast[] }>(`${BASE}/lookup?id=${id}&entity=podcast`, LABEL);
  const p = data.results[0];
  if (!p) throw new DirectoryError('Apple Podcasts doesn’t know that show');
  if (!p.feedUrl) throw new DirectoryError(`${p.collectionName} has no public feed (it may be Apple-exclusive)`);
  return p.feedUrl;
}
