import { contextBridge, ipcRenderer } from 'electron';
import type { Chapter, DownloadEvent, DownloadJob, HttpRequest, HttpResponse, TrayAction, TrayState } from '../shared/types';
import type { LibraryPatch, LibrarySnapshot } from '../shared/library';

const env = ipcRenderer.sendSync('env') as { desktop: 'KDE' | 'GNOME'; hostname: string };

const api = {
  env,
  http: (url: string, req?: HttpRequest): Promise<HttpResponse> => ipcRenderer.invoke('http', url, req),
  libLoad: (): Promise<LibrarySnapshot> => ipcRenderer.invoke('lib:load'),
  libPatch: (patch: LibraryPatch): Promise<void> => ipcRenderer.invoke('lib:patch', patch),
  libNotes: (show: string, guid: string): Promise<string> => ipcRenderer.invoke('lib:notes', show, guid),
  download: {
    start: (job: DownloadJob) => ipcRenderer.invoke('dl:start', job),
    cancel: (key: string) => ipcRenderer.invoke('dl:cancel', key),
    setPaused: (paused: boolean) => ipcRenderer.invoke('dl:paused', paused),
    setConcurrency: (n: number) => ipcRenderer.invoke('dl:concurrency', n),
    onEvent: (cb: (e: DownloadEvent) => void) => {
      const h = (_: unknown, e: DownloadEvent) => cb(e);
      ipcRenderer.on('dl:event', h);
      return () => ipcRenderer.off('dl:event', h);
    },
  },
  deleteFile: (file: string): Promise<void> => ipcRenderer.invoke('fs:delete', file),
  moveFiles: (from: string, to: string, files: string[]): Promise<{ from: string; to: string }[]> => ipcRenderer.invoke('fs:move', from, to, files),
  embeddedChapters: (file: string | null, url: string): Promise<Chapter[] | null> => ipcRenderer.invoke('media:chapters', file, url),
  setFeedAuth: (url: string, user: string | null, password: string | null): Promise<void> => ipcRenderer.invoke('auth:set', url, user, password),
  setAutostart: (on: boolean): Promise<void> => ipcRenderer.invoke('autostart:set', on),
  onFlush: (cb: () => Promise<void>) => {
    ipcRenderer.on('app:flush', () => { cb().catch(() => {}).finally(() => ipcRenderer.send('app:flushed')); });
  },
  diskUsage: (folder: string): Promise<number> => ipcRenderer.invoke('fs:usage', folder),
  showInFolder: (file: string): Promise<void> => ipcRenderer.invoke('fs:showInFolder', file),
  openFolder: (folder: string): Promise<string> => ipcRenderer.invoke('fs:openFolder', folder),
  pickFolder: (current: string): Promise<string | null> => ipcRenderer.invoke('dialog:folder', current),
  openOpml: (): Promise<{ name: string; text: string } | null> => ipcRenderer.invoke('dialog:openOpml'),
  saveOpml: (name: string, text: string): Promise<string | null> => ipcRenderer.invoke('dialog:saveOpml', name, text),
  isMetered: (): Promise<boolean | null> => ipcRenderer.invoke('net:metered'),
  getSecret: (key: string): Promise<string | null> => ipcRenderer.invoke('secret:get', key),
  setSecret: (key: string, value: string | null): Promise<void> => ipcRenderer.invoke('secret:set', key, value),
  updateTray: (s: TrayState) => ipcRenderer.send('tray:update', s),
  onTrayAction: (cb: (a: TrayAction) => void) => {
    const h = (_: unknown, a: TrayAction) => cb(a);
    ipcRenderer.on('tray:action', h);
    return () => ipcRenderer.off('tray:action', h);
  },
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  quit: () => ipcRenderer.send('app:quit'),
};

export type ResonateApi = typeof api;

contextBridge.exposeInMainWorld('resonate', api);
