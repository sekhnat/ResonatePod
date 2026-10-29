import Database from 'better-sqlite3';
import { renameSync } from 'node:fs';
import type { EpisodeRecord, EpStateRecord, LibraryPatch, LibrarySnapshot, ShowRecord } from '../../shared/library';
import { migrate, schemaVersion } from './migrations';

interface EpStateRow { key: string; played: number; pos: number; inbox: number; file: string | null; fileBytes: number | null; playedAt: number | null; lastPlayed: number | null }

/**
 * The library on disk. Changes arrive as patches and are written in one transaction, so a save costs what changed,
 * not the size of the library; the start-up read returns everything except the show notes, which are fetched for
 * one episode at a time.
 */
export class LibraryDb {
  private db: Database.Database;
  private q!: ReturnType<typeof prepareStatements>;

  constructor(file: string) {
    this.db = new Database(file);
    try {
      schemaVersion(this.db); // before anything is written: a file from a newer version is left exactly as it was
      this.db.pragma('page_size = 8192'); // takes effect only on a new file; show notes pack better into bigger pages
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      migrate(this.db);
      this.q = prepareStatements(this.db);
    } catch (err) {
      this.db.close();
      throw err;
    }
  }

  /** True before anything has been saved. */
  isEmpty() {
    return !this.db.prepare('SELECT 1 FROM shows LIMIT 1').get() && !this.db.prepare('SELECT 1 FROM kv LIMIT 1').get();
  }

  /**
   * The whole library as one JSON string (see LibrarySnapshot). The rows already hold JSON, so they are joined, not
   * parsed and built again: the window parses the string once. Sent as an object, the same data would be parsed here
   * and then copied to the window object by object.
   */
  loadJson(): string {
    const shows: { id: string; data: string }[] = [];
    const byId = new Map<string, string[]>();
    for (const r of this.db.prepare('SELECT id, data FROM shows ORDER BY ord').all() as { id: string; data: string }[]) {
      shows.push(r);
      byId.set(r.id, []);
    }
    for (const r of this.db.prepare('SELECT show_id, data FROM episodes ORDER BY show_id, pub_date DESC, guid').iterate() as Iterable<{ show_id: string; data: string }>) {
      byId.get(r.show_id)?.push(r.data);
    }
    // Each data column is a JSON object (JSON.stringify of the record without its id and episodes): reopen it
    // before its closing brace and add the two keys that were left out. A key repeated later in an object wins.
    const showsJson = shows.map(({ id, data }) => {
      const open = data.slice(0, data.lastIndexOf('}')).trimEnd();
      return `${open}${open.length > 1 ? ',' : ''}"id":${JSON.stringify(id)},"eps":[${byId.get(id)!.join(',')}]}`;
    });

    const epState: Record<string, EpStateRecord> = {};
    const states = this.db.prepare('SELECT key, played, pos, inbox, file, file_bytes AS fileBytes, played_at AS playedAt, last_played AS lastPlayed FROM ep_state');
    for (const r of states.iterate() as Iterable<EpStateRow>) {
      const st: EpStateRecord = { played: !!r.played, pos: r.pos, inbox: !!r.inbox };
      if (r.file != null) st.file = r.file;
      if (r.fileBytes != null) st.fileBytes = r.fileBytes;
      if (r.playedAt != null) st.playedAt = r.playedAt;
      if (r.lastPlayed != null) st.lastPlayed = r.lastPlayed;
      epState[r.key] = st;
    }
    const kv = (this.db.prepare('SELECT key, value FROM kv').all() as { key: string; value: string }[])
      .map((r) => `${JSON.stringify(r.key)}:${r.value}`);
    return `{"shows":[${showsJson.join(',')}],"epState":${JSON.stringify(epState)},"kv":{${kv.join(',')}}}`;
  }

  load(): LibrarySnapshot {
    return JSON.parse(this.loadJson()) as LibrarySnapshot;
  }

  /** Show notes for one episode; empty when it has none. */
  notes(showId: string, guid: string): string {
    const row = this.db.prepare('SELECT text FROM notes WHERE show_id = ? AND guid = ?').get(showId, guid) as { text: string } | undefined;
    return row?.text ?? '';
  }

  /** Applies everything or nothing. */
  patch(p: LibraryPatch) {
    this.db.transaction(() => {
      const { q } = this;
      for (const id of p.shows?.delete ?? []) {
        q.deleteShow.run(id);
        q.deleteShowEps.run(id);
        q.deleteShowNotes.run(id);
        // Show ids never contain ':' (keys are "<show id>:<guid>"), so the show's states are the range from "id:" up to "id;".
        q.deleteShowStates.run(`${id}:`, `${id};`);
      }
      for (const show of p.shows?.upsert ?? []) {
        const { id, eps: _eps, ...rest } = show as ShowRecord & { eps?: unknown };
        q.upsertShow.run({ id, data: JSON.stringify(rest) });
      }
      (p.shows?.order ?? []).forEach((id, i) => q.setOrder.run(i, id));

      for (const { show, guid } of p.episodes?.delete ?? []) { q.deleteEp.run(show, guid); q.deleteNotes.run(show, guid); }
      for (const { show, ep } of p.episodes?.upsert ?? []) {
        const { description, ...rest } = ep as EpisodeRecord;
        q.upsertEp.run({ show, guid: ep.guid, pubDate: Number.isFinite(ep.pubDate) ? ep.pubDate : 0, data: JSON.stringify(rest) });
        // Notes that aren't sent stay as they were; empty notes are the same as none.
        if (description) q.setNotes.run(show, ep.guid, description);
        else if (description === '') q.deleteNotes.run(show, ep.guid);
      }

      for (const key of p.epState?.delete ?? []) q.deleteState.run(key);
      for (const [key, st] of Object.entries(p.epState?.upsert ?? {})) {
        q.setState.run({ key, played: st.played ? 1 : 0, pos: st.pos, inbox: st.inbox ? 1 : 0, file: st.file ?? null, fileBytes: st.fileBytes ?? null, playedAt: st.playedAt ?? null, lastPlayed: st.lastPlayed ?? null });
      }

      for (const [key, value] of Object.entries(p.kv ?? {})) {
        if (value === undefined) q.deleteKv.run(key);
        else q.setKv.run(key, JSON.stringify(value));
      }
    })();
  }

  close() { this.db.close(); }
}

/** The statements a save runs, prepared once: a save used to prepare about a dozen of them every time. */
function prepareStatements(db: Database.Database) {
  return {
    deleteShow: db.prepare('DELETE FROM shows WHERE id = ?'),
    deleteShowEps: db.prepare('DELETE FROM episodes WHERE show_id = ?'),
    deleteShowNotes: db.prepare('DELETE FROM notes WHERE show_id = ?'),
    deleteShowStates: db.prepare('DELETE FROM ep_state WHERE key >= ? AND key < ?'),
    upsertShow: db.prepare('INSERT INTO shows (id, ord, data) VALUES (@id, (SELECT COALESCE(MAX(ord), -1) + 1 FROM shows), @data) ON CONFLICT (id) DO UPDATE SET data = excluded.data'),
    setOrder: db.prepare('UPDATE shows SET ord = ? WHERE id = ?'),
    deleteEp: db.prepare('DELETE FROM episodes WHERE show_id = ? AND guid = ?'),
    deleteNotes: db.prepare('DELETE FROM notes WHERE show_id = ? AND guid = ?'),
    upsertEp: db.prepare(`INSERT INTO episodes (show_id, guid, pub_date, data) VALUES (@show, @guid, @pubDate, @data)
      ON CONFLICT (show_id, guid) DO UPDATE SET pub_date = excluded.pub_date, data = excluded.data`),
    setNotes: db.prepare('INSERT INTO notes (show_id, guid, text) VALUES (?, ?, ?) ON CONFLICT (show_id, guid) DO UPDATE SET text = excluded.text'),
    deleteState: db.prepare('DELETE FROM ep_state WHERE key = ?'),
    setState: db.prepare(`INSERT OR REPLACE INTO ep_state (key, played, pos, inbox, file, file_bytes, played_at, last_played)
      VALUES (@key, @played, @pos, @inbox, @file, @fileBytes, @playedAt, @lastPlayed)`),
    setKv: db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)'),
    deleteKv: db.prepare('DELETE FROM kv WHERE key = ?'),
  };
}

/**
 * Opens the library, or starts a new one beside a file that isn't a database any more (the damaged one is kept, renamed,
 * rather than overwritten). A database from a newer version of the app is not touched: that error is passed on.
 */
export function openLibrary(file: string): { db: LibraryDb; recovered?: string } {
  try {
    return { db: new LibraryDb(file) };
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code !== 'SQLITE_NOTADB' && code !== 'SQLITE_CORRUPT') throw err;
    const aside = `${file}.damaged-${Date.now()}`;
    renameSync(file, aside);
    for (const ext of ['-wal', '-shm']) { try { renameSync(file + ext, aside + ext); } catch { /* none */ } }
    return { db: new LibraryDb(file), recovered: aside };
  }
}
