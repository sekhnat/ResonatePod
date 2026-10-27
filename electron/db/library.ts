import Database from 'better-sqlite3';
import { renameSync } from 'node:fs';
import type { EpisodeRecord, EpStateRecord, LibraryPatch, LibrarySnapshot, LoadedShow, ShowRecord } from '../../shared/library';
import { migrate, schemaVersion } from './migrations';

interface EpStateRow { key: string; played: number; pos: number; inbox: number; file: string | null; fileBytes: number | null; playedAt: number | null; lastPlayed: number | null }

/**
 * The library on disk. Changes arrive as patches and are written in one transaction, so a save costs what changed,
 * not the size of the library; the start-up read returns everything except the show notes, which are fetched for
 * one episode at a time.
 */
export class LibraryDb {
  private db: Database.Database;

  constructor(file: string) {
    this.db = new Database(file);
    try {
      schemaVersion(this.db); // before anything is written: a file from a newer version is left exactly as it was
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      migrate(this.db);
    } catch (err) {
      this.db.close();
      throw err;
    }
  }

  /** True before anything has been saved. */
  isEmpty() {
    return !this.db.prepare('SELECT 1 FROM shows LIMIT 1').get() && !this.db.prepare('SELECT 1 FROM kv LIMIT 1').get();
  }

  load(): LibrarySnapshot {
    const shows: LoadedShow[] = [];
    const byId = new Map<string, LoadedShow>();
    for (const r of this.db.prepare('SELECT id, data FROM shows ORDER BY ord').all() as { id: string; data: string }[]) {
      const show: LoadedShow = { ...JSON.parse(r.data), id: r.id, eps: [] };
      shows.push(show);
      byId.set(r.id, show);
    }
    for (const r of this.db.prepare('SELECT show_id, data FROM episodes ORDER BY show_id, pub_date DESC, guid').iterate() as Iterable<{ show_id: string; data: string }>) {
      byId.get(r.show_id)?.eps.push(JSON.parse(r.data));
    }
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
    const kv: Record<string, unknown> = {};
    for (const r of this.db.prepare('SELECT key, value FROM kv').all() as { key: string; value: string }[]) kv[r.key] = JSON.parse(r.value);
    return { shows, epState, kv };
  }

  /** Show notes for one episode; empty when it has none. */
  notes(showId: string, guid: string): string {
    const row = this.db.prepare('SELECT description FROM episodes WHERE show_id = ? AND guid = ?').get(showId, guid) as { description: string | null } | undefined;
    return row?.description ?? '';
  }

  /** Applies everything or nothing. */
  patch(p: LibraryPatch) {
    this.db.transaction(() => {
      const { db } = this;
      for (const id of p.shows?.delete ?? []) {
        db.prepare('DELETE FROM shows WHERE id = ?').run(id);
        db.prepare('DELETE FROM episodes WHERE show_id = ?').run(id);
        // Show ids never contain ':' (keys are "<show id>:<guid>"), so the show's states are the range from "id:" up to "id;".
        db.prepare('DELETE FROM ep_state WHERE key >= ? AND key < ?').run(`${id}:`, `${id};`);
      }
      const upsertShow = db.prepare('INSERT INTO shows (id, ord, data) VALUES (@id, (SELECT COALESCE(MAX(ord), -1) + 1 FROM shows), @data) ON CONFLICT (id) DO UPDATE SET data = excluded.data');
      for (const show of p.shows?.upsert ?? []) {
        const { id, eps: _eps, ...rest } = show as ShowRecord & { eps?: unknown };
        upsertShow.run({ id, data: JSON.stringify(rest) });
      }
      const setOrder = db.prepare('UPDATE shows SET ord = ? WHERE id = ?');
      (p.shows?.order ?? []).forEach((id, i) => setOrder.run(i, id));

      const deleteEp = db.prepare('DELETE FROM episodes WHERE show_id = ? AND guid = ?');
      for (const { show, guid } of p.episodes?.delete ?? []) deleteEp.run(show, guid);
      const upsertEp = db.prepare(`INSERT INTO episodes (show_id, guid, pub_date, data, description) VALUES (@show, @guid, @pubDate, @data, @description)
        ON CONFLICT (show_id, guid) DO UPDATE SET pub_date = excluded.pub_date, data = excluded.data, description = COALESCE(excluded.description, description)`);
      for (const { show, ep } of p.episodes?.upsert ?? []) {
        const { description, ...rest } = ep as EpisodeRecord;
        upsertEp.run({ show, guid: ep.guid, pubDate: Number.isFinite(ep.pubDate) ? ep.pubDate : 0, data: JSON.stringify(rest), description: description ?? null });
      }

      const deleteState = db.prepare('DELETE FROM ep_state WHERE key = ?');
      for (const key of p.epState?.delete ?? []) deleteState.run(key);
      const setState = db.prepare(`INSERT OR REPLACE INTO ep_state (key, played, pos, inbox, file, file_bytes, played_at, last_played)
        VALUES (@key, @played, @pos, @inbox, @file, @fileBytes, @playedAt, @lastPlayed)`);
      for (const [key, st] of Object.entries(p.epState?.upsert ?? {})) {
        setState.run({ key, played: st.played ? 1 : 0, pos: st.pos, inbox: st.inbox ? 1 : 0, file: st.file ?? null, fileBytes: st.fileBytes ?? null, playedAt: st.playedAt ?? null, lastPlayed: st.lastPlayed ?? null });
      }

      const setKv = db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
      const deleteKv = db.prepare('DELETE FROM kv WHERE key = ?');
      for (const [key, value] of Object.entries(p.kv ?? {})) {
        if (value === undefined) deleteKv.run(key);
        else setKv.run(key, JSON.stringify(value));
      }
    })();
  }

  close() { this.db.close(); }
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
