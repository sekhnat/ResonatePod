import type { BackupSummary } from '../shared/backup';
import type { LibraryPatch, LibrarySnapshot } from '../shared/library';
import type { Chapter, DownloadMessage, DownloadJob, HttpRequest, HttpResponse, SecretStatus, TrayAction, TrayState } from '../shared/types';
import type { ResonateApi } from '../electron/preload';
import { downloadText } from './lib/opml';
import { MemoryLibrary, type MemoryDump } from './lib/memory-library';

declare global {
  interface Window { resonate?: ResonateApi }
}

/**
 * Everything the renderer needs from the OS. In Electron it goes through the
 * preload bridge; in a plain browser (`vite` dev, tests) it degrades: feeds are
 * fetched directly (subject to CORS), audio streams, and downloads are unavailable.
 */
export interface Platform {
  isDesktop: boolean;
  desktop: 'KDE' | 'GNOME';
  hostname: string;
  /** Aborting `signal` stops the request (and rejects with the signal's reason). */
  http(url: string, req?: HttpRequest, signal?: AbortSignal): Promise<HttpResponse>;
  /** The saved library, read once at start-up (show notes are left out; see libNotes). */
  libLoad(): Promise<LibrarySnapshot>;
  /** Saves what changed, all together or not at all. */
  libPatch(patch: LibraryPatch): Promise<void>;
  /** The show notes of one episode. */
  libNotes(show: string, guid: string): Promise<string>;
  /** Saves a backup of the whole library where the user picks; null when they cancel. */
  backupLibrary(): Promise<BackupSummary | null>;
  /** Asks for a backup file and reads it; the main process keeps it for restoreBackup. Null when the user cancels. */
  chooseBackup(): Promise<BackupSummary | { error: string } | null>;
  /** Replaces the library with the chosen backup and reloads the window; resolves with an error if nothing changed. */
  restoreBackup(): Promise<{ error: string } | null>;
  mediaUrl(file: string | undefined, url: string): string;
  /** Whether media URLs are same-origin enough for Web Audio analysis (silence trim). */
  canAnalyse: boolean;
  download: {
    start(job: DownloadJob): void;
    cancel(key: string): void;
    setPaused(paused: boolean): void;
    setConcurrency(n: number): void;
    onEvent(cb: (e: DownloadMessage) => void): () => void;
  };
  deleteFile(file: string): Promise<void>;
  /** Moves files from one download folder to another; returns the ones that moved. */
  moveFiles(from: string, to: string, files: string[]): Promise<{ from: string; to: string }[]>;
  /** Chapters stored inside the media file (ID3 CHAP / MP4 chpl), from disk or by Range requests. */
  embeddedChapters(file: string | undefined, url: string): Promise<Chapter[] | null>;
  /** HTTP Basic credentials for a feed's origin (also used for its enclosures); null clears them. */
  setFeedAuth(url: string, user: string | null, password: string | null): Promise<void>;
  setAutostart(on: boolean): Promise<void>;
  /** Runs before the app quits, so pending writes reach disk. */
  onFlush(cb: () => Promise<void>): void;
  diskUsage(folder: string): Promise<number>;
  showInFolder(file: string): void;
  openFolder(folder: string): void;
  pickFolder(current: string): Promise<string | null>;
  openOpml(): Promise<{ name: string; text: string } | null>;
  saveOpml(name: string, text: string): Promise<string | null>;
  isMetered(): Promise<boolean | null>;
  /** Records an error the page didn't handle, in the log file (the console in the browser build). */
  logError(message: string, detail?: string): void;
  /** Opens the folder the log files are in. */
  openLogs(): void;
  /** Whether a password saved now would be protected. */
  secretStatus(): Promise<SecretStatus>;
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string | null): Promise<void>;
  updateTray(s: TrayState): void;
  onTrayAction(cb: (a: TrayAction) => void): () => void;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  quit(): void;
}

const LS = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

let httpIds = 0;

function electronPlatform(api: ResonateApi): Platform {
  return {
    isDesktop: true,
    desktop: api.env.desktop,
    hostname: api.env.hostname,
    http: (url, req, signal) => {
      if (!signal) return api.http(url, req);
      if (signal.aborted) return Promise.reject(signal.reason);
      // The request gets a name, so the main process can be told to drop it.
      const id = String(++httpIds);
      return new Promise((resolve, reject) => {
        const stop = () => { api.cancelHttp(id); reject(signal.reason); };
        signal.addEventListener('abort', stop, { once: true });
        api.http(url, req, id).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
      });
    },
    libLoad: async () => JSON.parse(await api.libLoadJson()) as LibrarySnapshot,
    libPatch: api.libPatch,
    libNotes: api.libNotes,
    backupLibrary: api.backupLibrary,
    chooseBackup: api.chooseBackup,
    restoreBackup: api.restoreBackup,
    mediaUrl: (file, url) => (file ? `resonate-media://file/${encodeURIComponent(file)}` : `resonate-media://remote/${encodeURIComponent(url)}`),
    canAnalyse: true,
    download: {
      start: (job) => { void api.download.start(job); },
      cancel: (key) => { void api.download.cancel(key); },
      setPaused: (p) => { void api.download.setPaused(p); },
      setConcurrency: (n) => { void api.download.setConcurrency(n); },
      onEvent: api.download.onEvent,
    },
    deleteFile: api.deleteFile,
    moveFiles: api.moveFiles,
    embeddedChapters: (file, url) => api.embeddedChapters(file ?? null, url),
    setFeedAuth: api.setFeedAuth,
    setAutostart: api.setAutostart,
    onFlush: api.onFlush,
    diskUsage: api.diskUsage,
    showInFolder: (f) => { void api.showInFolder(f); },
    openFolder: (f) => { void api.openFolder(f); },
    pickFolder: api.pickFolder,
    openOpml: api.openOpml,
    saveOpml: api.saveOpml,
    isMetered: api.isMetered,
    logError: api.logError,
    openLogs: () => { void api.openLogs(); },
    secretStatus: api.secretStatus,
    getSecret: api.getSecret,
    setSecret: api.setSecret,
    updateTray: api.updateTray,
    onTrayAction: api.onTrayAction,
    minimize: api.minimize,
    toggleMaximize: api.toggleMaximize,
    close: api.close,
    quit: api.quit,
  };
}

const LIBRARY_KEY = 'resonate-library-v2';

function browserPlatform(): Platform {
  // The browser build keeps the library in memory and saves a copy to localStorage.
  const library = new MemoryLibrary((() => { try { return JSON.parse(LS.get(LIBRARY_KEY) ?? 'null') as MemoryDump | null; } catch { return null; } })());
  const auth = new Map<string, string>();
  const origin = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };
  return {
    isDesktop: false,
    desktop: 'KDE',
    hostname: 'browser',
    async http(url, req = {}, signal) {
      const a = auth.get(origin(url));
      const res = await fetch(url, { method: req.method ?? 'GET', headers: { ...(a ? { Authorization: a } : {}), ...req.headers }, body: req.body, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
      return { status: res.status, text: await res.text(), etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined };
    },
    libLoad: async () => library.load(),
    libPatch: async (patch) => { library.patch(patch); LS.set(LIBRARY_KEY, JSON.stringify(library.dump())); },
    libNotes: async (show, guid) => library.notes(show, guid),
    // Backups are a desktop feature: the browser build keeps its library in localStorage.
    backupLibrary: async () => null,
    chooseBackup: async () => ({ error: 'Backups need the desktop app' }),
    restoreBackup: async () => ({ error: 'Backups need the desktop app' }),
    mediaUrl: (_file, url) => url,
    canAnalyse: false,
    download: { start() {}, cancel() {}, setPaused() {}, setConcurrency() {}, onEvent: () => () => {} },
    deleteFile: async () => {},
    moveFiles: async () => [],
    embeddedChapters: async () => null,
    setFeedAuth: async (url, user, password) => {
      if (user == null) auth.delete(origin(url));
      else auth.set(origin(url), 'Basic ' + btoa(`${user}:${password ?? ''}`));
    },
    setAutostart: async () => {},
    onFlush() {},
    diskUsage: async () => 0,
    showInFolder() {},
    openFolder() {},
    pickFolder: async () => null,
    openOpml: () => new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.opml,.xml,text/xml,text/x-opml';
      input.onchange = async () => {
        const f = input.files?.[0];
        resolve(f ? { name: f.name, text: await f.text() } : null);
      };
      input.click();
    }),
    saveOpml: async (name, text) => { downloadText(name, text); return name; },
    isMetered: async () => null,
    logError: (message, detail) => console.error(message, detail ?? ''),
    openLogs() {},
    secretStatus: async () => ({ secure: false, backend: 'browser' }), // localStorage, in the clear
    getSecret: async (k) => LS.get(`resonate-secret-${k}`),
    setSecret: async (k, v) => LS.set(`resonate-secret-${k}`, v),
    updateTray() {},
    onTrayAction: () => () => {},
    minimize() {},
    toggleMaximize() {},
    close() {},
    quit() {},
  };
}

/** Ceiling for the small side files (chapters, transcripts, directory JSON); feeds get the bridge's own larger one. */
export const SMALL_BODY_BYTES = 5 * 1024 * 1024;

export const platform: Platform = typeof window !== 'undefined' && window.resonate ? electronPlatform(window.resonate) : browserPlatform();
