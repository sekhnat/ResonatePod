import type { EpisodeRecord, LibraryPatch, ShowRecord } from '../shared/library';
import type { Show } from './data';
import { platform } from './platform';
import { setPlayhead } from './playhead';
import { getEp, initialData, useStore, type Data, type State } from './store';

/**
 * Saving the library. The renderer keeps it in the store and the main process keeps it in a database; between the
 * two only changes travel. A change is found by comparing, by reference, what the store holds now with what was
 * last saved (state is never edited in place, so a different object means a different value), which costs only as
 * much as what changed and sends a patch of a few hundred bytes for an episode being marked played.
 */

/** The named settings stored beside the library. */
const SETTINGS = (Object.keys(initialData) as (keyof Data)[]).filter((k) => k !== 'shows' && k !== 'eps');
// Settings that gain fields as the app grows: what was saved is laid over the defaults, so a new field has its default.
const MERGED: (keyof Data)[] = ['tg', 'sv', 'directory', 'sync'];

type Saved = Pick<Data, 'shows' | 'eps'> & Record<string, unknown>;

const refs = (s: State): Saved => {
  const out: Saved = { shows: s.shows, eps: s.eps };
  for (const k of SETTINGS) out[k] = s[k];
  return out;
};

const sameFields = (a: object, b: object, skip: string) => {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  keys.delete(skip);
  for (const k of keys) if (x[k] !== y[k]) return false;
  return true;
};

/** What to write to bring the saved library up to date with the store; null when nothing differs. */
export function diffLibrary(prev: Saved, next: Saved): LibraryPatch | null {
  const patch: LibraryPatch = {};

  if (prev.shows !== next.shows) {
    const before = new Map(prev.shows.map((s) => [s.id, s]));
    const ids = next.shows.map((s) => s.id);
    const now = new Set(ids);
    const upsert: ShowRecord[] = [];
    const episodes: NonNullable<LibraryPatch['episodes']> = { upsert: [], delete: [] };
    for (const show of next.shows) {
      const old = before.get(show.id);
      if (old === show) continue;
      const { eps, ...meta } = show;
      if (!old || !sameFields(old, show, 'eps')) upsert.push(meta);
      if (old?.eps === eps) continue;
      const known = new Map((old?.eps ?? []).map((e) => [e.guid, e]));
      const seen = new Set<string>();
      for (const ep of eps) {
        seen.add(ep.guid);
        if (known.get(ep.guid) !== ep) episodes.upsert!.push({ show: show.id, ep: ep as unknown as EpisodeRecord });
      }
      for (const guid of known.keys()) if (!seen.has(guid)) episodes.delete!.push({ show: show.id, guid });
    }
    const gone = [...before.keys()].filter((id) => !now.has(id));
    const reordered = prev.shows.length !== ids.length || prev.shows.some((s, i) => s.id !== ids[i]);
    if (upsert.length || gone.length || reordered) patch.shows = { upsert, delete: gone, ...(reordered ? { order: ids } : {}) };
    if (episodes.upsert!.length || episodes.delete!.length) patch.episodes = episodes;
  }

  if (prev.eps !== next.eps) {
    const upsert: NonNullable<LibraryPatch['epState']>['upsert'] = {};
    const del: string[] = [];
    for (const [key, st] of Object.entries(next.eps)) if (prev.eps[key] !== st) upsert![key] = st;
    for (const key of Object.keys(prev.eps)) if (!(key in next.eps)) del.push(key);
    if (Object.keys(upsert!).length || del.length) patch.epState = { upsert, delete: del };
  }

  const kv: Record<string, unknown> = {};
  for (const k of SETTINGS) if (prev[k] !== next[k]) kv[k] = next[k];
  if (Object.keys(kv).length) patch.kv = kv;

  return Object.keys(patch).length ? patch : null;
}

const SAVE_DELAY = 2000;
let saved: Saved | null = null;
let stop: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();

const changed = (a: Saved, s: State) => a.shows !== s.shows || a.eps !== s.eps || SETTINGS.some((k) => a[k] !== s[k]);

async function save() {
  if (!saved) return;
  const now = refs(useStore.getState());
  const patch = diffLibrary(saved, now);
  if (!patch) return;
  try {
    await platform.libPatch(patch);
    saved = now;
  } catch (err) {
    // Left as it was, so the next save sends this change again along with anything newer.
    console.error('Saving the library failed', err);
  }
}

/** Writes whatever has changed since the last save, now, after any save already under way. */
export function flushSave(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  chain = chain.then(save, save);
  return chain;
}

/**
 * Starts saving from the store as it is now: a change is written after a short wait (one save covers all that
 * happened in it), so the work is bounded however often the store changes.
 */
export function startPersistence() {
  stopPersistence();
  chain = Promise.resolve();
  saved = refs(useStore.getState());
  stop = useStore.subscribe((s) => {
    if (!timer && saved && changed(saved, s)) timer = setTimeout(() => { void flushSave(); }, SAVE_DELAY);
  });
  if (typeof window !== 'undefined') window.addEventListener('pagehide', pagehide);
}

const pagehide = () => { void flushSave(); };

/** Stops saving, and forgets what was waiting to be saved. */
export function stopPersistence() {
  stop?.();
  stop = null;
  saved = null;
  if (timer) { clearTimeout(timer); timer = null; }
  if (typeof window !== 'undefined') window.removeEventListener('pagehide', pagehide);
}

/** Reads the saved library into the store, marks it ready, and starts saving. */
export async function hydrate() {
  let snap;
  try {
    snap = await platform.libLoad();
  } catch (err) {
    // Not saving anything is safer than saving over a library that couldn't be read.
    console.error('Reading the library failed', err);
    stopPersistence();
    useStore.setState({ hydrated: true });
    useStore.getState().toast(`Your library couldn’t be opened (${(err as Error).message}). Changes won’t be saved.`);
    return;
  }
  const settings: Record<string, unknown> = {};
  for (const k of SETTINGS) {
    if (!(k in snap.kv)) continue;
    const value = snap.kv[k];
    settings[k] = MERGED.includes(k) && value && typeof value === 'object' ? { ...(initialData[k] as object), ...value } : value;
  }
  const shows = snap.shows as unknown as Show[];
  useStore.setState({ ...settings, shows, eps: snap.epState as Data['eps'], hydrated: true, showId: shows[0]?.id ?? '' });
  const s = useStore.getState();
  setPlayhead(s.cur ? getEp(s, s.cur).pos : 0);
  startPersistence();
}
