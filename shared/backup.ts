// A copy of the whole library in one file, to keep somewhere safe or to move to another computer: the shows and their
// episodes, every episode's show notes and state, and the named settings (queue, preferences, sync account ...). It is
// JSON, gzipped on disk, so it doesn't depend on how the database lays the library out. Passwords are not in it: they
// are encrypted with this computer's keyring and couldn't be read anywhere else.

import type { EpStateRecord, LibrarySnapshot } from './library';

export const BACKUP_FORMAT = 'resonate-backup';
export const BACKUP_VERSION = 1;
/** The file name extension, without the dot. */
export const BACKUP_EXT = 'resonate-backup';

export interface BackupNote { show: string; guid: string; text: string }

export interface LibraryBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** The version of Resonate that made it. */
  app: string;
  /** ms since epoch. */
  createdAt: number;
  library: LibrarySnapshot;
  notes: BackupNote[];
}

/** What a backup holds, to ask before restoring it. */
export interface BackupSummary { name: string; app: string; createdAt: number; shows: number; episodes: number }

export const summarise = (b: LibraryBackup, name: string): BackupSummary => ({
  name, app: b.app, createdAt: b.createdAt, shows: b.library.shows.length, episodes: b.library.shows.reduce((n, s) => n + s.eps.length, 0),
});

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optNum = (v: unknown) => v === undefined || isNum(v);

function damaged(what: string): never {
  throw new Error(`This backup is damaged (${what})`);
}

function checkState(key: string, st: unknown): asserts st is EpStateRecord {
  if (!isRecord(st) || typeof st.played !== 'boolean' || !isNum(st.pos) || typeof st.inbox !== 'boolean') damaged(`episode state ${key}`);
  if ((st.file !== undefined && typeof st.file !== 'string') || !optNum(st.fileBytes) || !optNum(st.playedAt) || !optNum(st.lastPlayed)) damaged(`episode state ${key}`);
}

/**
 * The backup in `json` (a parsed file), checked from top to bottom so that restoring it can't fail half way or leave
 * records the app would trip over; throws an error that says what is wrong, in words for the person restoring it.
 */
export function readBackup(json: unknown): LibraryBackup {
  if (!isRecord(json) || json.format !== BACKUP_FORMAT) throw new Error('This file isn’t a Resonate backup');
  if (!isNum(json.version) || json.version < 1) damaged('no version');
  if (json.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of Resonate; update Resonate to restore it');
  if (typeof json.app !== 'string' || !isNum(json.createdAt)) damaged('no date or version');
  const lib = json.library;
  if (!isRecord(lib) || !Array.isArray(lib.shows) || !isRecord(lib.epState) || !isRecord(lib.kv)) damaged('no library');

  const ids = new Set<string>();
  lib.shows.forEach((show: unknown, i) => {
    // Show ids never contain ':': episode keys are "<show id>:<guid>".
    if (!isRecord(show) || typeof show.id !== 'string' || !show.id || show.id.includes(':')) damaged(`show ${i + 1}`);
    if (ids.has(show.id)) damaged(`show ${show.id} twice`);
    ids.add(show.id);
    if (!Array.isArray(show.eps)) damaged(`show ${show.id}`);
    for (const ep of show.eps as unknown[]) {
      if (!isRecord(ep) || typeof ep.guid !== 'string' || !ep.guid || !isNum(ep.pubDate)) damaged(`an episode of ${show.id}`);
    }
  });
  for (const [key, st] of Object.entries(lib.epState)) checkState(key, st);

  if (!Array.isArray(json.notes)) damaged('no show notes');
  for (const n of json.notes as unknown[]) {
    if (!isRecord(n) || typeof n.show !== 'string' || typeof n.guid !== 'string' || typeof n.text !== 'string') damaged('show notes');
  }
  return json as unknown as LibraryBackup;
}
