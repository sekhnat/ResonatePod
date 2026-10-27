// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hopHeaders, originOf } from './hops';

const logins: Record<string, string> = { 'https://a.example': 'Basic QQ==', 'https://b.example': 'Basic Qg==' };
const loginFor = (url: string): Record<string, string> => (logins[originOf(url)] ? { Authorization: logins[originOf(url)] } : {});
const hop = (start: string, to: string, caller?: Record<string, string>) => hopHeaders(caller, start, to, 'Resonate/1', loginFor);

describe('origins', () => {
  it('are scheme, host and port', () => {
    expect(originOf('https://a.example/feed?x=1')).toBe('https://a.example');
    expect(originOf('http://a.example:8080/x')).toBe('http://a.example:8080');
    expect(originOf('not a url')).toBe('');
  });
});

describe('the headers for each hop of a redirected request', () => {
  it('carry the login on the origin it belongs to', () => {
    expect(hop('https://a.example/feed', 'https://a.example/other')).toEqual({ 'User-Agent': 'Resonate/1', Authorization: 'Basic QQ==' });
  });

  it('leave the login behind when a redirect goes to another origin, and use that origin’s own if there is one', () => {
    expect(hop('https://a.example/feed', 'https://cdn.example/x')).toEqual({ 'User-Agent': 'Resonate/1' });
    expect(hop('https://a.example/feed', 'https://b.example/x')).toEqual({ 'User-Agent': 'Resonate/1', Authorization: 'Basic Qg==' });
  });

  it('treat another scheme or port as another origin', () => {
    expect(hop('https://a.example/feed', 'http://a.example/feed')).not.toHaveProperty('Authorization');
    expect(hop('https://a.example/feed', 'https://a.example:444/feed')).not.toHaveProperty('Authorization');
  });

  it('keep the caller’s headers, and its own Authorization only at home', () => {
    const caller = { 'If-None-Match': '"v1"', authorization: 'Basic Y2FsbGVy' };
    expect(hop('https://sync.example/api', 'https://sync.example/api2', caller)).toEqual({ 'User-Agent': 'Resonate/1', 'If-None-Match': '"v1"', authorization: 'Basic Y2FsbGVy' });
    expect(hop('https://sync.example/api', 'https://elsewhere.example/', caller)).toEqual({ 'User-Agent': 'Resonate/1', 'If-None-Match': '"v1"' });
  });

  it('return to the stored login when a redirect comes back to the origin it started at', () => {
    expect(hop('https://a.example/feed', 'https://a.example/final')).toHaveProperty('Authorization', 'Basic QQ==');
  });
});
