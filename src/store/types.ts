import type { StateCreator } from 'zustand';
import type { EpisodeAction } from '../../shared/gpodder';
import type { DownloadEvent } from '../../shared/types';
import type { EpisodeMeta, Show } from '../data';
import type { DirectoryResult, SourceChoice } from '../lib/directory';
import type { OpmlFeed } from '../lib/opml';

export type Screen = 'inbox' | 'shows' | 'show' | 'queue' | 'downloads' | 'discover' | 'settings';
export type Filter = 'All' | 'Unplayed' | 'Downloaded';
export const SORTS = ['Newest first', 'Oldest first', 'Longest first', 'Shortest first', 'Title A–Z', 'Title Z–A', 'Unplayed first'] as const;
export type Sort = (typeof SORTS)[number];
/** Sort scope for the Inbox; show ids never contain ':' so it can't collide. */
export const INBOX_SORT = ':inbox';

export interface EpState {
  played: boolean;
  /** Resume position in seconds. */
  pos: number;
  inbox: boolean;
  file?: string;
  fileBytes?: number;
  playedAt?: number;
  lastPlayed?: number;
}
export interface ActiveDl {
  key: string;
  received: number;
  total: number;
  speed: number;
  /** Set while waiting to retry automatically (ms since epoch). */
  retryAt?: number;
  /** A transfer is under way (not waiting for a slot, waiting to retry, or failed). */
  active?: boolean;
  /** Set once retries are exhausted; the row stays until retried or removed. */
  error?: string;
}
export interface DoneDl { key: string; when: number }
export interface Override { dl?: string; speed?: string; trim?: string; intro?: string }
export type Sleep =
  | { mode: 'off' }
  | { mode: 'timer'; minutes: number; remaining: number }
  | { mode: 'chapter' }
  | { mode: 'episode' };
export type DialogKind = 'unsubscribe' | 'folder' | 'storage' | 'sync' | 'shortcuts' | 'about' | 'move' | 'feedAuth' | 'podcastIndex';
export interface DirectoryPrefs {
  /** Apple storefront for charts and search, e.g. "gb". */
  country: string;
  source: SourceChoice;
  /** A Podcast Index key is saved (the key itself lives in secrets). */
  podcastIndex: boolean;
}
export interface Toast { id: number; text: string }
export interface Toggles { auto: boolean; metered: boolean; silence: boolean; notify: boolean; deletePlayed: boolean; autostart: boolean }
export interface SegValues { keep: string; par: string; speed: string; del: string; skip: string }
export interface SyncState {
  server: string;
  user: string;
  device: string;
  subsSince: number;
  actionsSince: number;
  known: string[];
  pending: EpisodeAction[];
  lastSynced: number;
}

export interface Data {
  shows: Show[];
  eps: Record<string, EpState>;
  cur: string | null;
  speed: number;
  volume: number;
  muted: boolean;
  queue: string[];
  dlDone: DoneDl[];
  /** Downloads queued, running or failed; restarted (resuming from the .part file) on launch. */
  dlPending: string[];
  dlPaused: boolean;
  ovr: Record<string, Override>;
  /** Episode sort per show id (and INBOX_SORT); absent means newest first. */
  sorts: Record<string, Sort>;
  tg: Toggles;
  sv: SegValues;
  folder: string;
  storageLimitGb: number;
  sync: SyncState;
  lastChecked: number;
  trimSaved: number;
  directory: DirectoryPrefs;
}

export interface Ui {
  hydrated: boolean;
  playing: boolean;
  dl: ActiveDl[];
  meta: Record<string, EpisodeMeta>;
  /** The current episode has a picture (video podcast). */
  video: boolean;
  /** Folder change waiting on the "move downloaded files?" dialog. */
  pendingMove: { from: string; to: string } | null;
  /** Feed that needs a username and password (the show, when already subscribed). */
  authFor: { url: string; showId?: string } | null;
  metered: boolean | null;
  /** Size of everything in the download folder, from the last scan (null before one). Information only: the limit counts tracked files. */
  folderBytes: number | null;
  /** Silence-trim time saved since the last checkpoint; kept out of the persisted data so it doesn't trigger a save every second. */
  trimPending: number;
  screen: Screen;
  history: { screen: Screen; showId: string }[];
  showId: string;
  filter: Filter;
  cat: string;
  discoverQuery: string;
  npOpen: boolean;
  npFull: boolean;
  cfgOpen: boolean;
  palette: boolean;
  query: string;
  menu: 'main' | 'sleep-bar' | null;
  dialog: DialogKind | null;
  refreshing: boolean;
  syncing: boolean;
  adding: number;
  sleep: Sleep;
  toasts: Toast[];
}

export interface Actions {
  go(screen: Screen, extra?: Partial<Ui>): void;
  goBack(): void;
  openShow(id: string): void;
  set(patch: Partial<Ui>): void;
  toast(text: string): void;
  dismissToast(id: number): void;

  play(key: string): void;
  togglePlay(): void;
  seek(pos: number): void;
  skipBack(): void;
  skipFwd(): void;
  prevChapter(): void;
  nextChapter(): void;
  cycleSpeed(): void;
  setSpeed(speed: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  setSleep(sleep: Sleep): void;
  tick(): void;
  onTime(pos: number): void;
  onDuration(dur: number): void;
  onEnded(): void;
  onPlayError(message: string): void;
  addTrimSaved(sec: number): void;
  loadMeta(key: string): Promise<void>;

  startDownload(key: string): void;
  cancelDownload(key: string): void;
  /** Saves the playback position into the episode record (written to disk with the library). */
  checkpoint(): void;
  moveDownloads(from: string, to: string): Promise<void>;
  signInFeed(url: string, user: string, password: string, showId?: string): Promise<'ok' | 'denied' | 'failed'>;
  deleteFile(key: string, quiet?: boolean): Promise<void>;
  toggleDlPause(): void;
  onDownloadEvent(e: DownloadEvent): void;
  updateUsage(): Promise<void>;
  cleanupStorage(opts?: { quiet?: boolean }): Promise<void>;

  addToQueue(key: string): void;
  removeFromQueue(key: string): void;
  moveQueue(from: number, to: number): void;
  clearQueue(): void;

  markPlayed(key: string, played: boolean): void;
  markAllPlayed(): void;
  refresh(): Promise<void>;

  addFeed(url: string, opts?: { quiet?: boolean }): Promise<string | null>;
  importFeeds(feeds: OpmlFeed[]): Promise<number>;
  unsubscribe(id: string, quiet?: boolean): void;

  setOverride(showId: string, k: keyof Override, v: string): void;
  resetOverride(showId: string): void;
  setSort(scope: string, sort: Sort): void;
  setToggle(k: keyof Toggles): void;
  setSeg(k: keyof SegValues, v: string): void;
  setPrefs(patch: Partial<Pick<Data, 'folder' | 'storageLimitGb'>>): void;

  setDirectory(patch: Partial<DirectoryPrefs>): void;
  setPodcastIndexKey(key: { key: string; secret: string } | null): Promise<void>;
  /** gpodder.net's personal recommendations for the sync account; [] without sync or support. */
  gpodderSuggestions(): Promise<DirectoryResult[]>;

  configureSync(server: string, user: string, password: string): Promise<boolean>;
  disconnectSync(): void;
  runSync(): Promise<void>;
}

export type State = Data & Ui & Actions;

/** One slice of the store: the actions of one area, built with the store's own set and get. */
export type Slice<K extends keyof Actions> = StateCreator<State, [['zustand/subscribeWithSelector', never]], [], Pick<Actions, K>>;
