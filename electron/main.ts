import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, safeStorage, shell, Tray } from 'electron';
import { execFile } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { DownloadJob, HttpRequest, HttpResponse, TrayAction, TrayState } from '../shared/types';
import { DownloadManager, diskUsage, expandHome } from './downloads';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const USER_DATA = process.env.RESONATE_USER_DATA;
if (USER_DATA) app.setPath('userData', USER_DATA);
app.setName('Resonate');

protocol.registerSchemesAsPrivileged([
  { scheme: 'resonate-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } },
]);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
const downloads = new DownloadManager((url, init) => net.fetch(url, init as RequestInit));

const asset = (name: string) => path.join(__dirname, '..', 'assets', name);
const dataFile = (name: string) => path.join(app.getPath('userData'), name);

function desktop(): 'KDE' | 'GNOME' {
  const d = (process.env.XDG_CURRENT_DESKTOP ?? '').toUpperCase();
  if (d.includes('KDE')) return 'KDE';
  if (d) return 'GNOME';
  return 'KDE';
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 980, minHeight: 620,
    frame: false, show: false, backgroundColor: '#161826', title: 'Resonate',
    icon: asset('icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win?.show(); });
  win.on('close', (e) => { if (!quitting && tray) { e.preventDefault(); win?.hide(); } });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(DEV_URL ?? 'file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

// ---------- media protocol: local files and proxied streams, with Range support ----------

async function serveFile(file: string, range: string | null): Promise<Response> {
  const { size } = await fs.stat(file);
  const type = /\.m4a$|\.mp4$/i.test(file) ? 'audio/mp4' : /\.ogg$|\.opus$/i.test(file) ? 'audio/ogg' : /\.wav$/i.test(file) ? 'audio/wav' : 'audio/mpeg';
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  const start = m && m[1] ? +m[1] : 0;
  const end = m && m[2] ? Math.min(+m[2], size - 1) : size - 1;
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  const headers = { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
  return m
    ? new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}` } })
    : new Response(body, { status: 200, headers });
}

async function serveRemote(url: string, range: string | null): Promise<Response> {
  const res = await net.fetch(url, { headers: range ? { Range: range } : {} });
  const headers = new Headers({ 'Access-Control-Allow-Origin': '*' });
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

function registerMediaProtocol() {
  protocol.handle('resonate-media', async (req) => {
    const u = new URL(req.url);
    const target = decodeURIComponent(u.pathname.slice(1));
    const range = req.headers.get('range');
    try {
      if (u.hostname === 'file') return await serveFile(target, range);
      if (u.hostname === 'remote' && /^https?:\/\//.test(target)) return await serveRemote(target, range);
      return new Response('Not found', { status: 404 });
    } catch (err) {
      return new Response(String(err), { status: 502 });
    }
  });
}

// ---------- tray ----------

let trayState: TrayState | null = null;
const sendTray = (a: TrayAction) => win?.webContents.send('tray:action', a);

function buildTrayMenu() {
  if (!tray) return;
  const s = trayState;
  const items: Electron.MenuItemConstructorOptions[] = [];
  if (s && s.title) {
    items.push({ label: s.title, enabled: false }, { label: s.show, enabled: false }, { type: 'separator' });
    items.push(
      { label: s.playing ? 'Pause' : 'Play', click: () => sendTray({ type: 'toggle' }) },
      { label: 'Skip back', click: () => sendTray({ type: 'back' }) },
      { label: 'Skip forward', click: () => sendTray({ type: 'fwd' }) },
      { label: `Speed: ${s.speed}×`, click: () => sendTray({ type: 'speed' }) },
      { label: `Sleep timer: ${s.sleep}`, submenu: [
        { label: 'Off', click: () => sendTray({ type: 'sleep', mode: 'off' }) },
        { label: '15 minutes', click: () => sendTray({ type: 'sleep', mode: 15 }) },
        { label: '30 minutes', click: () => sendTray({ type: 'sleep', mode: 30 }) },
        { label: '60 minutes', click: () => sendTray({ type: 'sleep', mode: 60 }) },
        { label: 'End of chapter', click: () => sendTray({ type: 'sleep', mode: 'chapter' }) },
        { label: 'End of episode', click: () => sendTray({ type: 'sleep', mode: 'episode' }) },
      ] },
    );
    if (s.upNext.length) {
      items.push({ type: 'separator' }, { label: 'Up next', enabled: false });
      for (const e of s.upNext) items.push({ label: e.title.length > 48 ? e.title.slice(0, 47) + '…' : e.title, click: () => sendTray({ type: 'play', key: e.key }) });
    }
    items.push({ type: 'separator' });
  }
  items.push(
    { label: s?.downloads ?? 'Nothing downloading', enabled: false },
    { label: s?.dlPaused ? 'Resume downloads' : 'Pause downloads', click: () => sendTray({ type: 'dlPause' }) },
    { label: 'Refresh feeds', click: () => sendTray({ type: 'refresh' }) },
    { type: 'separator' },
    { label: 'Open Resonate', click: showWindow },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(s?.title ? `Resonate — ${s.title}` : 'Resonate');
}

function createTray() {
  const img = nativeImage.createFromPath(asset('tray-22.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.on('click', () => (win?.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  buildTrayMenu();
}

// ---------- IPC ----------

function readSecrets(): Promise<Record<string, string>> {
  return fs.readFile(dataFile('secrets.json'), 'utf8').then(JSON.parse, () => ({}));
}

function registerIpc() {
  ipcMain.on('env', (e) => { e.returnValue = { desktop: desktop(), hostname: hostname() }; });

  ipcMain.handle('http', async (_e, url: string, req: HttpRequest = {}): Promise<HttpResponse> => {
    const res = await net.fetch(url, { method: req.method ?? 'GET', headers: { 'User-Agent': `Resonate/${app.getVersion()}`, ...req.headers }, body: req.body });
    return { status: res.status, text: res.status === 304 ? '' : await res.text(), etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined };
  });

  ipcMain.handle('library:load', () => fs.readFile(dataFile('library.json'), 'utf8').catch(() => null));
  ipcMain.handle('library:save', async (_e, json: string) => {
    const tmp = dataFile('library.json.tmp');
    await fs.writeFile(tmp, json);
    await fs.rename(tmp, dataFile('library.json'));
  });

  ipcMain.handle('dl:start', (_e, job: DownloadJob) => downloads.start(job));
  ipcMain.handle('dl:cancel', (_e, key: string) => downloads.cancel(key));
  ipcMain.handle('dl:paused', (_e, paused: boolean) => downloads.setPaused(paused));
  ipcMain.handle('dl:concurrency', (_e, n: number) => downloads.setConcurrency(n));
  downloads.on('event', (ev) => win?.webContents.send('dl:event', ev));

  ipcMain.handle('fs:delete', (_e, file: string) => fs.rm(file, { force: true }));
  ipcMain.handle('fs:usage', (_e, folder: string) => diskUsage(folder));
  ipcMain.handle('fs:showInFolder', (_e, file: string) => shell.showItemInFolder(file));
  ipcMain.handle('fs:openFolder', async (_e, folder: string) => {
    const dir = expandHome(folder);
    await fs.mkdir(dir, { recursive: true });
    return shell.openPath(dir);
  });

  ipcMain.handle('dialog:folder', async (_e, current: string) => {
    const r = await dialog.showOpenDialog(win!, { title: 'Download folder', defaultPath: expandHome(current), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const home = app.getPath('home');
    return r.filePaths[0].startsWith(home) ? '~' + r.filePaths[0].slice(home.length) : r.filePaths[0];
  });
  ipcMain.handle('dialog:openOpml', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Import subscriptions', filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { name: path.basename(r.filePaths[0]), text: await fs.readFile(r.filePaths[0], 'utf8') };
  });
  ipcMain.handle('dialog:saveOpml', async (_e, name: string, text: string) => {
    const r = await dialog.showSaveDialog(win!, { title: 'Export subscriptions', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'OPML', extensions: ['opml'] }] });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, text);
    return path.basename(r.filePath);
  });

  ipcMain.handle('net:metered', () => new Promise<boolean | null>((resolve) => {
    execFile('nmcli', ['-t', '-f', 'GENERAL.METERED', 'dev', 'show'], { timeout: 4000 }, (err, out) => {
      if (err) return resolve(null);
      const vals = out.split('\n').map((l) => l.split(':')[1]?.trim() ?? '').filter(Boolean);
      resolve(vals.length ? vals.some((v) => v.startsWith('yes')) : null);
    });
  }));

  ipcMain.handle('secret:get', async (_e, key: string) => {
    const v = (await readSecrets())[key];
    if (!v) return null;
    return v.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) : v.slice(6);
  });
  ipcMain.handle('secret:set', async (_e, key: string, value: string | null) => {
    const all = await readSecrets();
    if (value == null) delete all[key];
    else all[key] = safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(value).toString('base64') : 'plain:' + value;
    await fs.writeFile(dataFile('secrets.json'), JSON.stringify(all), { mode: 0o600 });
  });

  ipcMain.on('tray:update', (_e, s: TrayState) => { trayState = s; buildTrayMenu(); });

  ipcMain.on('win:minimize', () => win?.minimize());
  ipcMain.on('win:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.on('win:close', () => (tray ? win?.hide() : win?.close()));
  ipcMain.on('app:quit', () => { quitting = true; app.quit(); });
}

// ---------- lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    registerMediaProtocol();
    registerIpc();
    createWindow();
    if (!process.env.RESONATE_NO_TRAY) createTray();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('activate', showWindow);
}
