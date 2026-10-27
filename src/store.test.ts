import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INBOX_SORT, autoDownloadKeys, chaptersOf, cleanupKeys, epInfo, flushSave, getEp, sortFor, trackedBytes, useStore, withEp } from './store';
import { applySort, inboxKeys, liveMeta, rowsFor, totalUnplayed, unplayedFor } from './model';
import { platform } from './platform';
import { getPlayhead, setPlayhead } from './playhead';
import { paletteItems, searchIndex, selectPalette } from './components/CommandPalette';

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
  setPlayhead(0);
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

  it('clears the refreshing flag even when the refresh throws', async () => {
    // autoDownloadKeys reads the overrides after every feed is done; make that blow up.
    useStore.setState({ ovr: new Proxy({}, { get() { throw new Error('boom'); } }) });
    await expect(st().refresh()).rejects.toThrow('boom');
    expect(st().refreshing).toBe(false);
    useStore.setState({ ovr: {} });
    await st().refresh();
    expect(st().lastChecked).toBeGreaterThan(0);
  });

  it('keeps the same episode objects when a refresh changes nothing, and replaces only what changed', async () => {
    const before = st().shows[0];
    const eps = st().eps;
    await st().refresh();
    expect(st().shows[0].eps).toBe(before.eps);
    expect(st().eps).toBe(eps);
    feedBody = feed.replace('Wayland, five years on', 'Wayland, six years on');
    await st().refresh();
    const after = st().shows[0];
    expect(after.eps).not.toBe(before.eps);
    expect(after.eps[0]).not.toBe(before.eps[0]);
    expect(after.eps[0].title).toBe('Wayland, six years on');
    expect(after.eps[1]).toBe(before.eps[1]);
    expect(after.eps[2]).toBe(before.eps[2]);
  });

  it('keeps a duration the player measured when the feed carries none', async () => {
    useStore.setState({ shows: st().shows.map((s) => ({ ...s, eps: s.eps.map((e) => (e.guid === 'https://cdn.example/kp40.mp3' ? { ...e, duration: 1234 } : e)) })) });
    feedBody = feed.replace('<itunes:duration>58:00</itunes:duration>', '');
    await st().refresh();
    expect(st().shows[0].eps.find((e) => e.guid === 'https://cdn.example/kp40.mp3')!.duration).toBe(1234);
    // ...but a duration the feed does give wins.
    feedBody = feed;
    await st().refresh();
    expect(st().shows[0].eps.find((e) => e.guid === 'https://cdn.example/kp40.mp3')!.duration).toBe(3480);
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

  it('tells apart episodes that would be saved under the same file name', async () => {
    platform.isDesktop = true;
    const start = vi.spyOn(platform.download, 'start').mockImplementation(() => {});
    // Same title and day as episode 42, from the same show.
    feedBody = feed.replace('<item>', `<item><title>Wayland, five years on</title><guid>kp:ep:42b</guid><pubDate>Mon, 19 Oct 2026 18:00:00 +0000</pubDate><enclosure url="https://cdn.example/kp42b.mp3" length="1000" type="audio/mpeg"/></item><item>`);
    st().unsubscribe('kernel-panic-hour', true);
    await st().addFeed(FEED_URL, { quiet: true });
    const jobs = Object.fromEntries(start.mock.calls.map((c) => [c[0].key, c[0]]));
    const twin = 'kernel-panic-hour:kp:ep:42b';
    expect(jobs[K42].suffix).toMatch(/^[0-9a-f]{6}$/);
    expect(jobs[twin].suffix).toMatch(/^[0-9a-f]{6}$/);
    expect(jobs[K42].suffix).not.toBe(jobs[twin].suffix);
    expect(jobs[K41].suffix).toBeUndefined(); // the default rule takes the newest three, so 40 isn't started
  });

  it('cycles playback speed to the next faster preset, from presets or not', () => {
    const next = (speed: number) => { useStore.setState({ speed }); st().cycleSpeed(); return st().speed; };
    expect([1, 1.2, 1.5, 2].map(next)).toEqual([1.2, 1.5, 2, 1]);
    expect([0.8, 1.1, 1.75, 2.5].map(next)).toEqual([1, 1.2, 2, 1]);
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
    expect(getPlayhead()).toBe(600);
    st().onTime(700);
    st().play(K42);
    expect(getEp(st(), K41).pos).toBe(700);
    expect(getPlayhead()).toBe(0);
    expect(st().speed).toBe(1.2);
  });

  it('applies the intro skip and per-show speed', () => {
    st().setOverride('kernel-panic-hour', 'intro', '30 s');
    st().setOverride('kernel-panic-hour', 'speed', '1.5×');
    st().play(K40);
    expect(getPlayhead()).toBe(30);
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
    expect(trackedBytes(st().eps)).toBe(100);
  });

  it('counts what the tracked downloads take up, and follows deletions and unsubscribing', async () => {
    const GBx = 1024 ** 3;
    useStore.setState({ eps: { ...st().eps,
      [K42]: { ...getEp(st(), K42), file: '/p/42.mp3', fileBytes: 2 * GBx },
      [K41]: { ...getEp(st(), K41), file: '/p/41.m4a', fileBytes: 3 * GBx },
      [K40]: { ...getEp(st(), K40), fileBytes: 9 * GBx }, // no file: not on disk, not counted
    } });
    expect(trackedBytes(st().eps)).toBe(5 * GBx);
    expect(trackedBytes(st().eps)).toBe(5 * GBx);
    const del = vi.spyOn(platform, 'deleteFile').mockResolvedValue();
    await st().deleteFile(K42, true);
    expect(trackedBytes(st().eps)).toBe(3 * GBx);
    // The files of a show that was unsubscribed from stay on disk, but are no longer counted against the limit.
    st().unsubscribe('kernel-panic-hour', true);
    expect(trackedBytes(st().eps)).toBe(0);
    del.mockRestore();
  });

  it('scans the folder for information only: it never trips the storage limit', async () => {
    platform.isDesktop = true;
    const walk = vi.spyOn(platform, 'diskUsage').mockResolvedValue(500 * 1024 ** 3);
    useStore.setState({ eps: { ...st().eps, [K42]: { ...getEp(st(), K42), played: true, file: '/p/42.mp3', fileBytes: 1024 ** 3, playedAt: Date.now() } }, storageLimitGb: 5 });
    await st().updateUsage();
    expect(st().folderBytes).toBe(500 * 1024 ** 3);
    expect(walk).toHaveBeenCalledWith('~/Podcasts');
    expect(cleanupKeys(st())).toEqual([]); // 1 GB tracked against a 5 GB limit, whatever else is in the folder
    walk.mockRestore();
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
    const base = { eps, cur: null, storageLimitGb: 100 };
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

  it('keeps one pending play per episode, and never drops a different episode', () => {
    useStore.setState({ sync: { ...st().sync, server: 'gpodder.example', user: 'ines', device: 'd' } });
    st().play(K42);
    st().onTime(100);
    st().togglePlay();
    st().togglePlay();
    st().onTime(300);
    st().togglePlay();
    expect(st().sync.pending).toEqual([expect.objectContaining({ episode: 'https://cdn.example/kp42.mp3', started: 100, position: 300 })]);
    const others = Array.from({ length: 600 }, (_, i) => ({ podcast: FEED_URL, episode: `https://cdn.example/other-${i}.mp3`, action: 'play' as const, timestamp: '2026-10-26T00:00:00' }));
    useStore.setState({ sync: { ...st().sync, pending: others } });
    st().togglePlay();
    st().onTime(310);
    st().togglePlay();
    expect(st().sync.pending).toHaveLength(601);
    expect(st().sync.pending[0].episode).toBe('https://cdn.example/other-0.mp3');
  });

  it('keeps a play recorded while a sync is in flight', async () => {
    useStore.setState({ sync: { ...st().sync, server: 'gpodder.example', user: 'ines', device: 'd' } });
    st().play(K42);
    st().onTime(120);
    st().togglePlay();
    let replayed = false;
    http.mockImplementation(async (url, req) => {
      if (url.includes('/subscriptions/') && req?.method !== 'POST' && !replayed) {
        // Same episode again, after the sync took its snapshot of what to send.
        replayed = true;
        st().togglePlay();
        st().onTime(500);
        st().togglePlay();
      }
      if (url.includes('/subscriptions/')) return { status: 200, text: JSON.stringify(req?.method === 'POST' ? { timestamp: 2 } : { add: [], remove: [], timestamp: 1 }) };
      if (url.includes('/episodes/') && req?.method !== 'POST') return { status: 200, text: JSON.stringify({ timestamp: 3, actions: [] }) };
      return { status: 200, text: '{}' };
    });
    await st().runSync();
    expect(replayed).toBe(true);
    expect(st().sync.pending).toEqual([expect.objectContaining({ position: 500 })]);
  });
});

describe('moved and private feeds', () => {
  it('follows a permanent redirect to the feed’s new address', async () => {
    const NEW = 'https://new.example/kp.xml';
    http.mockImplementation(async () => ({ status: 200, text: feed, etag: '"v9"', movedTo: NEW }));
    await st().refresh();
    expect(st().shows[0]).toMatchObject({ feedUrl: NEW, etag: '"v9"' });
    expect(st().toasts.map((t) => t.text)).toContain('Kernel Panic Hour moved to a new address');
  });

  it('follows itunes:new-feed-url, dropping the old validators', async () => {
    feedBody = feed.replace('<channel>', '<channel><itunes:new-feed-url>https://new.example/kp.xml</itunes:new-feed-url>');
    await st().refresh();
    expect(st().shows[0]).toMatchObject({ feedUrl: 'https://new.example/kp.xml', etag: undefined });
  });

  it('subscribes at the address a feed redirected to', async () => {
    st().unsubscribe('kernel-panic-hour', true);
    http.mockImplementation(async (url) => (url === 'https://old.example/feed' ? { status: 200, text: feed, movedTo: FEED_URL } : { status: 404, text: '' }));
    await st().addFeed('https://old.example/feed', { quiet: true });
    expect(st().shows[0].feedUrl).toBe(FEED_URL);
  });

  it('asks for a password on 401 and keeps credentials out of the stored URL', async () => {
    const auth = vi.spyOn(platform, 'setFeedAuth');
    http.mockImplementation(async (_url, req) => ({ status: req?.headers?.Authorization || authed ? 200 : 401, text: feed }));
    let authed = false;
    expect(await st().addFeed('https://private.example/feed.xml')).toBeNull();
    expect(st()).toMatchObject({ dialog: 'feedAuth', authFor: { url: 'https://private.example/feed.xml' } });
    authed = true;
    expect(await st().signInFeed('https://private.example/feed.xml', 'ana', 's3cret')).toBe('ok');
    expect(auth).toHaveBeenCalledWith('https://private.example/feed.xml', 'ana', 's3cret');

    authed = false;
    st().unsubscribe(st().shows[1].id, true);
    authed = true;
    await st().addFeed('https://bo%40b:p%3Ass@private.example/feed.xml', { quiet: true });
    expect(auth).toHaveBeenLastCalledWith('https://private.example/feed.xml', 'bo@b', 'p:ss');
    expect(st().shows[1].feedUrl).toBe('https://private.example/feed.xml');
    auth.mockRestore();
  });

  it('counts feeds that need a password when refreshing', async () => {
    http.mockImplementation(async () => ({ status: 401, text: '' }));
    await st().refresh();
    expect(st().toasts.at(-1)?.text).toBe('Feeds refreshed · no new episodes · 1 feed needs a password');
  });
});

describe('download lifecycle', () => {
  it('keeps failed downloads listed and remembers pending ones across restarts', () => {
    platform.isDesktop = true;
    const start = vi.spyOn(platform.download, 'start').mockImplementation(() => {});
    st().startDownload(K42);
    expect(st().dlPending).toEqual([K42]);
    st().onDownloadEvent({ type: 'retry', key: K42, attempt: 1, at: 123, message: 'HTTP 503' });
    expect(st().dl[0]).toMatchObject({ key: K42, retryAt: 123 });
    st().onDownloadEvent({ type: 'error', key: K42, message: 'HTTP 503' });
    expect(st().dl[0]).toMatchObject({ key: K42, error: 'HTTP 503' });
    expect(st().dlPending).toEqual([K42]);
    st().startDownload(K42);
    expect(start).toHaveBeenCalledTimes(2);
    expect(st().dl[0].error).toBeUndefined();
    st().onDownloadEvent({ type: 'done', key: K42, path: '/p/a.mp3', bytes: 1 });
    expect(st().dlPending).toEqual([]);
    st().startDownload(K41);
    st().cancelDownload(K41);
    expect(st()).toMatchObject({ dl: [], dlPending: [] });
    start.mockRestore();
  });

  it('lets "Retry now" restart a download that is waiting to retry, and drops the countdown once it is queued', () => {
    platform.isDesktop = true;
    const start = vi.spyOn(platform.download, 'start').mockImplementation(() => {});
    st().startDownload(K42);
    st().onDownloadEvent({ type: 'retry', key: K42, attempt: 1, at: 123, message: 'the connection stalled' });
    st().startDownload(K42);
    expect(start).toHaveBeenCalledTimes(2);
    expect(st().dl[0].retryAt).toBeUndefined();
    st().onDownloadEvent({ type: 'retry', key: K42, attempt: 1, at: 456, message: 'HTTP 503' });
    st().onDownloadEvent({ type: 'requeue', key: K42 });
    expect(st().dl[0]).toMatchObject({ key: K42, retryAt: undefined, speed: 0 });
    start.mockRestore();
  });

  it('moves downloaded files and updates their paths', async () => {
    useStore.setState({ eps: { ...st().eps, [K42]: { ...getEp(st(), K42), file: '/old/KP/a.mp3' }, [K41]: { ...getEp(st(), K41), file: '/other/b.mp3' } } });
    const move = vi.spyOn(platform, 'moveFiles').mockResolvedValue([{ from: '/old/KP/a.mp3', to: '/new/KP/a.mp3' }]);
    await st().moveDownloads('/old', '/new');
    expect(move).toHaveBeenCalledWith('/old', '/new', ['/old/KP/a.mp3', '/other/b.mp3']);
    expect(getEp(st(), K42).file).toBe('/new/KP/a.mp3');
    expect(getEp(st(), K41).file).toBe('/other/b.mp3');
    move.mockRestore();
  });
});

describe('command palette search', () => {
  const find = (q: string) => paletteItems(selectPalette(st()), q);

  it('offers the main commands for an empty query', () => {
    expect(find('').map((i) => i.label)).toContain('Refresh all feeds');
    expect(find('')).toHaveLength(7);
  });

  it('lists commands, then shows, then episodes, matching a show’s episodes by its name', () => {
    expect(find('go to').map((i) => i.label)).toEqual(expect.arrayContaining(['Go to Downloads', 'Go to Queue']));
    expect(find('wayland').map((i) => i.label)).toEqual(['Wayland, five years on']);
    expect(find('kernel').map((i) => `${i.label} | ${i.hint}`)).toEqual([
      'Kernel Panic Hour | Show',
      'Wayland, five years on | Kernel Panic Hour',
      'Rolling releases vs. the rest of us | Kernel Panic Hour',
      expect.stringContaining('| Kernel Panic Hour'),
    ]);
    expect(find('nothing matches this')).toEqual([]);
  });

  it('stops at nine results and acts on what it found', () => {
    const show = st().shows[0];
    useStore.setState({ shows: [{ ...show, eps: Array.from({ length: 50 }, (_, i) => ({ ...show.eps[0], guid: `bulk-${i}`, title: `Bulk ${i}` })) }] });
    expect(find('bulk')).toHaveLength(9);
    find('bulk 7')[0].run();
    expect(st().cur).toBe('kernel-panic-hour:bulk-7');
  });

  it('builds its index once per list of shows', () => {
    const index = searchIndex(st().shows);
    expect(searchIndex(st().shows)).toBe(index);
    useStore.setState({ shows: [...st().shows] });
    expect(searchIndex(st().shows)).not.toBe(index);
  });
});

describe('episode rows', () => {
  const row = (key: string) => rowsFor(st(), [key])[0];

  it('are built without the live position; liveMeta carries the playing episode’s time left', () => {
    st().play(K42);
    setPlayhead(0);
    const before = row(K42);
    setPlayhead(1200);
    expect(row(K42)).toEqual(before);
    expect(before).toMatchObject({ isCur: true, isPlaying: true });
    expect(before.meta).toMatch(/ · 72 min · 1:12:03 left · 66 MB$/);
    expect(liveMeta(before, 1200)).toBe(`${before.head} · 52:03 left · ${before.tail}`);
    expect(before.head).toMatch(/ · 72 min$/);
    expect(before.tail).toBe('66 MB');
  });

  it('show the saved time left on a partly played episode that is not playing', () => {
    useStore.setState({ eps: { ...st().eps, [K41]: { ...getEp(st(), K41), pos: 600 } } });
    expect(row(K41).meta).toContain('54:00 left'); // 3840 s - 600 s
    expect(row(K40).meta).not.toContain('left');
  });
});

describe('sparse episode state', () => {
  it('records only what has happened: a new show has one record, for its newest episode', () => {
    expect(Object.keys(st().eps)).toEqual([K42]);
    expect(getEp(st(), K41)).toEqual({ played: false, pos: 0, inbox: false });
    expect(inboxKeys(st())).toEqual([K42]);
    expect(totalUnplayed(st())).toBe(1);
  });

  it('adds records for episodes a refresh finds, and for nothing else', async () => {
    feedBody = feed.replace('<item>', `${NEW_ITEM}<item>`);
    await st().refresh();
    expect(Object.keys(st().eps).sort()).toEqual([K42, 'kernel-panic-hour:kp:ep:43'].sort());
  });

  it('drops a record that goes back to the default', async () => {
    st().markPlayed(K41, true);
    expect(st().eps[K41]).toMatchObject({ played: true });
    st().markPlayed(K41, false);
    expect(K41 in st().eps).toBe(false);
    // A downloaded file is state too; deleting it leaves nothing to record for an untouched episode.
    st().onDownloadEvent({ type: 'done', key: K40, path: '/p/40.mp3', bytes: 10 });
    expect(st().eps[K40]).toMatchObject({ file: '/p/40.mp3' });
    const del = vi.spyOn(platform, 'deleteFile').mockResolvedValue();
    await st().deleteFile(K40, true);
    expect(K40 in st().eps).toBe(false);
    del.mockRestore();
  });

  it('keeps a record that still has something in it', () => {
    const eps = withEp({}, K41, { played: false, pos: 0, inbox: false, lastPlayed: 5 });
    expect(eps[K41]).toBeDefined();
    expect(withEp(eps, K41, { played: false, pos: 0, inbox: false })).toEqual({});
  });
});

describe('inbox and unread counts', () => {
  it('are shared while the library is unchanged, and follow it when it changes', () => {
    const keys = inboxKeys(st());
    expect(inboxKeys(st())).toBe(keys);
    expect(totalUnplayed(st())).toBe(1);
    expect(unplayedFor(st(), 'kernel-panic-hour')).toBe(1);
    expect(unplayedFor(st(), 'no-such-show')).toBe(0);
    st().markAllPlayed();
    expect(totalUnplayed(st())).toBe(0);
    expect(unplayedFor(st(), 'kernel-panic-hour')).toBe(0);
    useStore.setState({ eps: { ...st().eps, [K41]: { played: false, pos: 0, inbox: true } } });
    expect(unplayedFor(st(), 'kernel-panic-hour')).toBe(1);
    expect(inboxKeys(st())).toContain(K41);
  });
});

describe('epInfo', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('finds episodes by key, and builds each one’s info only once', () => {
    const a = epInfo(st(), K42)!;
    expect(a).toMatchObject({ key: K42, title: 'Wayland, five years on' });
    expect(epInfo(st(), K42)).toBe(a);
    expect(epInfo(st(), 'kernel-panic-hour:nope')).toBeNull();
    expect(epInfo(st(), 'nope:kp:ep:42')).toBeNull();
    expect(epInfo(st(), null)).toBeNull();
  });

  it('follows replaced episodes and shows rather than serving old ones', () => {
    const before = epInfo(st(), K42)!;
    // Same episode objects under a new show object: the info must point at the new show.
    useStore.setState({ shows: st().shows.map((s) => ({ ...s, title: 'Renamed' })) });
    expect(epInfo(st(), K42)!.show.title).toBe('Renamed');
    expect(epInfo(st(), K42)!.ep).toBe(before.ep);
    // A replaced episode object (the player measured a new duration).
    useStore.setState({ shows: st().shows.map((s) => ({ ...s, eps: s.eps.map((e) => (e.guid === 'kp:ep:42' ? { ...e, duration: 999 } : e)) })) });
    expect(epInfo(st(), K42)!.dur).toBe(999);
  });

  it('returns the first episode when a feed repeats a guid, as find did', () => {
    const show = st().shows[0];
    useStore.setState({ shows: [{ ...show, eps: [{ ...show.eps[0], title: 'first' }, { ...show.eps[0], title: 'second' }] }] });
    expect(epInfo(st(), K42)!.title).toBe('first');
  });

  it('moves "Today" on when the day changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, 12));
    const ep = st().shows[0].eps[0];
    useStore.setState({ shows: [{ ...st().shows[0], eps: [{ ...ep, pubDate: Date.now() }] }] });
    expect(epInfo(st(), K42)!.date).toBe('Today');
    vi.setSystemTime(new Date(2026, 9, 27, 12));
    expect(epInfo(st(), K42)!.date).toBe('Yesterday');
  });
});

describe('persistence', () => {
  it('skips writes when only playback position, progress or UI state change', async () => {
    await flushSave();
    const save = vi.spyOn(platform, 'saveLibrary').mockResolvedValue();
    st().play(K42);
    await flushSave();
    save.mockClear();
    for (let t = 1; t < 20; t++) st().onTime(t);
    useStore.setState({ dl: [{ key: K41, received: 5, total: 10, speed: 1 }], screen: 'queue' });
    await flushSave();
    expect(save).not.toHaveBeenCalled();
    st().checkpoint();
    await flushSave();
    expect(save).toHaveBeenCalledTimes(1);
    const written = JSON.parse(save.mock.calls[0][0]);
    expect(written.state.pos).toBeUndefined();
    expect(written.state.eps[K42].pos).toBe(19);
    save.mockRestore();
  });

  it('keeps silence-trim savings in memory until the checkpoint', async () => {
    await flushSave();
    const save = vi.spyOn(platform, 'saveLibrary').mockResolvedValue();
    for (let i = 0; i < 10; i++) st().addTrimSaved(1.5);
    await flushSave();
    expect(save).not.toHaveBeenCalled();
    expect(st().trimSaved + st().trimPending).toBe(15);
    st().checkpoint();
    await flushSave();
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(save.mock.calls[0][0]).state.trimSaved).toBe(15);
    expect(st().trimPending).toBe(0);
    save.mockRestore();
  });
});

describe('embedded chapters', () => {
  it('reads chapters from the media file when the feed has none', async () => {
    const embedded = vi.spyOn(platform, 'embeddedChapters').mockResolvedValue([{ t: 'Cold open', at: 0 }, { t: 'Mail', at: 600 }]);
    st().play(K40);
    await vi.waitFor(() => expect(st().meta[K40]?.chapters).toHaveLength(2));
    expect(embedded).toHaveBeenCalledWith(undefined, 'https://cdn.example/kp40.mp3');
    expect(chaptersOf(st(), epInfo(st(), K40)!).map((c) => c.t)).toEqual(['Cold open', 'Mail']);
    embedded.mockClear();
    st().play(K41); // Podlove chapters in the feed: the file isn't read
    await vi.waitFor(() => expect(st().meta[K41]).toBeDefined());
    expect(embedded).not.toHaveBeenCalled();
    embedded.mockRestore();
  });
});


describe('directories', () => {
  it('subscribes to the real feed behind an Apple Podcasts link', async () => {
    st().unsubscribe('kernel-panic-hour', true);
    const base = http.getMockImplementation()!;
    http.mockImplementation(async (url, req) => (url.startsWith('https://itunes.apple.com/lookup?id=1004')
      ? { status: 200, text: JSON.stringify({ results: [{ collectionId: 1004, collectionName: 'Kernel Panic Hour', feedUrl: FEED_URL }] }) }
      : base(url, req)));
    const id = await st().addFeed('https://podcasts.apple.com/gb/podcast/kernel-panic-hour/id1004', { quiet: true });
    expect(id).toBe('kernel-panic-hour');
    expect(st().shows[0].feedUrl).toBe(FEED_URL);
  });

  it('asks gpodder.net for personal suggestions only when sync is set up', async () => {
    expect(await st().gpodderSuggestions()).toEqual([]);
    expect(http).not.toHaveBeenCalledWith(expect.stringContaining('/suggestions/'), expect.anything());
    useStore.setState({ sync: { ...st().sync, server: 'gpodder.net', user: 'ines', device: 'd' } });
    http.mockImplementation(async (url) => (url === 'https://gpodder.net/suggestions/12.json'
      ? { status: 200, text: readFileSync('test/fixtures/directory/gpodder-suggestions.json', 'utf8') }
      : { status: 404, text: '' }));
    expect((await st().gpodderSuggestions()).map((r) => r.title)).toEqual(['History Hour', 'Kernel Panic Hour']);
    http.mockImplementation(async () => ({ status: 404, text: '' }));
    expect(await st().gpodderSuggestions()).toEqual([]);
  });

  it('saves the Podcast Index key as a secret and falls back to all directories when removed', async () => {
    const setSecret = vi.spyOn(platform, 'setSecret');
    await st().setPodcastIndexKey({ key: 'k', secret: 's' });
    expect(setSecret).toHaveBeenLastCalledWith('podcastindex', JSON.stringify({ key: 'k', secret: 's' }));
    st().setDirectory({ source: 'podcastindex' });
    await st().setPodcastIndexKey(null);
    expect(st().directory).toMatchObject({ podcastIndex: false, source: 'all' });
    setSecret.mockRestore();
  });
});

describe('sorting episodes', () => {
  const keys = () => st().shows[0].eps.map((e) => `${st().shows[0].id}:${e.guid}`);
  const order = (sort: Parameters<typeof applySort>[1], rows = rowsFor(st(), keys())) => applySort(rows, sort).map((r) => r.key);

  it('orders by date, duration and title', () => {
    expect(order('Newest first')).toEqual([K42, K41, K40]);
    expect(order('Oldest first')).toEqual([K40, K41, K42]);
    expect(order('Longest first')).toEqual([K42, K41, K40]);
    expect(order('Shortest first')).toEqual([K40, K41, K42]);
    expect(order('Title A–Z')).toEqual([K41, K40, K42]);
    expect(order('Title Z–A')).toEqual([K42, K40, K41]);
  });

  it('puts undated and unknown-length episodes last either way', () => {
    const rows = rowsFor(st(), keys());
    rows[0] = { ...rows[0], pubDate: 0, dur: 0 };
    for (const sort of ['Newest first', 'Oldest first', 'Longest first', 'Shortest first'] as const) expect(order(sort, rows).at(-1)).toBe(K42);
  });

  it('numbers titles naturally and lists unplayed first', () => {
    const base = rowsFor(st(), keys())[0];
    const titled = ['Ep 10', 'Ep 2', 'ep 1'].map((title) => ({ ...base, key: title, title }));
    expect(order('Title A–Z', titled)).toEqual(['ep 1', 'Ep 2', 'Ep 10']);
    st().markPlayed(K42, true);
    expect(order('Unplayed first')).toEqual([K41, K40, K42]);
  });

  it('remembers a sort per show and for the inbox, and forgets it on unsubscribe', () => {
    st().setSort('kernel-panic-hour', 'Oldest first');
    st().setSort(INBOX_SORT, 'Title A–Z');
    expect(st().sorts).toEqual({ 'kernel-panic-hour': 'Oldest first', [INBOX_SORT]: 'Title A–Z' });
    expect(sortFor(st(), 'other')).toBe('Newest first');
    st().setSort('kernel-panic-hour', 'Newest first');
    expect(st().sorts).toEqual({ [INBOX_SORT]: 'Title A–Z' });
    st().setSort('kernel-panic-hour', 'Longest first');
    st().unsubscribe('kernel-panic-hour', true);
    expect(st().sorts).toEqual({ [INBOX_SORT]: 'Title A–Z' });
  });
});
