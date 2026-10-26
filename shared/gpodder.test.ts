import { describe, expect, it } from 'vitest';
import { GpodderClient, syncOnce, type Http } from './gpodder';
import type { HttpRequest } from './types';

function mockServer(remoteSubs: string[], actions: unknown[] = []) {
  const calls: { url: string; req?: HttpRequest }[] = [];
  const http: Http = async (url, req) => {
    calls.push({ url, req });
    if (req?.headers?.Authorization !== `Basic ${Buffer.from('ines:pw').toString('base64')}`) return { status: 401, text: '' };
    if (url.includes('/subscriptions/') && req?.method !== 'POST') return { status: 200, text: JSON.stringify({ add: remoteSubs, remove: [], timestamp: 100 }) };
    if (url.includes('/subscriptions/')) return { status: 200, text: JSON.stringify({ timestamp: 101, update_urls: [] }) };
    if (url.includes('/episodes/') && req?.method === 'POST') return { status: 200, text: JSON.stringify({ timestamp: 200 }) };
    if (url.includes('/episodes/')) return { status: 200, text: JSON.stringify({ actions, timestamp: 201 }) };
    return { status: 200, text: '' };
  };
  return { http, calls };
}

const acct = { server: 'gpodder.example', user: 'ines', password: 'pw', device: 'resonate-test' };

describe('gpodder sync', () => {
  it('merges subscriptions both ways on first sync', async () => {
    const { http, calls } = mockServer(['https://remote/feed', 'https://both/feed']);
    const r = await syncOnce(new GpodderClient(acct, http), { local: ['https://local/feed', 'https://both/feed'], known: [], subsSince: 0, actionsSince: 0, pending: [] });
    expect(r.addLocally).toEqual(['https://remote/feed']);
    expect(r.removeLocally).toEqual([]);
    const put = calls.find((c) => c.req?.method === 'POST' && c.url.includes('/subscriptions/'))!;
    expect(put.url).toBe('https://gpodder.example/api/2/subscriptions/ines/resonate-test.json');
    expect(JSON.parse(put.req!.body!)).toEqual({ add: ['https://local/feed', 'https://both/feed'], remove: [] });
    expect(r.subsSince).toBe(101);
    expect(r.known.sort()).toEqual(['https://both/feed', 'https://local/feed', 'https://remote/feed']);
  });

  it('sends local unsubscribes and uploads pending play actions', async () => {
    const { http, calls } = mockServer([], [{ podcast: 'p', episode: 'e', action: 'play', position: 60, timestamp: '2026-10-26T10:00:00' }]);
    const pending = [{ podcast: 'p', episode: 'e', action: 'play' as const, position: 10, started: 0, total: 100, timestamp: '2026-10-26T09:00:00' }];
    const r = await syncOnce(new GpodderClient(acct, http), { local: [], known: ['https://gone/feed'], subsSince: 50, actionsSince: 9, pending });
    const put = calls.find((c) => c.req?.method === 'POST' && c.url.includes('/subscriptions/'))!;
    expect(JSON.parse(put.req!.body!)).toEqual({ add: [], remove: ['https://gone/feed'] });
    const up = calls.find((c) => c.req?.method === 'POST' && c.url.includes('/episodes/'))!;
    expect(JSON.parse(up.req!.body!)).toEqual(pending);
    expect(calls.some((c) => c.url.endsWith('/episodes/ines.json?since=9'))).toBe(true);
    expect(r.remoteActions).toHaveLength(1);
    expect(r.actionsSince).toBe(201);
  });

  it('reports bad credentials clearly', async () => {
    const { http } = mockServer([]);
    await expect(new GpodderClient({ ...acct, password: 'nope' }, http).login()).rejects.toThrow('rejected the username or password');
  });
});
