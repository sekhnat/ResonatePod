import { firstSentence, getJson, type DirectoryResult } from './types';

/**
 * Podcast Index search (https://podcastindex-org.github.io/docs-api/). Needs a free
 * API key and secret from https://api.podcastindex.org, entered in Preferences.
 */

const BASE = 'https://api.podcastindex.org/api/1.0';

export interface PodcastIndexKey { key: string; secret: string }

interface PiFeed {
  id: number;
  title: string;
  url?: string;
  author?: string;
  description?: string;
  image?: string;
  artwork?: string;
  episodeCount?: number;
  categories?: Record<string, string> | null;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The request headers Podcast Index expects: Authorization is sha1(key + secret + unix time). */
export async function authHeaders(k: PodcastIndexKey, now = Date.now()): Promise<Record<string, string>> {
  const time = String(Math.floor(now / 1000));
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(k.key + k.secret + time));
  return { 'X-Auth-Date': time, 'X-Auth-Key': k.key, Authorization: hex(digest) };
}

export async function search(term: string, k: PodcastIndexKey, limit = 30, signal?: AbortSignal): Promise<DirectoryResult[]> {
  const data = await getJson<{ feeds?: PiFeed[] }>(`${BASE}/search/byterm?q=${encodeURIComponent(term)}&max=${limit}`, 'Podcast Index', await authHeaders(k), signal);
  return (data.feeds ?? [])
    .filter((f) => f.url)
    .map((f) => ({
      id: `podcastindex:${f.id}`,
      title: f.title,
      author: f.author ?? '',
      artworkUrl: f.artwork || f.image || undefined,
      feedUrl: f.url!,
      genre: Object.values(f.categories ?? {})[0] ?? 'Podcast',
      blurb: firstSentence(f.description ?? ''),
      sources: ['podcastindex'],
      episodeCount: f.episodeCount,
    }));
}
