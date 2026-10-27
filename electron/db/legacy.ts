import { upgradeOverrides, upgradeSettings } from '../../shared/settings';
import type { EpisodeRecord, EpStateRecord, LibraryPatch, ShowRecord } from '../../shared/library';
import type { LibraryDb } from './library';

/** The saved library before the database: one JSON document, in the envelope zustand's persist middleware wrote. */
interface Envelope { state?: Record<string, unknown>; version?: number }

// Each step brings a state saved at that version up to the next. Versions 0 to 2 differ only in fields this
// import ignores or defaults, so there is nothing to change yet; a step goes here when a later one does.
const steps: Record<number, (state: Record<string, unknown>) => Record<string, unknown>> = {};

const LATEST = 2;

// What the old file held that is not stored: derived or live values (the storage figure is computed from the files now).
const NOT_STORED = new Set(['shows', 'eps', 'pos', 'usedBytes']);

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const isDefaultState = (st: EpStateRecord) =>
  !st.played && !st.pos && !st.inbox && !st.file && st.fileBytes == null && st.playedAt == null && st.lastPlayed == null;

/**
 * Reads the old JSON library into the database in one transaction. Returns what was imported, or null when the text
 * isn't a library (empty, unreadable, a library from a newer version) and nothing was written.
 */
export function importLegacyLibrary(db: LibraryDb, json: string): { shows: number; episodes: number; states: number } | null {
  let env: Envelope;
  try { env = JSON.parse(json) as Envelope; } catch { return null; }
  if (!isRecord(env) || !isRecord(env.state)) return null;
  let version = typeof env.version === 'number' ? env.version : 0;
  if (version > LATEST) return null;
  let state = env.state;
  for (; version < LATEST; version++) state = steps[version]?.(state) ?? state;

  const shows = (Array.isArray(state.shows) ? state.shows : []).filter((s): s is Record<string, unknown> => isRecord(s) && typeof s.id === 'string');
  const patch: LibraryPatch = { shows: { upsert: [], order: [] }, episodes: { upsert: [] }, epState: { upsert: {} }, kv: {} };
  let episodes = 0;
  for (const show of shows) {
    const { eps, ...rest } = show;
    patch.shows!.upsert!.push(rest as ShowRecord);
    patch.shows!.order!.push(show.id as string);
    for (const ep of Array.isArray(eps) ? eps : []) {
      if (!isRecord(ep) || typeof ep.guid !== 'string') continue;
      patch.episodes!.upsert!.push({ show: show.id as string, ep: ep as EpisodeRecord });
      episodes++;
    }
  }
  let states = 0;
  for (const [key, st] of Object.entries(isRecord(state.eps) ? state.eps : {})) {
    if (!isRecord(st) || isDefaultState(st as unknown as EpStateRecord)) continue; // state is kept sparse
    patch.epState!.upsert![key] = st as unknown as EpStateRecord;
    states++;
  }
  for (const [key, value] of Object.entries(state)) if (!NOT_STORED.has(key)) patch.kv![key] = value;
  // The library was saved with these as labels; the database holds them as numbers and names (schema step 2).
  if ('sv' in patch.kv!) patch.kv!.sv = upgradeSettings(patch.kv!.sv);
  if ('ovr' in patch.kv!) patch.kv!.ovr = upgradeOverrides(patch.kv!.ovr);

  db.patch(patch);
  return { shows: shows.length, episodes, states };
}
