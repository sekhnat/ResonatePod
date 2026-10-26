import type { GpodderPodcast } from '../../../shared/gpodder';
import { firstSentence, getJson, type DirectoryResult } from './types';

/** gpodder.net's public directory: https://gpoddernet.readthedocs.io/en/latest/api/reference/directory.html */

const BASE = 'https://gpodder.net';
const LABEL = 'gpodder.net';

/** Discover's category chips as gpodder.net tags. */
export const TAGS: Record<string, string | undefined> = {
  Popular: undefined, Technology: 'technology', Science: 'science', History: 'history', Arts: 'arts', Society: 'society', Books: 'books',
};

export const toResult = (p: GpodderPodcast, genre = 'Podcast'): DirectoryResult | null =>
  p.url
    ? {
        id: `gpodder:${p.url}`,
        title: p.title || p.url,
        author: p.author ?? '',
        artworkUrl: p.scaled_logo_url || p.logo_url || undefined,
        feedUrl: p.url,
        genre,
        blurb: firstSentence(p.description ?? ''),
        sources: ['gpodder'],
        subscribers: p.subscribers,
      }
    : null;

const results = (list: GpodderPodcast[], genre?: string) => list.map((p) => toResult(p, genre)).filter((r): r is DirectoryResult => !!r);

export async function search(term: string): Promise<DirectoryResult[]> {
  return results(await getJson<GpodderPodcast[]>(`${BASE}/search.json?q=${encodeURIComponent(term)}`, LABEL));
}

/** The most-subscribed podcasts on gpodder.net, overall or for a category. */
export async function top(genre?: string, limit = 50): Promise<DirectoryResult[]> {
  const tag = genre ? TAGS[genre] : undefined;
  const url = tag ? `${BASE}/api/2/tag/${encodeURIComponent(tag)}/${limit}.json` : `${BASE}/toplist/${limit}.json`;
  return results(await getJson<GpodderPodcast[]>(url, LABEL), tag ? genre : undefined);
}
