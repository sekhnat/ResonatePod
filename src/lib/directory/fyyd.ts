import { firstSentence, getJson, type DirectoryResult } from './types';

/** fyyd.de podcast search (no key needed), as used by AntennaPod. */

const BASE = 'https://api.fyyd.de/0.2';

interface FyydPodcast {
  id: number;
  title: string;
  xmlURL?: string;
  author?: string;
  description?: string;
  thumbImageURL?: string;
  imgURL?: string;
  episode_count?: number;
  categories?: number[];
}

export async function search(term: string, limit = 30): Promise<DirectoryResult[]> {
  const data = await getJson<{ data?: FyydPodcast[] }>(`${BASE}/search/podcast?title=${encodeURIComponent(term)}&count=${limit}`, 'fyyd');
  return (data.data ?? [])
    .filter((p) => p.xmlURL)
    .map((p) => ({
      id: `fyyd:${p.id}`,
      title: p.title,
      author: p.author ?? '',
      artworkUrl: p.imgURL || p.thumbImageURL || undefined,
      feedUrl: p.xmlURL!,
      genre: 'Podcast',
      blurb: firstSentence(p.description ?? ''),
      sources: ['fyyd'],
      episodeCount: p.episode_count,
    }));
}
