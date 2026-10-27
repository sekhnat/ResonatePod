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

export type DownloadEvent =
  | { type: 'progress'; key: string; received: number; total: number; speed: number }
  | { type: 'done'; key: string; path: string; bytes: number }
  | { type: 'retry'; key: string; attempt: number; at: number; message: string }
  /** The job is waiting for a free slot (a due retry, or one pushed out by pause or a lower limit). */
  | { type: 'requeue'; key: string }
  | { type: 'error'; key: string; message: string };

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
