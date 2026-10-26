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
  description: string;
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
  episodes: Episode[];
}

export interface HttpResponse {
  status: number;
  text: string;
  etag?: string;
  lastModified?: string;
}

export interface HttpRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface DownloadJob {
  key: string;
  url: string;
  folder: string;
  showTitle: string;
  title: string;
  pubDate: number;
  mime: string;
}

export type DownloadEvent =
  | { type: 'progress'; key: string; received: number; total: number; speed: number }
  | { type: 'done'; key: string; path: string; bytes: number }
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
