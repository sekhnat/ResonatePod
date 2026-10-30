import { gunzipSync, gzipSync } from 'node:zlib';
import { BACKUP_EXT, readBackup, type LibraryBackup } from '../shared/backup';

/** A backup file bigger than this isn't read: a library of thousands of shows is a few tens of MB, gzipped. */
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
/** Nor is one that unpacks to more than this (a small file can unpack to gigabytes). */
const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024;

export const encodeBackup = (b: LibraryBackup): Buffer => gzipSync(JSON.stringify(b));

/** The backup in a file's bytes: gzipped (as Resonate writes it) or plain JSON. Throws an error to show as it is. */
export function decodeBackup(bytes: Uint8Array): LibraryBackup {
  let text: string;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      text = gunzipSync(bytes, { maxOutputLength: MAX_UNPACKED_BYTES }).toString('utf8');
    } catch {
      throw new Error('This backup is damaged (it could not be unpacked)');
    }
  } else {
    text = Buffer.from(bytes).toString('utf8');
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error('This file isn’t a Resonate backup'); }
  return readBackup(json);
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export interface Machine {
  /** Whether a downloaded file is in one of this computer's download folders, and still there. */
  hasFile(file: string): Promise<boolean>;
  /** Whether a folder is one of this computer's download folders. */
  isDownloadFolder(folder: string): Promise<boolean>;
  /** The download folder setting now, which a backup's folder gives way to when this computer doesn't allow it. */
  folder: unknown;
  /** Settings that describe this computer, not the library: whether Resonate starts at login, and whether a Podcast Index key is saved. */
  autostart: boolean;
  podcastIndexKey: boolean;
}

/**
 * The library to restore from a backup, fitted to this computer:
 * - a downloaded file is kept only if it is here, in a download folder; otherwise the episode is no longer downloaded;
 * - the download folder is kept only if it is already one of this computer's download folders. Restoring must not widen
 *   where the app may read, write and delete: only the folder dialog can do that (see paths.ts);
 * - start at login and the Podcast Index key are what they are on this computer.
 */
export async function fitToMachine(b: LibraryBackup, m: Machine): Promise<LibraryBackup['library']> {
  const epState = { ...b.library.epState };
  await Promise.all(Object.entries(epState).map(async ([key, st]) => {
    if (st.file === undefined || await m.hasFile(st.file)) return;
    const { file: _file, fileBytes: _bytes, ...rest } = st;
    epState[key] = rest;
  }));
  const kv = { ...b.library.kv };
  if (!(typeof kv.folder === 'string' && await m.isDownloadFolder(kv.folder))) {
    if (m.folder === undefined) delete kv.folder;
    else kv.folder = m.folder;
  }
  // Both are laid over the defaults when the library is read, so the rest of each can be missing.
  kv.tg = { ...asRecord(kv.tg), autostart: m.autostart };
  kv.directory = { ...asRecord(kv.directory), podcastIndex: m.podcastIndexKey };
  // Downloads that were under way when the backup was made start again only for episodes that aren't downloaded here.
  if (Array.isArray(kv.dlPending)) kv.dlPending = kv.dlPending.filter((k) => typeof k === 'string' && !epState[k]?.file);
  return { ...b.library, epState, kv };
}

/** "resonate-backup-2026-10-30.resonate-backup". */
export const backupName = (now = new Date()) =>
  `resonate-backup-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.${BACKUP_EXT}`;
