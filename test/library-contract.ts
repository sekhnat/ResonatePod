import { beforeEach, describe, expect, it } from 'vitest';
import type { EpisodeRecord, LibraryPatch, LibrarySnapshot } from '../shared/library';

/** The library store the app saves through: the database in the main process, or the in-memory one in the browser build. */
export interface LibraryStore {
  isEmpty(): boolean;
  load(): LibrarySnapshot;
  patch(p: LibraryPatch): void;
  notes(show: string, guid: string): string;
}

const ep = (guid: string, pubDate: number, extra: Partial<EpisodeRecord> = {}): EpisodeRecord => ({ guid, pubDate, title: `Episode ${guid}`, duration: 60, enclosureUrl: `https://cdn.example/${guid}.mp3`, ...extra });
const notes = 'Show notes with <b>markup</b> and a long list of links.';

/** What any implementation must do, so a test that runs against one is a statement about the other. */
export function libraryContract(name: string, make: () => LibraryStore) {
  let db: LibraryStore;
  beforeEach(() => { db = make(); });

  describe(`${name} behaves as a library store`, () => {
  it('is empty until something is saved', () => {
    expect(db.isEmpty()).toBe(true);
    expect(db.load()).toEqual({ shows: [], epState: {}, kv: {} });
    db.patch({ kv: { folder: '~/Podcasts' } });
    expect(db.isEmpty()).toBe(false);
  });

  it('stores shows in the order given and their episodes newest first, without show notes', () => {
    db.patch({
      shows: { upsert: [{ id: 'a', title: 'A', hue: 10 }, { id: 'b', title: 'B', hue: 20 }, { id: 'c', title: 'C', hue: 30 }], order: ['b', 'c', 'a'] },
      episodes: { upsert: [
        { show: 'a', ep: ep('old', 100, { description: notes }) },
        { show: 'a', ep: ep('new', 300, { description: notes }) },
        { show: 'a', ep: ep('mid', 200) },
        { show: 'b', ep: ep('only', 50) },
      ] },
    });
    const { shows } = db.load();
    expect(shows.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(shows[2]).toMatchObject({ id: 'a', title: 'A', hue: 10 });
    expect(shows[2].eps.map((e) => e.guid)).toEqual(['new', 'mid', 'old']);
    expect(shows[2].eps[0]).toEqual({ guid: 'new', pubDate: 300, title: 'Episode new', duration: 60, enclosureUrl: 'https://cdn.example/new.mp3' }); // no description
    expect(shows[0].eps).toHaveLength(1);
    expect(shows[1].eps).toEqual([]);
    expect(db.notes('a', 'new')).toBe(notes);
    expect(db.notes('a', 'mid')).toBe('');
    expect(db.notes('a', 'missing')).toBe('');
  });

  it('puts a show added later at the end, and keeps notes when an episode is updated without them', () => {
    db.patch({ shows: { upsert: [{ id: 'a', title: 'A' }] }, episodes: { upsert: [{ show: 'a', ep: ep('x', 1, { description: notes }) }] } });
    db.patch({ shows: { upsert: [{ id: 'b', title: 'B' }, { id: 'a', title: 'A renamed' }] } });
    expect(db.load().shows.map((s) => `${s.id}:${s.title}`)).toEqual(['a:A renamed', 'b:B']);
    db.patch({ episodes: { upsert: [{ show: 'a', ep: ep('x', 1, { duration: 999 }) }] } }); // e.g. the player measured a duration
    expect(db.load().shows[0].eps[0].duration).toBe(999);
    expect(db.notes('a', 'x')).toBe(notes);
    db.patch({ episodes: { upsert: [{ show: 'a', ep: ep('x', 1, { description: 'edited' }) }] } });
    expect(db.notes('a', 'x')).toBe('edited');
  });

  it('removes a show with its episodes and their state, and nothing of another show', () => {
    db.patch({
      shows: { upsert: [{ id: 'a' }, { id: 'ab' }] },
      episodes: { upsert: [{ show: 'a', ep: ep('1', 1) }, { show: 'ab', ep: ep('1', 1) }] },
      epState: { upsert: { 'a:1': { played: true, pos: 0, inbox: false }, 'a:https://x/2': { played: false, pos: 5, inbox: false }, 'ab:1': { played: true, pos: 0, inbox: false } } },
    });
    db.patch({ shows: { delete: ['a'] } });
    const lib = db.load();
    expect(lib.shows.map((s) => s.id)).toEqual(['ab']);
    expect(lib.shows[0].eps).toHaveLength(1);
    expect(Object.keys(lib.epState)).toEqual(['ab:1']);
  });

  it('deletes single episodes', () => {
    db.patch({ shows: { upsert: [{ id: 'a' }] }, episodes: { upsert: [{ show: 'a', ep: ep('1', 1) }, { show: 'a', ep: ep('2', 2) }] } });
    db.patch({ episodes: { delete: [{ show: 'a', guid: '1' }] } });
    expect(db.load().shows[0].eps.map((e) => e.guid)).toEqual(['2']);
  });

  it('round-trips episode state, leaving out what is not set', () => {
    const full = { played: true, pos: 12.5, inbox: true, file: '/p/a.mp3', fileBytes: 1234, playedAt: 5, lastPlayed: 6 };
    const bare = { played: false, pos: 0, inbox: true };
    db.patch({ epState: { upsert: { 'a:1': full, 'a:2': bare } } });
    expect(db.load().epState).toEqual({ 'a:1': full, 'a:2': bare });
    db.patch({ epState: { upsert: { 'a:1': { played: false, pos: 3, inbox: false } }, delete: ['a:2'] } });
    expect(db.load().epState).toEqual({ 'a:1': { played: false, pos: 3, inbox: false } });
  });

  it('stores named settings as JSON, and removes one set to undefined', () => {
    db.patch({ kv: { cur: null, queue: ['a:1', 'a:2'], tg: { auto: true }, speed: 1.2 } });
    expect(db.load().kv).toEqual({ cur: null, queue: ['a:1', 'a:2'], tg: { auto: true }, speed: 1.2 });
    db.patch({ kv: { queue: undefined, speed: 1.5 } });
    expect(db.load().kv).toEqual({ cur: null, tg: { auto: true }, speed: 1.5 });
  });

  it('applies a patch all together or not at all', () => {
    db.patch({ kv: { keep: 'me' } });
    expect(() => db.patch({ kv: { first: 1, second: 10n as unknown as number }, epState: { upsert: { 'a:1': { played: true, pos: 0, inbox: false } } } })).toThrow();
    expect(db.load()).toEqual({ shows: [], epState: {}, kv: { keep: 'me' } });
  });
});
}
