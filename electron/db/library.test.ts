import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EpisodeRecord } from '../../shared/library';
import { LibraryDb, openLibrary } from './library';
import { SCHEMA_VERSION } from './migrations';

const ep = (guid: string, pubDate: number, extra: Partial<EpisodeRecord> = {}): EpisodeRecord => ({ guid, pubDate, title: `Episode ${guid}`, duration: 60, enclosureUrl: `https://cdn.example/${guid}.mp3`, ...extra });
const notes = 'Show notes with <b>markup</b> and a long list of links.';

let db: LibraryDb;
beforeEach(() => { db = new LibraryDb(':memory:'); });

describe('the library database', () => {
  it('is empty until something is saved, and runs under Electron', () => {
    expect(process.versions.electron).toBeTruthy();
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

describe('the database file', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'res-db-')); });

  it('keeps what was saved across a reopen, at the current schema version', () => {
    const file = path.join(dir, 'library.db');
    const first = new LibraryDb(file);
    first.patch({ shows: { upsert: [{ id: 'a', title: 'A' }] }, kv: { folder: '/x' } });
    first.close();
    const raw = new Database(file);
    expect(raw.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(raw.pragma('journal_mode', { simple: true })).toBe('wal');
    raw.close();
    const again = new LibraryDb(file);
    expect(again.load().kv).toEqual({ folder: '/x' });
    expect(again.load().shows[0]).toMatchObject({ id: 'a', title: 'A' });
    again.close();
  });

  it('refuses a database from a newer version rather than touching it', () => {
    const file = path.join(dir, 'library.db');
    const raw = new Database(file);
    raw.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    raw.close();
    expect(() => openLibrary(file)).toThrow(/newer version/);
    expect(readdirSync(dir)).toEqual(['library.db']);
  });

  it('sets a file that is not a database aside and starts a new library', () => {
    const file = path.join(dir, 'library.db');
    writeFileSync(file, 'this is not a database, but it is long enough for sqlite to look at '.repeat(20));
    const { db: fresh, recovered } = openLibrary(file);
    expect(recovered).toMatch(/library\.db\.damaged-\d+$/);
    expect(existsSync(recovered!)).toBe(true);
    expect(fresh.isEmpty()).toBe(true);
    fresh.patch({ kv: { ok: true } });
    expect(fresh.load().kv).toEqual({ ok: true });
    fresh.close();
  });
});
