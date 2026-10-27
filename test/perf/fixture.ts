// Synthetic libraries and feeds for the performance benchmarks and budgets.
import { epKey, type Show } from '../../src/data';
import { useStore, type EpState, type State } from '../../src/store';

const NOTES = 'Show notes for this episode, with the usual links, sponsor reads and a long list of timestamps. ';
/** About `bytes` of plain text that differs per episode. */
const notes = (bytes: number, seed: number) => (`#${seed} ${NOTES}`).repeat(Math.ceil(bytes / NOTES.length)).slice(0, bytes);

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 26);

export function makeShow(n: number, episodes: number, notesBytes = 2048): Show {
  const id = `show-${n}`;
  return {
    id, title: `Stress Show ${n}`, author: `Author ${n}`, hue: (n * 37) % 360, cat: 'Technology', freq: 'Weekly', desc: 'A synthetic show.',
    feedUrl: `https://stress.example/${id}.xml`, subscribedAt: NOW - 400 * DAY,
    eps: Array.from({ length: episodes }, (_, i) => ({
      guid: `${id}-ep-${i}`, title: `Episode ${episodes - i}: a reasonably long title about topic ${i % 97}`, pubDate: NOW - i * 3 * DAY,
      duration: 1800 + (i % 40) * 60, enclosureUrl: `https://cdn.example/${id}/${i}.mp3`, enclosureType: 'audio/mpeg', sizeBytes: 30_000_000 + i * 1000,
      description: notes(notesBytes, i),
    })),
  };
}

/** `shows` × `episodes`, with the library's usual state: a couple of new episodes per show, most of the rest played. */
export function makeLibrary({ shows = 20, episodes = 2000, notesBytes = 2048 } = {}) {
  const list = Array.from({ length: shows }, (_, i) => makeShow(i, episodes, notesBytes));
  const eps: Record<string, EpState> = {};
  for (const sh of list) sh.eps.forEach((e, i) => { eps[epKey(sh.id, e.guid)] = { played: i > 2 && i % 3 !== 0, pos: 0, inbox: i < 2 }; });
  return { shows: list, eps };
}

/** The store's state with a synthetic library in it, without going through set() (which would queue a save). */
export const stateWith = (lib: ReturnType<typeof makeLibrary>) => ({ ...useStore.getState(), ...lib }) as State;

/** An RSS document of about `episodes` × (`notesBytes` + 400) bytes. */
export function makeFeedXml(episodes: number, notesBytes = 2048): string {
  const items = Array.from({ length: episodes }, (_, i) => `<item><title>Episode ${episodes - i}</title><guid isPermaLink="false">ep-${i}</guid><pubDate>${new Date(NOW - i * 3 * DAY).toUTCString()}</pubDate>`
    + `<description><![CDATA[<p>${notes(notesBytes, i)}</p>]]></description><itunes:duration>${1800 + (i % 40) * 60}</itunes:duration>`
    + `<enclosure url="https://cdn.example/${i}.mp3" length="${30_000_000 + i}" type="audio/mpeg"/></item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Big Feed</title>`
    + `<itunes:author>Stress</itunes:author><description>Synthetic.</description>\n${items}\n</channel></rss>`;
}

/** Mean milliseconds per call, after a warm-up. */
export function measure(fn: () => unknown, runs = 5): number {
  fn();
  const start = performance.now();
  for (let i = 0; i < runs; i++) fn();
  return (performance.now() - start) / runs;
}
