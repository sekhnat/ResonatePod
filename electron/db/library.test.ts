import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { libraryContract } from '../../test/library-contract';
import { LibraryDb, openLibrary } from './library';
import { SCHEMA_VERSION } from './migrations';

libraryContract('the SQLite library', () => new LibraryDb(':memory:'));

it('runs under Electron, whose ABI the database is built for', () => {
  expect(process.versions.electron).toBeTruthy();
});

describe('loadJson', () => {
  it('is the library as JSON text, whatever the records hold', () => {
    const db = new LibraryDb(':memory:');
    const tricky = 'He said "hi" \\ \n\t \u2028 \u{1F3A7} é';
    db.patch({
      shows: { upsert: [{ id: 'bare' } as never, { id: 'a"b', title: tricky, hue: 0 }, { id: 'empty', title: '' }] },
      episodes: { upsert: [{ show: 'a"b', ep: { guid: 'g"1', pubDate: 5, title: tricky, duration: 1, enclosureUrl: 'https://x/y.mp3' } }] },
      epState: { upsert: { 'a"b:g"1': { played: true, pos: 2.5, inbox: false, file: '/p/é.mp3' } } },
      kv: { folder: '~/Podcasts', q: ['a"b:g"1'], tg: { auto: true }, n: 0, nothing: null },
    });
    const text = db.loadJson();
    expect(typeof text).toBe('string');
    const snap = JSON.parse(text);
    expect(snap).toEqual(db.load());
    expect(snap.shows.map((s: { id: string }) => s.id)).toEqual(['bare', 'a"b', 'empty']);
    expect(snap.shows[0]).toEqual({ id: 'bare', eps: [] });
    expect(snap.shows[1]).toMatchObject({ id: 'a"b', title: tricky });
    expect(snap.shows[1].eps).toEqual([{ guid: 'g"1', pubDate: 5, title: tricky, duration: 1, enclosureUrl: 'https://x/y.mp3' }]);
    expect(snap.epState['a"b:g"1']).toEqual({ played: true, pos: 2.5, inbox: false, file: '/p/é.mp3' });
    expect(snap.kv).toEqual({ folder: '~/Podcasts', q: ['a"b:g"1'], tg: { auto: true }, n: 0, nothing: null });
    db.close();
  });

  it('is an empty library when nothing was saved', () => {
    const db = new LibraryDb(':memory:');
    expect(JSON.parse(db.loadJson())).toEqual({ shows: [], epState: {}, kv: {} });
    db.close();
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

  it('upgrades settings saved as labels when it moves a version 1 database to 2', () => {
    const file = path.join(dir, 'library.db');
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE shows (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE episodes (show_id TEXT NOT NULL, guid TEXT NOT NULL, pub_date INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (show_id, guid)) WITHOUT ROWID;
      CREATE TABLE notes (id INTEGER PRIMARY KEY, show_id TEXT NOT NULL, guid TEXT NOT NULL, text TEXT NOT NULL, UNIQUE (show_id, guid));
      CREATE TABLE ep_state (key TEXT PRIMARY KEY, played INTEGER NOT NULL, pos REAL NOT NULL, inbox INTEGER NOT NULL, file TEXT, file_bytes INTEGER, played_at INTEGER, last_played INTEGER) WITHOUT ROWID;
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      PRAGMA user_version = 1;
    `);
    const put = raw.prepare('INSERT INTO kv (key, value) VALUES (?, ?)');
    put.run('sv', JSON.stringify({ keep: '5', par: '1', speed: '2×', del: '1 day', skip: '10 / 30 s' }));
    put.run('ovr', JSON.stringify({ a: { dl: 'Latest 1', speed: 'Global', trim: 'On', intro: 'Off' }, b: { dl: 'Global' } }));
    put.run('folder', JSON.stringify('~/Podcasts'));
    raw.close();

    const lib = new LibraryDb(file);
    expect(lib.load().kv).toEqual({
      sv: { keep: 5, par: 1, speed: 2, del: 'day', skip: { back: 10, fwd: 30 } },
      ovr: { a: { dl: 1, trim: true } },
      folder: '~/Podcasts',
    });
    lib.close();
    const check = new Database(file);
    expect(check.pragma('user_version', { simple: true })).toBe(2);
    check.close();
    const again = new LibraryDb(file); // already upgraded: opening it again changes nothing
    expect(again.load().kv.sv).toEqual({ keep: 5, par: 1, speed: 2, del: 'day', skip: { back: 10, fwd: 30 } });
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

describe('backup and restore', () => {
  const fill = (db: LibraryDb) => db.patch({
    shows: { upsert: [{ id: 'kp', title: 'Kernel Panic Hour', persons: [{ name: 'Ines', role: 'host', group: 'cast' }] }, { id: 'lu', title: 'LINUX Unplugged' }], order: ['lu', 'kp'] },
    episodes: { upsert: [
      { show: 'kp', ep: { guid: 'kp:42', pubDate: 2, title: 'Wayland', season: 3, description: 'Screen sharing, portals.' } },
      { show: 'kp', ep: { guid: 'kp:41', pubDate: 1, title: 'Rolling' } },
      { show: 'lu', ep: { guid: 'lu:1', pubDate: 3, title: 'Pilot', description: 'The first one \u{1F3A7}' } },
    ] },
    epState: { upsert: { 'kp:kp:42': { played: true, pos: 0, inbox: false, playedAt: 9 }, 'lu:lu:1': { played: false, pos: 61.5, inbox: true, file: '/p/lu1.mp3', fileBytes: 7 } } },
    kv: { folder: '~/Podcasts', queue: ['lu:lu:1'], sv: { keep: 3 } },
  });

  it('a backup holds the library and every episode’s show notes', () => {
    const db = new LibraryDb(':memory:');
    fill(db);
    const b = db.backup('1.7.0');
    expect(b).toMatchObject({ format: 'resonate-backup', version: 1, app: '1.7.0' });
    expect(b.library).toEqual(db.load());
    expect(b.notes).toEqual([
      { show: 'kp', guid: 'kp:42', text: 'Screen sharing, portals.' },
      { show: 'lu', guid: 'lu:1', text: 'The first one \u{1F3A7}' },
    ]);
    expect(db.setting('folder')).toBe('~/Podcasts');
    expect(db.setting('missing')).toBeUndefined();
    db.close();
  });

  it('restoring replaces everything with the backup, show order and notes included', () => {
    const from = new LibraryDb(':memory:');
    fill(from);
    const b = from.backup('1.7.0');
    const to = new LibraryDb(':memory:');
    to.patch({
      shows: { upsert: [{ id: 'old', title: 'Gone after the restore' }] },
      episodes: { upsert: [{ show: 'old', ep: { guid: 'o', pubDate: 1, description: 'old notes' } }] },
      epState: { upsert: { 'old:o': { played: true, pos: 0, inbox: false } } },
      kv: { folder: '/somewhere', stale: 1 },
    });
    to.replace(b.library, b.notes);
    expect(to.loadJson()).toBe(from.loadJson());
    expect(to.load().shows.map((s) => s.id)).toEqual(['lu', 'kp']);
    expect(to.notes('kp', 'kp:42')).toBe('Screen sharing, portals.');
    expect(to.notes('old', 'o')).toBe('');
    expect([...to.allNotes()]).toEqual(expect.arrayContaining(b.notes)); // written in the shows' order, not the original one
    expect([...to.allNotes()]).toHaveLength(b.notes.length);
    from.close();
    to.close();
  });

  it('a restore that fails part way leaves the library as it was', () => {
    const db = new LibraryDb(':memory:');
    fill(db);
    const before = db.loadJson();
    const b = db.backup('1.7.0');
    // A state the database can't hold (pos is NOT NULL), after everything else has been written.
    const bad = { ...b.library, epState: { ...b.library.epState, 'kp:kp:41': { played: false, pos: null as never, inbox: false } } };
    expect(() => db.replace(bad, b.notes)).toThrow();
    expect(db.loadJson()).toBe(before);
    expect(db.notes('kp', 'kp:42')).toBe('Screen sharing, portals.');
    db.close();
  });

  it('copies the database to a file while it is open', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'resonate-copy-'));
    const db = new LibraryDb(path.join(dir, 'library.db'));
    fill(db);
    const copy = path.join(dir, 'library.db.before-restore');
    await db.copyTo(copy);
    const opened = new LibraryDb(copy);
    expect(opened.loadJson()).toBe(db.loadJson());
    opened.close();
    db.close();
  });
});
