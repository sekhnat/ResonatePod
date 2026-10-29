import { app, type BrowserWindow, type Tray } from 'electron';
import path from 'node:path';
import type { LibraryDb } from './db/library';
import type { Logger } from './log';

/** What the main process's parts share: the window, the tray, the open library and the log. */
export const ctx = {
  win: null as BrowserWindow | null,
  tray: null as Tray | null,
  /** Set once the app is on its way out, so closing the window closes it instead of hiding it in the tray. */
  quitting: false,
  /** Opened when the app is ready. */
  library: null as LibraryDb | null,
  log: null as Logger | null,
};

export const asset = (name: string) => path.join(__dirname, '..', 'assets', name);
export const dataFile = (name: string) => path.join(app.getPath('userData'), name);

export function showWindow() {
  if (!ctx.win) return;
  ctx.win.show();
  ctx.win.focus();
}
