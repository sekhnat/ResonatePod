// The library as the main process stores it (a SQLite database) and as it crosses the preload bridge. The renderer
// keeps its own richer types; here a show and an episode are records with a few known fields, because the database
// only needs those to index and order them and keeps the rest as JSON.

/** A show without its episodes. */
export interface ShowRecord { id: string; [field: string]: unknown }

/** An episode. Show notes (`description`) are stored beside it, and left out when the library is loaded. */
export interface EpisodeRecord { guid: string; pubDate: number; description?: string; [field: string]: unknown }

/** What has happened to an episode. An episode with no record is in the default state. */
export interface EpStateRecord {
  played: boolean;
  pos: number;
  inbox: boolean;
  file?: string;
  fileBytes?: number;
  playedAt?: number;
  lastPlayed?: number;
}

export interface LoadedShow extends ShowRecord { eps: Omit<EpisodeRecord, 'description'>[] }

/** The whole library, as read at start-up: episodes newest first, without their show notes. */
export interface LibrarySnapshot {
  shows: LoadedShow[];
  /** Keyed by `<show id>:<guid>`. */
  epState: Record<string, EpStateRecord>;
  /** Everything else (preferences, queue, sync state ...), by name. */
  kv: Record<string, unknown>;
}

/** Changes to apply together, in one transaction. */
export interface LibraryPatch {
  shows?: {
    upsert?: ShowRecord[];
    delete?: string[];
    /** Show ids in display order; applied after the upserts and deletes. */
    order?: string[];
  };
  episodes?: {
    /** An episode whose `description` is absent keeps the show notes already stored. */
    upsert?: { show: string; ep: EpisodeRecord }[];
    delete?: { show: string; guid: string }[];
  };
  epState?: {
    upsert?: Record<string, EpStateRecord>;
    delete?: string[];
  };
  /** Set these names; a value of `undefined` removes the name. */
  kv?: Record<string, unknown>;
}
