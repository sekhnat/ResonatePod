import { app, BrowserWindow, crashReporter, ipcMain, protocol, screen, shell } from 'electron';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { createLogger } from './log';
import { openLibrary } from './db/library';
import { importLegacyLibrary } from './db/legacy';
import { asset, ctx, dataFile, showWindow } from './context';
import { loadCredentials } from './credentials';
import { DownloadManager } from './downloads';
import { writeFileAtomicSync } from './files';
import { fetchFollowing } from './http';
import { registerIpc } from './ipc';
import { DownloadRoots, rootsFromLibrary } from './paths';
import { registerMediaProtocol } from './protocol';
import { createTray } from './tray';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const USER_DATA = process.env.RESONATE_USER_DATA;
if (USER_DATA) app.setPath('userData', USER_DATA);
app.setName('Resonate');

// What goes wrong is written to <config>/logs/main.log (rotated) as well as to the console, so a bug report can include it.
function startLogging() {
  const log = (ctx.log = createLogger(app.getPath('logs')));
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => { original(...args); (level === 'log' || level === 'info' ? log.info : level === 'warn' ? log.warn : log.error)(...args); };
  }
  process.on('uncaughtException', (err) => { log.error('uncaught exception', err); });
  process.on('unhandledRejection', (reason) => { log.error('unhandled rejection', reason); });
  // Crash dumps stay on this computer: nothing is ever sent anywhere.
  crashReporter.start({ uploadToServer: false, compress: true });
  log.info(`Resonate ${app.getVersion()} started (Electron ${process.versions.electron}, ${process.platform} ${process.arch})`);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'resonate-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } },
]);

const downloads = new DownloadManager((url, init) => fetchFollowing(url, init));

// Where the renderer is allowed to read, delete and download files (see paths.ts). Made here, after the user-data path is set.
const roots = new DownloadRoots(dataFile('main-settings.json'), '~/Podcasts');

// ---------- window state ----------

interface WinState { x?: number; y?: number; width: number; height: number; maximized: boolean }

function loadWinState(): WinState {
  const fallback = { width: 1280, height: 800, maximized: false };
  try {
    const st = JSON.parse(readFileSync(dataFile('window.json'), 'utf8')) as WinState;
    if (!(st.width > 0 && st.height > 0)) return fallback;
    if (st.x == null || st.y == null) return { ...fallback, ...st, x: undefined, y: undefined };
    // Only reuse the position if it's still on a connected display.
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      st.x! < a.x + a.width - 40 && st.x! + st.width > a.x + 40 && st.y! < a.y + a.height - 40 && st.y! + st.height > a.y);
    return visible ? st : { ...st, x: undefined, y: undefined };
  } catch {
    return fallback;
  }
}

function saveWinState() {
  if (!ctx.win || ctx.win.isDestroyed()) return;
  const b = ctx.win.getNormalBounds();
  const st: WinState = { ...b, maximized: ctx.win.isMaximized() };
  try { writeFileAtomicSync(dataFile('window.json'), JSON.stringify(st)); } catch { /* not fatal */ }
}

function createWindow() {
  const st = loadWinState();
  ctx.win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width, height: st.height, minWidth: 980, minHeight: 620,
    frame: false, show: false, backgroundColor: '#161826', title: 'Resonate',
    icon: asset('icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (st.maximized) ctx.win.maximize();
  ctx.win.once('ready-to-show', () => {
    console.log(`Window ready to show ${Math.round(process.uptime() * 1000)} ms after launch`);
    if (!process.argv.includes('--hidden') || !ctx.tray) ctx.win?.show();
  });
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const queueSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveWinState, 500); };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) ctx.win.on(ev as 'resize', queueSave);
  ctx.win.on('close', (e) => {
    clearTimeout(saveTimer);
    saveWinState();
    if (!ctx.quitting && ctx.tray) { e.preventDefault(); ctx.win?.hide(); }
  });
  ctx.win.on('closed', () => { ctx.win = null; });
  ctx.win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  ctx.win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(DEV_URL ?? 'file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  if (DEV_URL) ctx.win.loadURL(DEV_URL);
  else ctx.win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// ---------- lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    startLogging();
    // Reading the keyring can take a while (or wait for an unlock), and nothing on screen needs it: the window opens
    // first, and what needs the logins or the download folders waits for them (loadCredentials, roots).
    const t0 = Date.now();
    void loadCredentials(); // settles when the logins are read; the requests that may carry one wait for it
    const rootsReady = roots.load(() => fs.readFile(dataFile('library.json'), 'utf8').then(rootsFromLibrary, () => []));
    const opened = openLibrary(dataFile('library.db'));
    const library = (ctx.library = opened.db);
    if (opened.recovered) console.warn(`library.db was damaged; kept as ${opened.recovered} and started a new library`);
    // A library saved by an older version (one JSON file) moves into the database once, and the file is kept as a backup.
    if (library.isEmpty()) {
      const legacy = await fs.readFile(dataFile('library.json'), 'utf8').catch(() => null);
      const imported = legacy ? importLegacyLibrary(library, legacy) : null;
      if (imported) {
        await rootsReady; // the folders it adopts are read from the file that is about to be renamed
        await fs.rename(dataFile('library.json'), dataFile('library.json.bak'));
        console.log(`Imported library.json: ${imported.shows} shows, ${imported.episodes} episodes, ${imported.states} episode states (kept as library.json.bak)`);
      }
    }
    registerMediaProtocol(roots);
    registerIpc({ roots, downloads });
    createWindow();
    if (!process.env.RESONATE_NO_TRAY) createTray();
    console.log(`Window created ${Date.now() - t0} ms after the app was ready`);
    void rootsReady.catch((err) => console.warn('Download folders could not be read:', err));
  });
  // Give the renderer a moment to write the library (and the playback position) before quitting.
  let flushed = false;
  app.on('before-quit', (e) => {
    ctx.quitting = true;
    if (flushed || !ctx.win || ctx.win.isDestroyed() || ctx.win.webContents.isDestroyed()) return;
    e.preventDefault();
    const done = () => { if (flushed) return; flushed = true; app.quit(); };
    ipcMain.once('app:flushed', done);
    setTimeout(done, 2000);
    ctx.win.webContents.send('app:flush');
  });
  app.on('will-quit', () => { ctx.library?.close(); ctx.library = null; });
  app.on('activate', showWindow);
}
