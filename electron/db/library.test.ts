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
