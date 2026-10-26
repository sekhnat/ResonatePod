import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoDownloadKeys, cleanupKeys, epInfo, getEp, useStore } from './store';
import { inboxKeys, totalUnplayed } from './model';
import { platform } from './platform';

const FEED_URL = 'https://kernelpanic.example/feed.xml';
const feed = readFileSync('test/fixtures/feed.xml', 'utf8');
const chapters = readFileSync('test/fixtures/chapters.json', 'utf8');
const vtt = readFileSync('test/fixtures/transcript.vtt', 'utf8');
const NEW_ITEM = `<item><title>Brand new</title><guid>kp:ep:43</guid><pubDate>Mon, 26 Oct 2026 06:00:00 +0000</pubDate><enclosure url="https://cdn.example/kp43.mp3" length="1000" type="audio/mpeg"/></item>`;

const initial = useStore.getState();
const st = () => useStore.getState();
const K42 = 'kernel-panic-hour:kp:ep:42';
const K41 = 'kernel-panic-hour:https://kernelpanic.example/41';
const K40 = 'kernel-panic-hour:https://cdn.example/kp40.mp3';

let feedBody = feed;
const http = vi.spyOn(platform, 'http');

beforeEach(async () => {
  useStore.setState({ ...initial, hydrated: true }, true);
  feedBody = feed;
  http.mockReset();
  http.mockImplementation(async (url, req) => {
    if (url === FEED_URL) return req?.headers?.['If-None-Match'] === '"v2"' ? { status: 304, text: '' } : { status: 200, text: feedBody, etag: '"v1"' };
    if (url.endsWith('chapters.json')) return { status: 200, text: chapters };
    if (url.endsWith('.vtt')) return { status: 200, text: vtt };
    return { status: 404, text: '' };
  });
  await st().addFeed(FEED_URL, { quiet: true });
});
afterEach(() => { platform.isDesktop = false; });

describe('subscribing and refreshing', () => {
  it('adds a show from its feed, flagging only the newest episode as new', () => {
    const show = st().shows[0];
    expect(show).toMatchObject({ id: 'kernel-panic-hour', title: 'Kernel Panic Hour', etag: '"v1"', freq: 'Weekly' });
    expect(show.eps).toHaveLength(3);
    expect(inboxKeys(st())).toEqual([K42]);
    expect(totalUnplayed(st())).toBe(1);
  });

  it('does not subscribe twice and reports bad feeds', async () => {
    expect(await st().addFeed(FEED_URL, { quiet: true })).toBe('kernel-panic-hour');
    expect(st().shows).toHaveLength(1);
    expect(await st().addFeed('https://nowhere.example/feed', { quiet: true })).toBeNull();
  });

  it('merges new episodes on refresh and marks them new', async () => {
    feedBody = feed.replace('<item>', `${NEW_ITEM}<item>`);
    await st().refresh();
    const show = st().shows[0];
    expect(show.eps[0].title).toBe('Brand new');
    expect(inboxKeys(st())[0]).toBe('kernel-panic-hour:kp:ep:43');
    expect(st().lastChecked).toBeGreaterThan(0);
  });

  it('sends the stored ETag and accepts 304 Not Modified', async () => {
    useStore.setState({ shows: st().shows.map((s) => ({ ...s, etag: '"v2"' })) });
    await st().refresh();
    expect(http).toHaveBeenLastCalledWith(FEED_URL, { headers: { 'If-None-Match': '"v2"' } });
    expect(st().shows[0].eps).toHaveLength(3);
  });

  it('starts auto-downloads for a new show on the desktop', async () => {
    platform.isDesktop = true;
    const start = vi.spyOn(platform.download, 'start').mockImplementation(() => {});
    st().unsubscribe('kernel-panic-hour', true);
    await st().addFeed(FEED_URL, { quiet: true });
    expect(start.mock.calls.map((c) => c[0].key)).toEqual([K42, K41, K40]);
    expect(start.mock.calls[0][0]).toMatchObject({ url: 'https://cdn.example/kp42.mp3', folder: '~/Podcasts', showTitle: 'Kernel Panic Hour' });
  });

  it('applies per-show auto-download rules', () => {
    st().setOverride('kernel-panic-hour', 'dl', 'Latest 1');
    expect(autoDownloadKeys(st(), 'kernel-panic-hour')).toEqual([K42]);
    st().setOverride('kernel-panic-hour', 'dl', 'Off');
    expect(autoDownloadKeys(st(), 'kernel-panic-hour')).toEqual([]);
    st().markPlayed(K42, true);
    st().setOverride('kernel-panic-hour', 'dl', 'All');
    expect(autoDownloadKeys(st(), 'kernel-panic-hour')).toEqual([K41, K40]);
  });

  it('unsubscribes, stopping playback of that show', () => {
    st().play(K42);
    st().unsubscribe('kernel-panic-hour', true);
    expect(st().shows).toEqual([]);
    expect(st().cur).toBeNull();
    expect(st().playing).toBe(false);
  });
});

describe('playback', () => {
  it('resumes from the saved position and saves it when switching', () => {
    useStore.setState({ eps: { ...st().eps, [K41]: { ...getEp(st(), K41), pos: 600 } } });
    st().play(K41);
    expect(st().pos).toBe(600);
    st().onTime(700);
    st().play(K42);
    expect(getEp(st(), K41).pos).toBe(700);
    expect(st().pos).toBe(0);
    expect(st().speed).toBe(1.2);
  });

  it('applies the intro skip and per-show speed', () => {
    st().setOverride('kernel-panic-hour', 'intro', '30 s');
    st().setOverride('kernel-panic-hour', 'speed', '1.5×');
    st().play(K40);
    expect(st().pos).toBe(30);
    expect(st().speed).toBe(1.5);
  });

  it('marks played and moves to the next queued episode at the end', () => {
    useStore.setState({ queue: [K42, K40] });
    st().play(K42);
    st().onEnded();
    expect(getEp(st(), K42).played).toBe(true);
    expect(st().cur).toBe(K40);
    expect(st().queue).toEqual([K40]);
  });

  it('stops at the end of the episode when the sleep timer says so', () => {
    useStore.setState({ queue: [K42, K40] });
    st().play(K42);
    st().setSleep({ mode: 'episode' });
    st().onEnded();
    expect(st().playing).toBe(false);
    expect(st().cur).toBe(K42);
  });

  it('loads chapters and transcript, and pauses at the end of a chapter', async () => {
    st().play(K42);
    await vi.waitFor(() => expect(st().meta[K42]?.chapters).toHaveLength(4));
    expect(st().meta[K42].transcript?.[0]).toMatchObject({ who: 'Tom', text: 'Welcome back to Kernel Panic Hour.' });
    st().setSleep({ mode: 'chapter' });
    st().onTime(1100);
    expect(st().playing).toBe(true);
    st().onTime(1121);
    expect(st().playing).toBe(false);
  });

  it('counts down a sleep timer', () => {
    st().play(K42);
    st().setSleep({ mode: 'timer', minutes: 1, remaining: 2 });
    st().tick();
    expect(st().playing).toBe(true);
    st().tick();
    expect(st().playing).toBe(false);
  });

  it('learns the duration from the player when the feed lacks it', () => {
    useStore.setState({ shows: st().shows.map((s) => ({ ...s, eps: s.eps.map((e) => ({ ...e, duration: 0 })) })) });
    st().play(K40);
    st().onDuration(3481.6);
    expect(epInfo(st(), K40)?.dur).toBe(3482);
  });
});

describe('downloads and storage', () => {
  it('records a finished download', () => {
    useStore.setState({ dl: [{ key: K42, received: 0, total: 100, speed: 0 }] });
    st().onDownloadEvent({ type: 'progress', key: K42, received: 50, total: 100, speed: 10 });
    expect(st().dl[0].received).toBe(50);
    st().onDownloadEvent({ type: 'done', key: K42, path: '/p/a.mp3', bytes: 100 });
    expect(st().dl).toEqual([]);
    expect(getEp(st(), K42)).toMatchObject({ file: '/p/a.mp3', fileBytes: 100 });
    expect(st().dlDone[0].key).toBe(K42);
    expect(st().usedBytes).toBe(100);
  });

  it('deletes played files by age, then oldest-played first to fit the limit', () => {
    const DAY = 86400000;
    const now = Date.now();
    const eps = {
      a: { played: true, pos: 0, inbox: false, file: '/a', fileBytes: 10 * 1024 ** 3, playedAt: now - 10 * DAY },
      b: { played: true, pos: 0, inbox: false, file: '/b', fileBytes: 10 * 1024 ** 3, playedAt: now - 2 * DAY },
      c: { played: true, pos: 0, inbox: false, file: '/c', fileBytes: 10 * 1024 ** 3, playedAt: now - 1000 },
      d: { played: false, pos: 0, inbox: false, file: '/d', fileBytes: 10 * 1024 ** 3 },
    };
    const base = { eps, cur: null, storageLimitGb: 100, usedBytes: 40 * 1024 ** 3 };
    expect(cleanupKeys({ ...base, sv: { ...st().sv, del: '1 week' } }, now)).toEqual(['a']);
    expect(cleanupKeys({ ...base, sv: { ...st().sv, del: '1 day' } }, now)).toEqual(['a', 'b']);
    expect(cleanupKeys({ ...base, storageLimitGb: 25, sv: { ...st().sv, del: 'Never' } }, now)).toEqual(['a', 'b']);
  });
});

describe('queue and inbox', () => {
  it('reorders and clears the queue, keeping the current episode', () => {
    useStore.setState({ queue: [K42, K41, K40] });
    st().moveQueue(2, 0);
    expect(st().queue).toEqual([K40, K42, K41]);
    st().play(K42);
    st().clearQueue();
    expect(st().queue).toEqual([K42]);
  });

  it('marks all new episodes played except the one playing', () => {
    st().markAllPlayed();
    expect(totalUnplayed(st())).toBe(0);
  });
});

describe('sync', () => {
  it('applies newer remote play positions', async () => {
    http.mockImplementation(async (url, req) => {
      if (url.includes('/subscriptions/')) return { status: 200, text: JSON.stringify(req?.method === 'POST' ? { timestamp: 2 } : { add: [FEED_URL], remove: [], timestamp: 1 }) };
      if (url.includes('/episodes/') && req?.method !== 'POST') return { status: 200, text: JSON.stringify({ timestamp: 3, actions: [
        { podcast: FEED_URL, episode: 'https://cdn.example/kp41.m4a', action: 'play', position: 900, total: 3840, timestamp: '2030-01-01T00:00:00' },
        { podcast: FEED_URL, episode: 'https://cdn.example/kp40.mp3', action: 'play', position: 3470, total: 3480, timestamp: '2030-01-01T00:00:00' },
      ] }) };
      return { status: 200, text: '{}' };
    });
    await st().configureSync('gpodder.example', 'ines', 'pw');
    expect(getEp(st(), K41).pos).toBe(900);
    expect(getEp(st(), K40).played).toBe(true);
    expect(st().sync).toMatchObject({ server: 'gpodder.example', subsSince: 2, actionsSince: 3, known: [FEED_URL] });
  });

  it('queues a play action when pausing', () => {
    useStore.setState({ sync: { ...st().sync, server: 'gpodder.example', user: 'ines', device: 'd' } });
    st().play(K42);
    st().onTime(120);
    st().togglePlay();
    expect(st().sync.pending).toEqual([expect.objectContaining({ podcast: FEED_URL, episode: 'https://cdn.example/kp42.mp3', action: 'play', started: 0, position: 120, total: 4323 })]);
  });
});
