import { platform } from '../../platform';

export type Source = 'apple' | 'gpodder' | 'fyyd' | 'podcastindex';

export interface DirectoryResult {
  id: string;
  title: string;
  author: string;
  artworkUrl?: string;
  feedUrl: string;
  genre: string;
  /** One line under the title. */
  blurb: string;
  /** Directories that returned this show (several after a combined search). */
  sources: Source[];
  subscribers?: number;
  episodeCount?: number;
  /** Set for episode search results: the matching episode in this show. */
  episode?: { title: string; date: number };
}

export class DirectoryError extends Error {}

export async function getJson<T>(url: string, label: string, headers?: Record<string, string>): Promise<T> {
  const res = await platform.http(url, headers ? { headers } : undefined);
  if (res.status !== 200) throw new DirectoryError(`${label} responded with HTTP ${res.status}`);
  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new DirectoryError(`${label} sent an unreadable response`);
  }
}

/** One line from a long description. */
export const firstSentence = (s: string) => {
  const t = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(.{20,160}?[.!?])\s/.exec(t);
  return m ? m[1] : t.length > 140 ? t.slice(0, 139) + '…' : t;
};
