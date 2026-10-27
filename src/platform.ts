import type { Chapter, DownloadEvent, DownloadJob, HttpRequest, HttpResponse, TrayAction, TrayState } from '../shared/types';
import type { ResonateApi } from '../electron/preload';
import { downloadText } from './lib/opml';

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
  http(url: string, req?: HttpRequest): Promise<HttpResponse>;
  loadLibrary(): Promise<string | null>;
  saveLibrary(json: string): Promise<void>;
  mediaUrl(file: string | undefined, url: string): string;
  /** Whether media URLs are same-origin enough for Web Audio analysis (silence trim). */
  canAnalyse: boolean;
  download: {
    start(job: DownloadJob): void;
    cancel(key: string): void;
    setPaused(paused: boolean): void;
    setConcurrency(n: number): void;
    onEvent(cb: (e: DownloadEvent) => void): () => void;
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

function electronPlatform(api: ResonateApi): Platform {
  return {
    isDesktop: true,
    desktop: api.env.desktop,
    hostname: api.env.hostname,
    http: api.http,
    loadLibrary: api.loadLibrary,
    saveLibrary: api.saveLibrary,
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

function browserPlatform(): Platform {
  const auth = new Map<string, string>();
  const origin = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };
  return {
    isDesktop: false,
    desktop: 'KDE',
    hostname: 'browser',
    async http(url, req = {}) {
      const a = auth.get(origin(url));
      const res = await fetch(url, { method: req.method ?? 'GET', headers: { ...(a ? { Authorization: a } : {}), ...req.headers }, body: req.body, signal: AbortSignal.timeout(60_000) });
      return { status: res.status, text: await res.text(), etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined };
    },
    loadLibrary: async () => LS.get('resonate-library'),
    saveLibrary: async (json) => LS.set('resonate-library', json),
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
