// Types shared by the Electron main process and the renderer.

export interface Chapter {
  t: string;
  /** Start time in seconds. */
  at: number;
}

export interface TranscriptLine {
  who: string;
  text: string;
  at: number;
}

/** `podcast:person`: someone who makes or appears on a show or an episode. */
export interface Person {
  name: string;
  /** Lowercased, as the Podcasting 2.0 taxonomy spells it: "host", "guest", "producer"… */
  role: string;
  group: string;
  img?: string;
  href?: string;
}

/** `podcast:funding`: where listeners can support the show. */
export interface Funding { url: string; label: string }

/** `podcast:soundbite`: a highlight the publisher picked, `dur` seconds from `at`. */
export interface Soundbite { at: number; dur: number; title: string }

/** `podcast:license`. */
export interface License { name: string; url?: string }

export interface Episode {
  guid: string;
  title: string;
  /** Publication time, ms since epoch. */
  pubDate: number;
  /** Seconds; 0 when the feed doesn't say (the player fills it in). */
  duration: number;
  enclosureUrl: string;
  enclosureType: string;
  sizeBytes: number;
  /** Show notes. Held only until they are saved: the database keeps them, and an episode loaded from it has none (see libNotes). */
  description?: string;
  link?: string;
  imageUrl?: string;
  chaptersUrl?: string;
  transcriptUrl?: string;
  transcriptType?: string;
  inlineChapters?: Chapter[];
  season?: number;
  /** The episode's number (`podcast:episode` may be a decimal, such as 12.5). */
  epNum?: number;
  /** `itunes:episodeType`, kept only when it isn't a full episode. */
  episodeType?: 'trailer' | 'bonus';
  /** The episode's own people; when absent, the show's apply. */
  persons?: Person[];
  soundbites?: Soundbite[];
  location?: string;
}

export interface Feed {
  title: string;
  author: string;
  description: string;
  imageUrl?: string;
  link?: string;
  category: string;
  /** `itunes:new-feed-url`: the publisher moved the feed here. */
  newFeedUrl?: string;
  persons?: Person[];
  funding?: Funding[];
  location?: string;
  license?: License;
  /** `podcast:guid`: the show's identity, which stays the same when the feed moves. */
  podcastGuid?: string;
  episodes: Episode[];
}

/** Whether passwords saved on this computer would be protected (see electron/secrets.ts). */
export interface SecretStatus {
  secure: boolean;
  /** What keeps them: a keyring's name, "system", "basic_text" (no keyring) or "none". */
  backend: string;
}

export interface HttpResponse {
  status: number;
  text: string;
  etag?: string;
  lastModified?: string;
  /** Set when every redirect on the way was permanent (301/308): the resource now lives here. */
  movedTo?: string;
}

export interface HttpRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Give up on a response bigger than this. The bridge enforces its own ceiling whatever is asked. */
  maxBytes?: number;
}

export interface DownloadJob {
  key: string;
  url: string;
  folder: string;
  showTitle: string;
  title: string;
  pubDate: number;
  mime: string;
  /** Set when another episode would get the same file name, so neither overwrites the other. */
  suffix?: string;
}

export interface DownloadProgress { key: string; received: number; total: number; speed: number }

export type DownloadEvent =
  | ({ type: 'progress' } & DownloadProgress)
  | { type: 'done'; key: string; path: string; bytes: number }
  | { type: 'retry'; key: string; attempt: number; at: number; message: string }
  /** The job is waiting for a free slot (a due retry, or one pushed out by pause or a lower limit). */
  | { type: 'requeue'; key: string }
  | { type: 'error'; key: string; message: string };

/** What the window receives: the manager's events, except that progress comes as one batch for every download that moved. */
export type DownloadMessage = DownloadEvent | { type: 'progressBatch'; items: DownloadProgress[] };

export interface TrayState {
  title: string;
  show: string;
  playing: boolean;
  speed: number;
  sleep: string;
  upNext: { key: string; title: string }[];
  downloads: string;
  dlPaused: boolean;
}

export type TrayAction =
  | { type: 'toggle' | 'back' | 'fwd' | 'speed' | 'refresh' | 'dlPause' }
  | { type: 'play'; key: string }
  | { type: 'sleep'; mode: 'off' | 'chapter' | 'episode' | number };
