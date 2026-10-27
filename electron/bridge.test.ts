// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkRequest } from './bridge';

const refused = (url: unknown, req?: unknown) => { try { checkRequest(url, req); return null; } catch (e) { return (e as Error).message; } };

describe('what the http bridge will fetch', () => {
  it('accepts the requests the app makes', () => {
    expect(refused('https://feeds.example/feed.xml')).toBeNull();
    expect(refused('http://127.0.0.1:8080/x', { headers: { 'If-None-Match': '"v1"', 'If-Modified-Since': 'Mon, 19 Oct 2026 06:00:00 GMT' } })).toBeNull();
    expect(refused('https://api.podcastindex.org/search', { headers: { 'X-Auth-Key': 'k', 'X-Auth-Date': '1', Authorization: 'abc', 'User-Agent': 'Resonate' } })).toBeNull();
    expect(refused('https://sync.example/api/2/episodes/me.json', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic x' }, body: '{}' })).toBeNull();
    expect(refused('https://x.example/a.json', { maxBytes: 5 * 1024 * 1024 })).toBeNull();
  });

  it('refuses anything that is not a web address', () => {
    for (const url of ['file:///etc/passwd', 'ftp://x.example/f', 'data:text/plain,hi', 'javascript:alert(1)', 'resonate-media://file/x', 'not a url', '', undefined, 42]) {
      expect(refused(url), String(url)).toMatch(/not a web address|addresses are not fetched/);
    }
  });

  it('refuses methods other than GET and POST, and bodies that do not fit', () => {
    expect(refused('https://x.example/', { method: 'DELETE' })).toMatch(/DELETE requests are not made/);
    expect(refused('https://x.example/', { method: 'PUT', body: 'x' })).toMatch(/PUT/);
    expect(refused('https://x.example/', { method: 'GET', body: 'x' })).toMatch(/a GET has no body/);
    expect(refused('https://x.example/', { method: 'POST', body: 42 })).toMatch(/must be text/);
  });

  it('refuses headers that would let the page pose as something else', () => {
    for (const name of ['Cookie', 'cookie', 'Host', 'Origin', 'Referer', 'Proxy-Authorization', 'Connection', 'Content-Length', 'Transfer-Encoding']) {
      expect(refused('https://x.example/', { headers: { [name]: 'x' } }), name).toMatch(/can’t be set/);
    }
  });

  it('refuses a request that is not the shape it should be', () => {
    expect(refused('https://x.example/', 'GET')).toMatch(/malformed/);
    expect(refused('https://x.example/', { headers: 'x' })).toMatch(/malformed/);
    expect(refused('https://x.example/', { headers: { A: 1 } })).toMatch(/must be text/);
    expect(refused('https://x.example/', { maxBytes: -1 })).toMatch(/positive number/);
    expect(refused('https://x.example/', { maxBytes: '5' })).toMatch(/positive number/);
  });
});
