import type { EpisodeRecord, EpStateRecord, LibraryPatch, LibrarySnapshot, LoadedShow, ShowRecord } from '../../shared/library';

/** What is kept between runs of the browser build: the library as plain JSON. */
export interface MemoryDump {
  shows: ShowRecord[];
  episodes: Record<string, EpisodeRecord[]>;
  epState: Record<string, EpStateRecord>;
  kv: Record<string, unknown>;
}

const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * The library held in memory, for the browser build (which saves a dump of it) and for tests. It behaves like the
 * database in electron/db, and both are held to the same tests (test/library-contract.ts).
 */
export class MemoryLibrary {
  private shows: ShowRecord[] = [];
  private episodes = new Map<string, Map<string, EpisodeRecord>>();
  private state = new Map<string, EpStateRecord>();
  private kv = new Map<string, unknown>();

  constructor(saved?: MemoryDump | null) {
    if (!saved) return;
    this.shows = saved.shows ?? [];
    for (const [show, eps] of Object.entries(saved.episodes ?? {})) this.episodes.set(show, new Map(eps.map((e) => [e.guid, e])));
    this.state = new Map(Object.entries(saved.epState ?? {}));
    this.kv = new Map(Object.entries(saved.kv ?? {}));
  }

  dump(): MemoryDump {
    return {
      shows: this.shows,
      episodes: Object.fromEntries([...this.episodes].map(([show, eps]) => [show, [...eps.values()]])),
      epState: Object.fromEntries(this.state),
      kv: Object.fromEntries(this.kv),
    };
  }

  isEmpty() { return !this.shows.length && !this.kv.size; }

  load(): LibrarySnapshot {
    const shows: LoadedShow[] = this.shows.map((show) => {
      const eps = [...(this.episodes.get(show.id)?.values() ?? [])]
        .sort((a, b) => b.pubDate - a.pubDate || (a.guid < b.guid ? -1 : a.guid > b.guid ? 1 : 0))
        .map(({ description: _notes, ...rest }) => rest);
      return json({ ...show, eps });
    });
    return json({ shows, epState: Object.fromEntries(this.state), kv: Object.fromEntries(this.kv) });
  }

  notes(show: string, guid: string): string {
    return this.episodes.get(show)?.get(guid)?.description ?? '';
  }

  /** Applies everything or nothing: what can't be saved as JSON is found before anything changes. */
  patch(p: LibraryPatch) {
    const removed = Object.entries(p.kv ?? {}).filter(([, v]) => v === undefined).map(([k]) => k);
    const c = json(p);
    for (const id of c.shows?.delete ?? []) {
      this.shows = this.shows.filter((s) => s.id !== id);
      this.episodes.delete(id);
      for (const key of [...this.state.keys()]) if (key.startsWith(`${id}:`)) this.state.delete(key);
    }
    for (const show of c.shows?.upsert ?? []) {
      const { eps: _eps, ...rest } = show as ShowRecord & { eps?: unknown };
      const at = this.shows.findIndex((s) => s.id === show.id);
      if (at >= 0) this.shows[at] = rest;
      else this.shows.push(rest);
    }
    if (c.shows?.order) {
      const rank = new Map(c.shows.order.map((id, i) => [id, i]));
      this.shows = [...this.shows].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
    }
    for (const { show, guid } of c.episodes?.delete ?? []) this.episodes.get(show)?.delete(guid);
    for (const { show, ep } of c.episodes?.upsert ?? []) {
      const eps = this.episodes.get(show) ?? new Map<string, EpisodeRecord>();
      this.episodes.set(show, eps);
      // Show notes that aren't sent stay as they were.
      eps.set(ep.guid, { ...ep, pubDate: Number.isFinite(ep.pubDate) ? ep.pubDate : 0, ...(ep.description === undefined && eps.get(ep.guid)?.description !== undefined ? { description: eps.get(ep.guid)!.description } : {}) });
    }
    for (const key of c.epState?.delete ?? []) this.state.delete(key);
    for (const [key, st] of Object.entries(c.epState?.upsert ?? {})) this.state.set(key, st);
    for (const [key, value] of Object.entries(c.kv ?? {})) this.kv.set(key, value);
    for (const key of removed) this.kv.delete(key);
  }
}
