import { platform } from '../platform';

/** Apple Podcasts directory: free, no API key. */

export interface DirectoryResult {
  id: string;
  title: string;
  author: string;
  artworkUrl?: string;
  feedUrl: string;
  genre: string;
  blurb: string;
}

export const GENRES: Record<string, number | undefined> = {
  Popular: undefined, Technology: 1318, Science: 1533, History: 1487, Arts: 1301, Society: 1324, Books: 1482,
};

interface ItunesPodcast {
  collectionId: number;
  collectionName: string;
  artistName: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  feedUrl?: string;
  primaryGenreName?: string;
  trackCount?: number;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await platform.http(url);
  if (res.status !== 200) throw new Error(`directory responded with HTTP ${res.status}`);
  return JSON.parse(res.text) as T;
}

const toResult = (p: ItunesPodcast, blurb?: string): DirectoryResult | null =>
  p.feedUrl
    ? {
        id: String(p.collectionId),
        title: p.collectionName,
        author: p.artistName,
        artworkUrl: p.artworkUrl600 ?? p.artworkUrl100,
        feedUrl: p.feedUrl,
        genre: p.primaryGenreName ?? 'Podcast',
        blurb: blurb || `${p.artistName}${p.trackCount ? ` · ${p.trackCount} episodes` : ''}`,
      }
    : null;

export async function searchDirectory(term: string, genre?: string): Promise<DirectoryResult[]> {
  const g = genre ? GENRES[genre] : undefined;
  const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=30&term=${encodeURIComponent(term)}${g ? `&genreId=${g}` : ''}`;
  const data = await getJson<{ results: ItunesPodcast[] }>(url);
  return data.results.map((p) => toResult(p)).filter((r): r is DirectoryResult => !!r);
}

interface ChartEntry { id: { attributes: { 'im:id': string } }; summary?: { label: string } }

/** Top podcasts, overall or for one genre: chart ids, then one lookup call for feed URLs. */
export async function topPodcasts(genre?: string): Promise<DirectoryResult[]> {
  const g = genre ? GENRES[genre] : undefined;
  const chart = await getJson<{ feed: { entry?: ChartEntry[] } }>(`https://itunes.apple.com/us/rss/toppodcasts/limit=30${g ? `/genre=${g}` : ''}/json`);
  const entries = chart.feed.entry ?? [];
  if (!entries.length) return [];
  const blurbs = new Map(entries.map((e) => [e.id.attributes['im:id'], e.summary?.label ?? '']));
  const ids = entries.map((e) => e.id.attributes['im:id']);
  const data = await getJson<{ results: ItunesPodcast[] }>(`https://itunes.apple.com/lookup?entity=podcast&id=${ids.join(',')}`);
  const byId = new Map(data.results.map((p) => [String(p.collectionId), p]));
  return ids
    .map((id) => byId.get(id))
    .map((p) => p && toResult(p, firstSentence(blurbs.get(String(p.collectionId)) ?? '')))
    .filter((r): r is DirectoryResult => !!r);
}

const firstSentence = (s: string) => {
  const m = /^(.{20,160}?[.!?])\s/.exec(s.replace(/\s+/g, ' ').trim());
  return m ? m[1] : s.slice(0, 140);
};
