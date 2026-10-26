import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { platform } from '../../platform';
import * as apple from './apple';
import * as gpodder from './gpodder';
import * as fyyd from './fyyd';
import * as podcastindex from './podcastindex';
import { defaultCountry, mergeRanked, normalizeFeedUrl, resolveFeedUrl, searchDirectories, suggestions } from './index';

const fx = (name: string) => readFileSync(`test/fixtures/directory/${name}.json`, 'utf8');
const ROUTES: [RegExp, string][] = [
  [/itunes\.apple\.com\/search\?.*entity=podcastEpisode/, 'apple-episodes'],
  [/itunes\.apple\.com\/search\?/, 'apple-search'],
  [/itunes\.apple\.com\/us\/rss\/toppodcasts/, 'apple-chart-us'],
  [/itunes\.apple\.com\/gb\/rss\/toppodcasts/, 'apple-chart-gb'],
  [/itunes\.apple\.com\/lookup\?/, 'apple-lookup'],
  [/gpodder\.net\/search\.json/, 'gpodder-search'],
  [/gpodder\.net\/toplist\/50\.json/, 'gpodder-toplist'],
  [/gpodder\.net\/api\/2\/tag\/technology\/50\.json/, 'gpodder-tag-technology'],
  [/api\.fyyd\.de\/0\.2\/search\/podcast/, 'fyyd-search'],
  [/api\.podcastindex\.org\/api\/1\.0\/search\/byterm/, 'podcastindex-search'],
];

const http = vi.spyOn(platform, 'http');
const down = new Set<string>();
const PI_KEY = { key: 'KEY123', secret: 'SECRET456' };
let secret: string | null = null;

beforeEach(() => {
  down.clear();
  secret = null;
  http.mockReset();
  http.mockImplementation(async (url) => {
    if ([...down].some((d) => url.includes(d))) return { status: 503, text: '' };
    const hit = ROUTES.find(([re]) => re.test(url));
    return hit ? { status: 200, text: fx(hit[1]) } : { status: 404, text: '' };
  });
  vi.spyOn(platform, 'getSecret').mockImplementation(async (k) => (k === 'podcastindex' ? secret : null));
});
afterEach(() => { vi.mocked(platform.getSecret).mockRestore(); });

const titles = (rs: { title: string }[]) => rs.map((r) => r.title);

describe('Apple Podcasts', () => {
  it('searches in the chosen storefront and skips shows without a feed', async () => {
    const rs = await apple.search('linux', { country: 'gb', genre: 'Technology' });
    expect(http.mock.calls[0][0]).toBe('https://itunes.apple.com/search?media=podcast&entity=podcast&limit=50&country=gb&term=linux&genreId=1318');
    expect(titles(rs)).toEqual(['LINUX Unplugged', 'Late Night Linux', 'Kernel Panic Hour']);
    expect(rs[0]).toMatchObject({ feedUrl: 'https://feeds.example/linux-unplugged.xml', sources: ['apple'], episodeCount: 580, artworkUrl: 'https://feeds.example/art/linux-unplugged-600.jpg' });
  });

  it('reads the regional top chart, including a one-entry chart', async () => {
    const us = await apple.top('us');
    expect(http.mock.calls[0][0]).toBe('https://itunes.apple.com/us/rss/toppodcasts/limit=30/explicit=true/json');
    expect(titles(us)).toEqual(['Daily Bytes', 'Kernel Panic Hour', 'Deep Field']);
    expect(us[0].blurb).toBe('The tech news you need, every weekday morning.');
    expect(titles(await apple.top('gb'))).toEqual(['The Allotment Hour']);
  });

  it('finds episodes and reports their show', async () => {
    const [e] = await apple.episodes('wayland', { country: 'us' });
    expect(e).toMatchObject({ title: 'Kernel Panic Hour', feedUrl: 'https://feeds.example/kernel-panic.xml', episode: { title: 'Wayland, five years on', date: Date.parse('2026-10-19T06:00:00Z') } });
  });

  it('turns Apple Podcasts links into feed URLs', async () => {
    expect(apple.appleId('https://podcasts.apple.com/gb/podcast/kernel-panic-hour/id1004?i=1000')).toBe('1004');
    expect(apple.appleId('https://itunes.apple.com/lookup?id=1004')).toBe('1004');
    expect(apple.appleId('https://example.com/id1004')).toBeNull();
    http.mockImplementationOnce(async () => ({ status: 200, text: JSON.stringify({ results: [JSON.parse(fx('apple-lookup')).results[1]] }) }));
    expect(await resolveFeedUrl('https://podcasts.apple.com/gb/podcast/kernel-panic-hour/id1004')).toBe('https://feeds.example/kernel-panic.xml');
    http.mockImplementationOnce(async () => ({ status: 200, text: JSON.stringify({ results: [JSON.parse(fx('apple-lookup')).results[4]] }) }));
    await expect(resolveFeedUrl('https://podcasts.apple.com/us/podcast/x/id1003')).rejects.toThrow('Linux Exclusive has no public feed');
    expect(await resolveFeedUrl('https://feeds.example/a.xml')).toBe('https://feeds.example/a.xml');
  });
});

describe('gpodder.net, fyyd and Podcast Index', () => {
  it('reads gpodder.net search, top list and category lists', async () => {
    expect((await gpodder.search('linux'))[1]).toMatchObject({ title: 'Linux Voice', subscribers: 1830, sources: ['gpodder'] });
    expect(titles(await gpodder.top())).toEqual(['Open Source Radio', 'Kernel Panic Hour', 'History Hour']);
    const tech = await gpodder.top('Technology');
    expect(http.mock.calls.at(-1)![0]).toBe('https://gpodder.net/api/2/tag/technology/50.json');
    expect(tech[0].genre).toBe('Technology');
  });

  it('reads fyyd search, skipping entries without a feed', async () => {
    expect(titles(await fyyd.search('linux'))).toEqual(['Late Night Linux', 'Ubuntu Podcast']);
  });

  it('signs Podcast Index requests with sha1(key + secret + time)', async () => {
    const now = 1_790_000_000_000;
    const h = await podcastindex.authHeaders(PI_KEY, now);
    expect(h).toEqual({ 'X-Auth-Date': '1790000000', 'X-Auth-Key': 'KEY123', Authorization: createHash('sha1').update('KEY123SECRET4561790000000').digest('hex') });
    const rs = await podcastindex.search('linux', PI_KEY);
    expect(http.mock.calls.at(-1)![1]?.headers?.['X-Auth-Key']).toBe('KEY123');
    expect(rs[0]).toMatchObject({ title: 'LINUX Unplugged', genre: 'Technology', artworkUrl: 'https://feeds.example/art/lu-big.png' });
    expect(rs[1].artworkUrl).toBeUndefined();
  });
});

describe('combined search', () => {
  it('treats URLs that differ by scheme, www. or a trailing slash as one feed', () => {
    expect(normalizeFeedUrl('http://www.Feeds.example/a.xml/')).toBe(normalizeFeedUrl('https://feeds.example/a.xml'));
    expect(normalizeFeedUrl('https://feeds.example/a.xml?x=1')).not.toBe(normalizeFeedUrl('https://feeds.example/a.xml'));
  });

  it('merges every directory, ranking shows several of them return first', async () => {
    secret = JSON.stringify(PI_KEY);
    const out = await searchDirectories('linux', { country: 'us', source: 'all' });
    expect(out.answered).toEqual(['apple', 'podcastindex', 'gpodder', 'fyyd']);
    expect(out.failed).toEqual([]);
    expect(titles(out.results).slice(0, 2)).toEqual(['LINUX Unplugged', 'Late Night Linux']);
    expect(out.results[0].sources).toEqual(['apple', 'podcastindex', 'gpodder']);
    expect(out.results[1].sources).toEqual(['apple', 'fyyd']);
    expect(new Set(out.results.map((r) => normalizeFeedUrl(r.feedUrl))).size).toBe(out.results.length);
    expect(titles(out.results)).toEqual(expect.arrayContaining(['Linux Voice', 'Ubuntu Podcast', 'Destination Linux', 'Kernel Panic Hour']));
    expect(out.episodes[0].episode?.title).toBe('Wayland, five years on');
  });

  it('leaves Podcast Index out without a key, and keeps partial results when a directory is down', async () => {
    down.add('api.fyyd.de');
    const out = await searchDirectories('linux', { country: 'us', source: 'all' });
    expect(out.answered).toEqual(['apple', 'gpodder']);
    expect(out.failed).toEqual([{ source: 'fyyd', message: 'fyyd responded with HTTP 503' }]);
    expect(out.results.length).toBeGreaterThan(0);
    const pi = await searchDirectories('linux', { country: 'us', source: 'podcastindex' });
    expect(pi.failed[0].message).toBe('add an API key in Preferences');
  });

  it('ranks by weight / (position + 1), as AntennaPod does', () => {
    const r = (title: string, url: string) => ({ id: title, title, author: '', feedUrl: url, genre: 'Podcast', blurb: '', sources: [] as never[] });
    const merged = mergeRanked([
      { source: 'apple', results: [{ ...r('A', 'https://x/a'), sources: ['apple'] }, { ...r('B', 'https://x/b'), sources: ['apple'] }] },
      { source: 'fyyd', results: [{ ...r('B', 'https://x/b'), sources: ['fyyd'] }] },
    ]);
    // A: 1/1 = 1; B: 1/2 + 0.8/1 = 1.3
    expect(titles(merged)).toEqual(['B', 'A']);
  });
});

describe('suggestions', () => {
  it('suggests the regional chart minus followed shows, led by gpodder.net picks', async () => {
    const personal = async () => (await gpodder.top()).slice(2); // History Hour
    const s = await suggestions({ country: 'us', subscribed: [{ feedUrl: 'http://feeds.example/kernel-panic.xml', title: 'Kernel Panic Hour' }], personal });
    expect(titles(s.results)).toEqual(['History Hour', 'Daily Bytes', 'Deep Field']);
    expect(s.sources).toEqual(['your gpodder.net account', 'Apple top chart · United States']);
    const plain = await suggestions({ country: 'gb', subscribed: [] });
    expect(titles(plain.results)).toEqual(['The Allotment Hour']);
  });

  it('still suggests when gpodder.net fails, and fails only when nothing answers', async () => {
    const s = await suggestions({ country: 'us', subscribed: [], personal: async () => { throw new Error('404'); } });
    expect(s.results).toHaveLength(3);
    down.add('itunes.apple.com');
    await expect(suggestions({ country: 'us', subscribed: [] })).rejects.toThrow('Couldn’t reach');
  });

  it('picks the region from the system language', () => {
    expect(defaultCountry('en-GB')).toBe('gb');
    expect(defaultCountry('de_AT')).toBe('at');
    expect(defaultCountry('en')).toBe('us');
    expect(defaultCountry('xx-ZZ')).toBe('us');
  });
});
