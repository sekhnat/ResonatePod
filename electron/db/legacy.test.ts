import { beforeEach, describe, expect, it } from 'vitest';
import { importLegacyLibrary } from './legacy';
import { LibraryDb } from './library';

const notes = 'Show notes for the first episode.';
const saved = (state: Record<string, unknown>, version = 2) => JSON.stringify({ state, version });

const library = {
  shows: [
    { id: 'kp', title: 'Kernel Panic Hour', hue: 140, feedUrl: 'https://kp.example/feed', subscribedAt: 1,
      eps: [
        { guid: 'kp:2', pubDate: 2000, title: 'Two', duration: 60, description: notes, enclosureUrl: 'https://cdn/2.mp3' },
        { guid: 'kp:1', pubDate: 1000, title: 'One', duration: 30, description: '', enclosureUrl: 'https://cdn/1.mp3' },
      ] },
    { id: 'zz', title: 'Another', hue: 20, feedUrl: 'https://zz.example/feed', subscribedAt: 2, eps: [] },
  ],
  eps: {
    'kp:kp:2': { played: false, pos: 0, inbox: true },
    'kp:kp:1': { played: true, pos: 0, inbox: false, file: '/p/kp/1.mp3', fileBytes: 99, playedAt: 5, lastPlayed: 6 },
    'kp:gone': { played: false, pos: 0, inbox: false }, // a default-state record the old version wrote for every episode
  },
  cur: 'kp:kp:1', speed: 1.5, volume: 0.8, muted: false, queue: ['kp:kp:2'], dlDone: [], dlPending: [], dlPaused: false,
  ovr: { kp: { speed: '1.2×' } }, sorts: {}, tg: { auto: true }, sv: { keep: '3' }, folder: '~/Podcasts', storageLimitGb: 40,
  usedBytes: 123, sync: { server: '' }, lastChecked: 7, trimSaved: 3, directory: { country: 'gb' },
};

let db: LibraryDb;
beforeEach(() => { db = new LibraryDb(':memory:'); });

describe('importing the old JSON library', () => {
  it('moves shows, episodes, show notes, state and settings across', () => {
    expect(importLegacyLibrary(db, saved(library))).toEqual({ shows: 2, episodes: 2, states: 2 });
    const lib = db.load();
    expect(lib.shows.map((s) => s.id)).toEqual(['kp', 'zz']);
    expect(lib.shows[0]).toMatchObject({ title: 'Kernel Panic Hour', hue: 140, feedUrl: 'https://kp.example/feed' });
    expect(lib.shows[0].eps.map((e) => e.guid)).toEqual(['kp:2', 'kp:1']);
    expect(lib.shows[0].eps[0]).not.toHaveProperty('description');
    expect(db.notes('kp', 'kp:2')).toBe(notes);
    expect(lib.epState).toEqual({ 'kp:kp:2': { played: false, pos: 0, inbox: true }, 'kp:kp:1': library.eps['kp:kp:1'] });
    expect(lib.kv).toMatchObject({ cur: 'kp:kp:1', speed: 1.5, queue: ['kp:kp:2'], ovr: { kp: { speed: '1.2×' } }, folder: '~/Podcasts', trimSaved: 3, directory: { country: 'gb' } });
    expect(lib.kv).not.toHaveProperty('usedBytes');
    expect(lib.kv).not.toHaveProperty('shows');
  });

  it('copes with a library from before every field existed', () => {
    expect(importLegacyLibrary(db, saved({ shows: [{ id: 'a', title: 'A' }], folder: '/x' }, 0))).toEqual({ shows: 1, episodes: 0, states: 0 });
    expect(db.load().shows).toEqual([{ id: 'a', title: 'A', eps: [] }]);
    expect(db.load().kv).toEqual({ folder: '/x' });
  });

  it('skips records that are not shows or episodes rather than failing', () => {
    const odd = { shows: [null, 'x', { title: 'no id' }, { id: 'ok', title: 'OK', eps: [null, { title: 'no guid' }, { guid: 'g', pubDate: 1 }] }], eps: { 'ok:g': 5, 'ok:h': null } };
    expect(importLegacyLibrary(db, saved(odd))).toEqual({ shows: 1, episodes: 1, states: 0 });
  });

  it('writes nothing for text that is not a library, or one from a newer version', () => {
    for (const text of ['', 'not json', '[]', '{}', '{"state":5}', saved(library, 3)]) expect(importLegacyLibrary(db, text)).toBeNull();
    expect(db.isEmpty()).toBe(true);
  });
});
