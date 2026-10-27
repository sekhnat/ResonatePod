import type Database from 'better-sqlite3';

/**
 * The schema, one step per version (PRAGMA user_version is the number of steps already applied). Steps are only
 * ever added, never edited, so a database written by any earlier version of the app is brought up to date.
 */
const steps: ((db: Database.Database) => void)[] = [
  // 1: the library. Shows and episodes keep their fields as JSON and index only what they are looked up or ordered by.
  (db) => db.exec(`
    CREATE TABLE shows (
      id    TEXT PRIMARY KEY,
      ord   INTEGER NOT NULL,
      data  TEXT NOT NULL
    );
    CREATE TABLE episodes (
      show_id     TEXT NOT NULL,
      guid        TEXT NOT NULL,
      pub_date    INTEGER NOT NULL,
      data        TEXT NOT NULL,
      PRIMARY KEY (show_id, guid)
    ) WITHOUT ROWID;
    CREATE INDEX episodes_newest ON episodes (show_id, pub_date DESC, guid);
    -- Show notes are large and read one episode at a time, so they are kept out of the episode rows (reading the
    -- library at start-up never walks past them), and in an ordinary rowid table: a row this size in a WITHOUT ROWID
    -- table spills into overflow pages and wastes most of each.
    CREATE TABLE notes (
      id      INTEGER PRIMARY KEY,
      show_id TEXT NOT NULL,
      guid    TEXT NOT NULL,
      text    TEXT NOT NULL,
      UNIQUE (show_id, guid)
    );
    CREATE TABLE ep_state (
      key         TEXT PRIMARY KEY,
      played      INTEGER NOT NULL,
      pos         REAL NOT NULL,
      inbox       INTEGER NOT NULL,
      file        TEXT,
      file_bytes  INTEGER,
      played_at   INTEGER,
      last_played INTEGER
    ) WITHOUT ROWID;
    CREATE TABLE kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) WITHOUT ROWID;
  `),
];

export const SCHEMA_VERSION = steps.length;

/** The schema version the file is at; throws, having changed nothing, when a newer version of the app wrote it. */
export function schemaVersion(db: Database.Database): number {
  const v = db.pragma('user_version', { simple: true }) as number;
  if (v > steps.length) throw new Error(`library.db is from a newer version of Resonate (schema ${v}, this one knows ${steps.length})`);
  return v;
}

export function migrate(db: Database.Database) {
  const from = schemaVersion(db);
  if (from === steps.length) return;
  db.transaction(() => {
    for (let v = from; v < steps.length; v++) steps[v](db);
    db.pragma(`user_version = ${steps.length}`);
  })();
}
