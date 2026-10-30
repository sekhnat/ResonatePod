import { XMLParser } from 'fast-xml-parser';
import { plainText } from './plain-text';
import type { Chapter, Episode, Feed, Funding, License, Person, Soundbite } from './types';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ['item', 'podcast:transcript', 'psc:chapter', 'itunes:category', 'enclosure', 'link', 'podcast:person', 'podcast:funding', 'podcast:soundbite'].includes(name),
});

type Node = Record<string, unknown> | string | undefined;

const text = (n: unknown): string => {
  if (n == null) return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return text(n[0]);
  if (typeof n === 'object') return text((n as Record<string, unknown>)['#text']);
  return '';
};
const attr = (n: unknown, name: string): string => {
  const o = Array.isArray(n) ? n[0] : n;
  return o && typeof o === 'object' ? text((o as Record<string, unknown>)[`@_${name}`]) : '';
};

/** "1:02:03", "62:03", "3723" or "3723.5" → seconds. */
export function parseDuration(s: string): number {
  const v = s.trim();
  if (!v) return 0;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(parseFloat(v));
  const parts = v.split(':').map((p) => parseFloat(p));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  return Math.round(parts.reduce((a, p) => a * 60 + p, 0));
}

/** Podlove "start" values: "00:01:02.500" or "62.5". */
const parseNpt = (s: string) => {
  const [main] = s.split('.');
  const frac = s.includes('.') ? parseFloat('0.' + s.split('.').pop()) : 0;
  return parseDuration(main) + frac;
};

/** Only web addresses: a link or picture from a feed is opened or loaded, and nothing else should be. */
const httpUrl = (s: string): string | undefined => (/^https?:\/\/\S+$/i.test(s) ? s : undefined);

const list = (n: unknown): unknown[] => (Array.isArray(n) ? n : n == null ? [] : [n]);

/** A number from a tag's text ("3", "12.5"); undefined for anything else. */
const num = (n: unknown): number | undefined => {
  const s = text(n).trim();
  return /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : undefined;
};

/** `podcast:person` tags; undefined when there are none. */
function persons(n: unknown): Person[] | undefined {
  const out: Person[] = [];
  for (const p of list(n).slice(0, 30)) {
    const name = text(p).trim();
    if (!name) continue;
    const person: Person = { name, role: attr(p, 'role').trim().toLowerCase() || 'host', group: attr(p, 'group').trim().toLowerCase() || 'cast' };
    const img = httpUrl(attr(p, 'img'));
    const href = httpUrl(attr(p, 'href'));
    if (img) person.img = img;
    if (href) person.href = href;
    out.push(person);
  }
  return out.length ? out : undefined;
}

function funding(n: unknown): Funding[] | undefined {
  const out = list(n).flatMap((f) => {
    const url = httpUrl(attr(f, 'url'));
    return url ? [{ url, label: text(f).trim() || 'Support the show' }] : [];
  });
  return out.length ? out : undefined;
}

function soundbites(n: unknown): Soundbite[] | undefined {
  const out = list(n).flatMap((b) => {
    const at = parseFloat(attr(b, 'startTime'));
    const dur = parseFloat(attr(b, 'duration'));
    return Number.isFinite(at) && at >= 0 && Number.isFinite(dur) && dur > 0 ? [{ at, dur, title: text(b).trim() }] : [];
  });
  return out.length ? out.sort((a, b) => a.at - b.at) : undefined;
}

function license(n: unknown): License | undefined {
  const name = text(n).trim();
  if (!name) return undefined;
  const url = httpUrl(attr(n, 'url'));
  return url ? { name, url } : { name };
}

/** The Podcasting 2.0 fields of an item, with only those it has. */
function itemExtras(it: Record<string, unknown>): Partial<Episode> {
  const out: Partial<Episode> = {};
  const season = num(it['podcast:season']) ?? num(it['itunes:season']);
  const epNum = num(it['podcast:episode']) ?? num(it['itunes:episode']);
  const type = text(it['itunes:episodeType']).trim().toLowerCase();
  const people = persons(it['podcast:person']);
  const bites = soundbites(it['podcast:soundbite']);
  const location = text(it['podcast:location']).trim();
  if (season !== undefined) out.season = season;
  if (epNum !== undefined) out.epNum = epNum;
  if (type === 'trailer' || type === 'bonus') out.episodeType = type;
  if (people) out.persons = people;
  if (bites) out.soundbites = bites;
  if (location) out.location = location;
  return out;
}

const TRANSCRIPT_PREF =['text/vtt', 'application/x-subrip', 'application/srt', 'application/json', 'text/html', 'text/plain'];

function parseItem(it: Record<string, unknown>): Episode | null {
  const enc = (it.enclosure as unknown[] | undefined)?.[0];
  const url = attr(enc, 'url');
  if (!url) return null;
  const title = text(it.title) || 'Untitled episode';
  const guid = text(it.guid) || url;
  const date = Date.parse(text(it.pubDate));
  const transcripts = ((it['podcast:transcript'] as unknown[]) ?? [])
    .map((t) => ({ url: attr(t, 'url'), type: attr(t, 'type') }))
    .filter((t) => t.url)
    .sort((a, b) => rank(a.type) - rank(b.type));
  const psc = ((it['psc:chapters'] as Record<string, unknown> | undefined)?.['psc:chapter'] as unknown[]) ?? [];
  const inline: Chapter[] = psc.map((c) => ({ t: attr(c, 'title') || 'Chapter', at: parseNpt(attr(c, 'start')) })).sort((a, b) => a.at - b.at);
  return {
    guid,
    title,
    pubDate: Number.isNaN(date) ? 0 : date,
    duration: parseDuration(text(it['itunes:duration'])),
    enclosureUrl: url,
    enclosureType: attr(enc, 'type') || 'audio/mpeg',
    sizeBytes: parseInt(attr(enc, 'length'), 10) || 0,
    description: plainText(text(it['content:encoded']) || text(it.description) || text(it['itunes:summary'])),
    link: text(it.link) || undefined,
    imageUrl: attr(it['itunes:image'], 'href') || undefined,
    chaptersUrl: attr(it['podcast:chapters'], 'url') || undefined,
    transcriptUrl: transcripts[0]?.url,
    transcriptType: transcripts[0]?.type,
    inlineChapters: inline.length ? inline : undefined,
    ...itemExtras(it),
  };
}

const rank = (type: string) => {
  const i = TRANSCRIPT_PREF.indexOf(type);
  return i < 0 ? TRANSCRIPT_PREF.length : i;
};

// The parser never throws on bad XML: a feed cut off mid-download would parse as a shorter one. A separate
// validation pass cost a third of parsing a big feed, so only check that the document ends where an RSS one does.
const ENDS_LIKE_RSS = /<\/rss\s*>(?:\s|<!--[\s\S]*?-->)*$/i;

export function parseFeed(xml: string): Feed {
  let doc: Record<string, Node>;
  try { doc = parser.parse(xml) as Record<string, Node>; } catch { throw new Error('The feed is not valid XML'); }
  const rss = doc.rss as Record<string, unknown> | string | undefined;
  if (!rss || typeof rss !== 'object') throw new Error('Not a podcast RSS feed');
  if (!ENDS_LIKE_RSS.test(xml.slice(-2048))) throw new Error('The feed is not valid XML');
  const ch = rss.channel as Record<string, unknown> | undefined;
  if (!ch) throw new Error('Not a podcast RSS feed');
  const episodes = ((ch.item as Record<string, unknown>[]) ?? [])
    .map(parseItem)
    .filter((e): e is Episode => !!e)
    .sort((a, b) => b.pubDate - a.pubDate);
  const links = (ch.link as unknown[]) ?? [];
  const link = links.map(text).find((l) => /^https?:/.test(l));
  const moved = text(ch['itunes:new-feed-url']);
  const extras: Partial<Feed> = {};
  const people = persons(ch['podcast:person']);
  const fund = funding(ch['podcast:funding']);
  const location = text(ch['podcast:location']).trim();
  const lic = license(ch['podcast:license']);
  const podcastGuid = text(ch['podcast:guid']).trim();
  if (people) extras.persons = people;
  if (fund) extras.funding = fund;
  if (location) extras.location = location;
  if (lic) extras.license = lic;
  if (podcastGuid) extras.podcastGuid = podcastGuid;
  return {
    title: text(ch.title) || 'Untitled podcast',
    author: text(ch['itunes:author']) || text((ch['itunes:owner'] as Record<string, unknown>)?.['itunes:name']) || text(ch.managingEditor) || '',
    description: plainText(text(ch.description) || text(ch['itunes:summary'])),
    imageUrl: attr(ch['itunes:image'], 'href') || text((ch.image as Record<string, unknown>)?.url) || undefined,
    link,
    category: attr(ch['itunes:category'], 'text') || 'Podcast',
    newFeedUrl: /^https?:\/\//.test(moved) ? moved : undefined,
    ...extras,
    episodes,
  };
}

export { cadence } from './cadence';
export { plainText } from './plain-text';
