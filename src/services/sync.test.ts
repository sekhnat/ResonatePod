import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EpisodeAction } from '../../shared/gpodder';
import type { Episode, Show } from '../data';
import { platform } from '../platform';
import { applyRemotePositions, clientFor, fetchSync } from './sync';
import type { SyncState } from '../store/types';

const ep = (guid: string): Episode => ({ guid, title: guid, pubDate: 1, duration: 600, enclosureUrl: `https://cdn.example/${guid}.mp3`, enclosureType: 'audio/mpeg', sizeBytes: 1 }) as Episode;
const shows = [{ id: 'kp', eps: [ep('a'), ep('b')] } as Show];
const KA = 'kp:a';
const KB = 'kp:b';
const play = (guid: string, position: number, timestamp: string, total = 600): EpisodeAction =>
  ({ podcast: 'https://kp.example/feed', episode: `https://cdn.example/${guid}.mp3`, action: 'play', timestamp, position, total });
const T = (iso: string) => Date.parse(iso);
const base = { shows, eps: {}, cur: null } as Parameters<typeof applyRemotePositions>[0];

afterEach(() => vi.restoreAllMocks());

describe('applyRemotePositions', () => {
  it('takes a position from another device where we have nothing newer', () => {
    const eps = applyRemotePositions(base, [play('a', 120, '2026-10-20T10:00:00Z')]);
    expect(eps[KA]).toEqual({ played: false, pos: 120, inbox: false, playedAt: undefined, lastPlayed: T('2026-10-20T10:00:00Z') });
    expect(eps[KB]).toBeUndefined();
  });

  it('ignores a position older than what we last did with the episode', () => {
    const mine = { played: false, pos: 300, inbox: false, lastPlayed: T('2026-10-21T00:00:00Z') };
    const eps = applyRemotePositions({ ...base, eps: { [KA]: mine } }, [play('a', 120, '2026-10-20T10:00:00Z')]);
    expect(eps[KA]).toBe(mine);
  });

  it('leaves the episode that is playing alone', () => {
    const eps = applyRemotePositions({ ...base, cur: KA }, [play('a', 120, '2026-10-20T10:00:00Z')]);
    expect(eps[KA]).toBeUndefined();
  });

  it('marks an episode played when the other device was within 30 seconds of its end', () => {
    const eps = applyRemotePositions({ ...base, eps: { [KA]: { played: false, pos: 50, inbox: true } } }, [play('a', 575, '2026-10-20T10:00:00Z')]);
    expect(eps[KA]).toMatchObject({ played: true, pos: 0, inbox: true, playedAt: T('2026-10-20T10:00:00Z') });
    const short = applyRemotePositions(base, [play('b', 560, '2026-10-20T10:00:00Z')]);
    expect(short[KB]).toMatchObject({ played: false, pos: 560 });
  });

  it('reads a timestamp without a zone as UTC, and skips what is not a play of an episode we have', () => {
    const eps = applyRemotePositions(base, [
      play('a', 10, '2026-10-20T10:00:00'),
      { ...play('b', 10, '2026-10-20T10:00:00Z'), action: 'download' },
      play('zzz', 10, '2026-10-20T10:00:00Z'),
      { ...play('b', 0, '2026-10-20T10:00:00Z'), position: undefined },
    ]);
    expect(eps[KA].lastPlayed).toBe(T('2026-10-20T10:00:00Z'));
    expect(Object.keys(eps)).toEqual([KA]);
  });

  it('does not change the state it was given', () => {
    const eps = { [KA]: { played: false, pos: 1, inbox: false } };
    applyRemotePositions({ ...base, eps }, [play('a', 90, '2026-10-20T10:00:00Z')]);
    expect(eps[KA].pos).toBe(1);
  });
});

const account: SyncState = { server: 'gpodder.example', user: 'ines', device: 'd', subsSince: 0, actionsSince: 0, known: [], pending: [], lastSynced: 0 };

describe('fetchSync', () => {
  it('uses the saved password and reports which pending actions went out', async () => {
    const secret = vi.spyOn(platform, 'getSecret').mockResolvedValue('pw');
    const calls: { url: string; auth?: string }[] = [];
    vi.spyOn(platform, 'http').mockImplementation(async (url, req) => {
      calls.push({ url, auth: req?.headers?.Authorization });
      if (url.includes('/subscriptions/')) return { status: 200, text: JSON.stringify({ add: [], remove: [], timestamp: 5 }) };
      if (url.includes('/episodes/')) return { status: 200, text: JSON.stringify({ actions: [], timestamp: 7 }) };
      return { status: 200, text: '{}' };
    });
    const pending = [play('a', 10, '2026-10-20T10:00:00Z')];
    const { result, sent } = await fetchSync({ ...account, pending }, ['https://kp.example/feed']);
    expect(secret).toHaveBeenCalledWith('gpodder');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.auth === `Basic ${btoa('ines:pw')}`)).toBe(true);
    expect(result).toMatchObject({ actionsSince: 7, addLocally: [], removeLocally: [] });
    expect([...sent]).toEqual(pending);
    expect(sent.has(pending[0])).toBe(true);
  });

  it('builds a client with an empty password when none is saved', async () => {
    vi.spyOn(platform, 'getSecret').mockResolvedValue(null);
    const seen: (string | undefined)[] = [];
    vi.spyOn(platform, 'http').mockImplementation(async (_url, req) => { seen.push(req?.headers?.Authorization); return { status: 200, text: '{"add":[],"remove":[],"timestamp":1,"actions":[]}' }; });
    await (await clientFor(account)).getSubscriptions(0);
    expect(seen).toEqual([`Basic ${btoa('ines:')}`]);
  });
});
