// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DownloadRoots, isWithin, rootsFromLibrary } from './paths';

let tmp: string;
let pods: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'res-paths-'));
  pods = path.join(tmp, 'pods');
  mkdirSync(path.join(pods, 'Show'), { recursive: true });
  writeFileSync(path.join(pods, 'Show', 'a.mp3'), 'x');
});

describe('isWithin', () => {
  it('accepts the root, files under it and paths that do not exist yet', async () => {
    expect(await isWithin(pods, pods)).toBe(true);
    expect(await isWithin(pods, path.join(pods, 'Show', 'a.mp3'))).toBe(true);
    expect(await isWithin(pods, path.join(pods, 'New Show', 'b.mp3'))).toBe(true);
    expect(await isWithin(pods, path.join(pods, '..hidden'))).toBe(true);
  });

  it('rejects .. escapes and sibling folders that share a prefix', async () => {
    expect(await isWithin(pods, path.join(pods, '..', 'secret'))).toBe(false);
    expect(await isWithin(pods, path.join(pods, 'Show', '..', '..', 'secret'))).toBe(false);
    expect(await isWithin(pods, `${pods}2/a.mp3`)).toBe(false);
    expect(await isWithin(pods, '/etc/hostname')).toBe(false);
  });

  it('rejects a symlink that leads out of the root, and follows one that leads back in', async () => {
    const outside = path.join(tmp, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.txt'), 's');
    symlinkSync(outside, path.join(pods, 'link'));
    expect(await isWithin(pods, path.join(pods, 'link', 'secret.txt'))).toBe(false);
    expect(await isWithin(pods, path.join(pods, 'link', 'new.txt'))).toBe(false);
    // A root that is itself a symlink still contains its own files.
    const alias = path.join(tmp, 'alias');
    symlinkSync(pods, alias);
    expect(await isWithin(alias, path.join(pods, 'Show', 'a.mp3'))).toBe(true);
    expect(await isWithin(alias, path.join(alias, 'Show', 'a.mp3'))).toBe(true);
  });
});

describe('DownloadRoots', () => {
  const settings = () => path.join(tmp, 'main-settings.json');

  it('starts from the default folder plus what the old library used, and remembers it', async () => {
    const roots = new DownloadRoots(settings(), pods);
    await roots.load(async () => [path.join(tmp, 'older')]);
    expect(roots.list()).toEqual([pods, path.join(tmp, 'older')]);
    const again = new DownloadRoots(settings(), '/somewhere/else');
    await again.load(async () => { throw new Error('adopted twice'); });
    expect(again.list()).toEqual([pods, path.join(tmp, 'older')]);
  });

  it('resolves only paths inside a root, and hands back the normalised path', async () => {
    const roots = new DownloadRoots(settings(), pods);
    await roots.load(async () => []);
    expect(await roots.resolve(path.join(pods, 'Show', '..', 'Show', 'a.mp3'))).toBe(path.join(pods, 'Show', 'a.mp3'));
    expect(await roots.resolve('/etc/hostname')).toBeNull();
    expect(await roots.resolve(path.join(pods, '..', 'x'))).toBeNull();
    expect(await roots.resolve('')).toBeNull();
    expect(await roots.resolve(42)).toBeNull();
  });

  it('opens a new folder only through add()', async () => {
    const roots = new DownloadRoots(settings(), pods);
    await roots.load(async () => []);
    const media = path.join(tmp, 'media');
    expect(await roots.resolve(path.join(media, 'a.mp3'))).toBeNull();
    await roots.add(media);
    await roots.add(media);
    expect(await roots.resolve(path.join(media, 'a.mp3'))).toBe(path.join(media, 'a.mp3'));
    expect(JSON.parse(readFileSync(settings(), 'utf8')).downloadRoots).toEqual([pods, media]);
  });
});

describe('rootsFromLibrary', () => {
  it('reads the folder setting and the folders downloaded files sit in', () => {
    const json = JSON.stringify({ state: { folder: '/data/Podcasts', eps: { a: { file: '/old/Pods/Show/a.mp3' }, b: { played: true }, c: { file: 'relative/x.mp3' }, d: { file: '/x.mp3' } } }, version: 2 });
    expect(rootsFromLibrary(json).sort()).toEqual(['/data/Podcasts', '/old/Pods']);
  });

  it('copes with a missing or unreadable library', () => {
    expect(rootsFromLibrary(null)).toEqual([]);
    expect(rootsFromLibrary('{not json')).toEqual([]);
    expect(rootsFromLibrary('{}')).toEqual([]);
  });
});
