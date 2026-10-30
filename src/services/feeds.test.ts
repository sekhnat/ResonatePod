import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpResponse } from '../../shared/types';
import type { Episode } from '../data';
import { platform } from '../platform';
import { PARSER_VERSION } from '../../shared/parser-version';
import { fetchFeedUpdate, fetchNewFeed, mergeEpisodes, splitCredentials, takeCredentials } from './feeds';

const URL = 'https://kernelpanic.example/feed.xml';
const xml = readFileSync('test/fixtures/feed.xml', 'utf8');
const http = vi.spyOn(platform, 'http');
const reply = (r: Partial<HttpResponse>) => http.mockResolvedValue({ status: 200, text: xml, ...r });

afterEach(() => http.mockReset());

const show = { id: 'kp', feedUrl: URL, etag: '"abc"', lastModified: 'Mon, 19 Oct 2026 06:00:00 GMT', parser: PARSER_VERSION };

describe('fetchFeedUpdate', () => {
  it('asks with the validators from last time', async () => {
    reply({ status: 304, text: '' });
    await fetchFeedUpdate(show);
    expect(http).toHaveBeenCalledWith(URL, { headers: { 'If-None-Match': '"abc"', 'If-Modified-Since': show.lastModified } });
    http.mockClear();
    await fetchFeedUpdate({ id: 'kp', feedUrl: URL, parser: PARSER_VERSION });
    expect(http).toHaveBeenCalledWith(URL, { headers: {} });
  });

  it('asks for the whole feed when an older parser read it, so what the parser has learnt reaches the show', async () => {
    reply({});
    for (const parser of [undefined, PARSER_VERSION - 1]) {
      http.mockClear();
      const r = await fetchFeedUpdate({ ...show, parser });
      expect(http).toHaveBeenCalledWith(URL, { headers: {} });
      if (r.kind !== 'updated') throw new Error(r.kind);
      expect(r.show.parser).toBe(PARSER_VERSION);
    }
  });

  it('reports a feed that did not change, and one that wants a password', async () => {
    reply({ status: 304, text: '' });
    expect(await fetchFeedUpdate(show)).toEqual({ kind: 'unchanged' });
    reply({ status: 401, text: '' });
    expect(await fetchFeedUpdate(show)).toEqual({ kind: 'auth' });
  });

  it('parses a feed that did, keeping show notes apart and the new validators', async () => {
    reply({ etag: '"def"', lastModified: 'Tue, 20 Oct 2026 06:00:00 GMT' });
    const r = await fetchFeedUpdate(show);
    if (r.kind !== 'updated') throw new Error(r.kind);
    expect(r.show).toMatchObject({ id: 'kp', title: 'Kernel Panic Hour', feedUrl: URL, etag: '"def"', lastModified: 'Tue, 20 Oct 2026 06:00:00 GMT' });
    expect(r.show.eps).toHaveLength(3);
    expect(r.show.eps.every((e) => !('description' in e))).toBe(true);
    expect(r.notes.get('https://kernelpanic.example/41')).toContain('Arch, Tumbleweed');
    expect(r.movedTo).toBeUndefined();
    expect(r.newFeedUrl).toBeUndefined();
  });

  it('passes on where a feed has moved to, by redirect or by its own say-so', async () => {
    reply({ movedTo: 'https://new.example/feed.xml' });
    expect(await fetchFeedUpdate(show)).toMatchObject({ kind: 'updated', movedTo: 'https://new.example/feed.xml' });
    reply({ text: xml.replace('<channel>', '<channel><itunes:new-feed-url>https://other.example/feed.xml</itunes:new-feed-url>') });
    expect(await fetchFeedUpdate(show)).toMatchObject({ kind: 'updated', newFeedUrl: 'https://other.example/feed.xml' });
  });

  it('throws for any other status, and for something that is not a feed', async () => {
    reply({ status: 503, text: '' });
    await expect(fetchFeedUpdate(show)).rejects.toThrow('HTTP 503');
    reply({ text: '<html></html>' });
    await expect(fetchFeedUpdate(show)).rejects.toThrow('Not a podcast RSS feed');
  });
});

describe('fetchNewFeed', () => {
  it('returns the response, and where the feed lives once it has moved', async () => {
    reply({});
    expect(await fetchNewFeed(URL)).toMatchObject({ kind: 'ok', feedUrl: URL });
    reply({ movedTo: 'https://new.example/feed.xml' });
    expect(await fetchNewFeed(URL)).toMatchObject({ kind: 'ok', feedUrl: 'https://new.example/feed.xml' });
  });

  it('reports a feed that wants a password and explains any other failure', async () => {
    reply({ status: 401, text: '' });
    expect(await fetchNewFeed(URL)).toEqual({ kind: 'auth' });
    reply({ status: 404, text: '' });
    await expect(fetchNewFeed(URL)).rejects.toThrow('the server responded with HTTP 404');
  });
});

describe('credentials in an address', () => {
  it('splits them from the URL', () => {
    expect(splitCredentials('https://me:p%40ss@host.example/feed')).toEqual({ url: 'https://host.example/feed', user: 'me', password: 'p@ss' });
    expect(splitCredentials('https://host.example/feed')).toBeNull();
    expect(splitCredentials('not a url')).toBeNull();
  });

  it('are saved for the server and left out of the address', async () => {
    const auth = vi.spyOn(platform, 'setFeedAuth').mockResolvedValue();
    expect(await takeCredentials('  https://me:secret@host.example/feed  ')).toBe('https://host.example/feed');
    expect(auth).toHaveBeenCalledWith('https://host.example/feed', 'me', 'secret');
    auth.mockClear();
    expect(await takeCredentials(' https://host.example/feed ')).toBe('https://host.example/feed');
    expect(auth).not.toHaveBeenCalled();
    auth.mockRestore();
  });
});

describe('mergeEpisodes', () => {
  const ep = (guid: string, pubDate: number, extra: Partial<Episode> = {}): Episode =>
    ({ guid, title: guid, pubDate, duration: 100, enclosureUrl: `https://cdn.example/${guid}.mp3`, enclosureType: 'audio/mpeg', sizeBytes: 1, ...extra }) as Episode;
  const old = [ep('c', 3), ep('b', 2), ep('a', 1)];
  const never = () => false;

  it('is null, with nothing added, when the feed says what we already have', () => {
    const r = mergeEpisodes(old, old.map((e) => ({ ...e })), never);
    expect(r).toEqual({ eps: null, added: [], changed: [] });
  });

  it('reuses the very object of an episode that did not change', () => {
    const r = mergeEpisodes(old, [ep('d', 4), ...old.map((e) => ({ ...e }))], never);
    expect(r.eps?.slice(1)).toEqual(old);
    old.forEach((e, i) => expect(r.eps?.[i + 1]).toBe(e));
    expect(r.added.map((e) => e.guid)).toEqual(['d']);
    expect(r.changed.map((e) => e.guid)).toEqual(['d']);
  });

  it('reports an episode whose fields changed, and keeps a duration the player measured', () => {
    const measured = [ep('a', 1, { duration: 777 })];
    const r = mergeEpisodes(measured, [ep('a', 1, { duration: 0, title: 'Renamed' })], never);
    expect(r.eps?.[0]).toMatchObject({ title: 'Renamed', duration: 777 });
    expect(r.changed).toHaveLength(1);
    expect(r.added).toEqual([]);
  });

  it('drops an episode the feed no longer lists, unless something still refers to it', () => {
    expect(mergeEpisodes(old, [old[0], old[1]], never).eps?.map((e) => e.guid)).toEqual(['c', 'b']);
    const kept = mergeEpisodes(old, [old[0], old[1]], (guid) => guid === 'a');
    expect(kept.eps).toBeNull(); // the same three, in the same order
    const r = mergeEpisodes(old, [ep('d', 4), old[1]], (guid) => guid === 'a');
    expect(r.eps?.map((e) => e.guid)).toEqual(['d', 'b', 'a']);
  });

  it('sorts a kept episode in by its date, newest first', () => {
    const r = mergeEpisodes([ep('a', 1), ep('z', 50)], [ep('m', 10)], (guid) => guid === 'z' || guid === 'a');
    expect(r.eps?.map((e) => e.guid)).toEqual(['z', 'm', 'a']);
  });
});
