import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, safeStorage, screen, shell, Tray } from 'electron';
import { execFile } from 'node:child_process';
import { createReadStream, promises as fs, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { DownloadJob, HttpRequest, HttpResponse, TrayAction, TrayState } from '../shared/types';
import { readEmbeddedChapters } from '../shared/embedded';
import { DownloadManager, diskUsage, expandHome, moveFiles } from './downloads';

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

// ---------- feed credentials (HTTP Basic, per origin) ----------

const credentials = new Map<string, string>();
const originOf = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };
const authFor = (url: string): Record<string, string> => {
  const c = credentials.get(originOf(url));
  return c ? { Authorization: c } : {};
};
const userAgent = () => `Resonate/${app.getVersion()}`;

const downloads = new DownloadManager((url, init) =>
  net.fetch(url, { ...init, headers: { 'User-Agent': userAgent(), ...authFor(url), ...init?.headers } } as RequestInit));

const asset = (name: string) => path.join(__dirname, '..', 'assets', name);
const dataFile = (name: string) => path.join(app.getPath('userData'), name);

function desktop(): 'KDE' | 'GNOME' {
  const d = (process.env.XDG_CURRENT_DESKTOP ?? '').toUpperCase();
  if (d.includes('KDE')) return 'KDE';
  if (d) return 'GNOME';
  return 'KDE';
}

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
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  const st: WinState = { ...b, maximized: win.isMaximized() };
  try { writeFileSync(dataFile('window.json'), JSON.stringify(st)); } catch { /* not fatal */ }
}

function createWindow() {
  const st = loadWinState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width, height: st.height, minWidth: 980, minHeight: 620,
    frame: false, show: false, backgroundColor: '#161826', title: 'Resonate',
    icon: asset('icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden') || !tray) win?.show(); });
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const queueSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveWinState, 500); };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) win.on(ev as 'resize', queueSave);
  win.on('close', (e) => {
    clearTimeout(saveTimer);
    saveWinState();
    if (!quitting && tray) { e.preventDefault(); win?.hide(); }
  });
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

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

async function serveFile(file: string, range: string | null): Promise<Response> {
  const { size } = await fs.stat(file);
  const type = MIME[path.extname(file).slice(1).toLowerCase()] ?? 'audio/mpeg';
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
  const res = await net.fetch(url, { headers: { 'User-Agent': userAgent(), ...authFor(url), ...(range ? { Range: range } : {}) } });
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
const decrypt = (v: string) => (v.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) : v.slice(6));
async function writeSecret(key: string, value: string | null) {
  const all = await readSecrets();
  if (value == null) delete all[key];
  else all[key] = safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(value).toString('base64') : 'plain:' + value;
  await fs.writeFile(dataFile('secrets.json'), JSON.stringify(all), { mode: 0o600 });
}
async function loadCredentials() {
  for (const [k, v] of Object.entries(await readSecrets())) {
    if (!k.startsWith('auth:')) continue;
    try { credentials.set(k.slice(5), decrypt(v)); } catch { /* unreadable on this machine */ }
  }
}

interface TextResponse { status: number; text: string; header(name: string): string | undefined; finalUrl: string; permanent: boolean }

/** GET/POST with redirects followed by hand, so we know whether every hop was permanent. */
function request(url: string, req: HttpRequest): Promise<TextResponse> {
  return new Promise((resolve, reject) => {
    const r = net.request({ url, method: req.method ?? 'GET', redirect: 'manual' });
    const headers = { 'User-Agent': userAgent(), ...authFor(url), ...req.headers };
    for (const [k, v] of Object.entries(headers)) r.setHeader(k, v);
    let finalUrl = url;
    let permanent = true;
    let hops = 0;
    r.on('redirect', (status, _method, to) => {
      if (++hops > 8) { r.abort(); reject(new Error('too many redirects')); return; }
      if (status !== 301 && status !== 308) permanent = false;
      finalUrl = to;
      r.followRedirect();
    });
    r.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        text: Buffer.concat(chunks).toString('utf8'),
        header: (n) => { const v = res.headers[n.toLowerCase()]; return Array.isArray(v) ? v[0] : v; },
        finalUrl,
        permanent: hops > 0 && permanent,
      }));
      res.on('error', reject);
    });
    r.on('error', reject);
    if (req.body) r.write(req.body);
    r.end();
  });
}

/** Chapters inside a local file or a remote enclosure (read with small Range requests). */
async function embeddedChapters(file: string | null, url: string) {
  if (file) {
    const fh = await fs.open(file, 'r');
    try {
      const { size } = await fh.stat();
      return await readEmbeddedChapters(async (o, n) => {
        const b = Buffer.alloc(Math.max(0, Math.min(n, size - o)));
        await fh.read(b, 0, b.length, o);
        return b;
      }, size);
    } finally {
      await fh.close();
    }
  }
  let requests = 0;
  return readEmbeddedChapters(async (o, n) => {
    if (++requests > 12) throw new Error('too many range requests');
    const res = await net.fetch(url, { headers: { 'User-Agent': userAgent(), ...authFor(url), Range: `bytes=${o}-${o + n - 1}` } });
    if (res.status !== 206) { await res.body?.cancel(); throw new Error('no range support'); }
    return new Uint8Array(await res.arrayBuffer());
  }, 0);
}

// ---------- start at login (freedesktop autostart) ----------

const autostartFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config'), 'autostart', 'io.github.sekhnat.resonate.desktop');

async function setAutostart(on: boolean) {
  const file = autostartFile();
  if (!on) { await fs.rm(file, { force: true }); return; }
  const cmd = process.env.APPIMAGE ? [process.env.APPIMAGE] : app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];
  const exec = [...cmd.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/(["\\`$])/g, '\\$1')}"` : a)), '--hidden'].join(' ');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, [
    '[Desktop Entry]', 'Type=Application', 'Name=Resonate', 'Comment=Podcast player', `Exec=${exec}`,
    'Icon=resonate', 'Terminal=false', 'X-GNOME-Autostart-enabled=true', '',
  ].join('\n'));
}

function registerIpc() {
  ipcMain.on('env', (e) => { e.returnValue = { desktop: desktop(), hostname: hostname() }; });

  ipcMain.handle('http', async (_e, url: string, req: HttpRequest = {}): Promise<HttpResponse> => {
    const res = await request(url, req);
    return {
      status: res.status, text: res.status === 304 ? '' : res.text,
      etag: res.header('etag'), lastModified: res.header('last-modified'),
      movedTo: res.permanent && res.finalUrl !== url ? res.finalUrl : undefined,
    };
  });

  ipcMain.handle('auth:set', async (_e, url: string, user: string | null, password: string | null) => {
    const origin = originOf(url);
    if (!origin) return;
    const value = user == null ? null : 'Basic ' + Buffer.from(`${user}:${password ?? ''}`).toString('base64');
    if (value) credentials.set(origin, value);
    else credentials.delete(origin);
    await writeSecret(`auth:${origin}`, value);
  });
  ipcMain.handle('media:chapters', (_e, file: string | null, url: string) => embeddedChapters(file, url).catch(() => null));
  ipcMain.handle('autostart:set', (_e, on: boolean) => setAutostart(on));

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
  ipcMain.handle('fs:move', (_e, from: string, to: string, files: string[]) => moveFiles(from, to, files));
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
    return v ? decrypt(v) : null;
  });
  ipcMain.handle('secret:set', (_e, key: string, value: string | null) => writeSecret(key, value));

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
  app.whenReady().then(async () => {
    await loadCredentials();
    registerMediaProtocol();
    registerIpc();
    createWindow();
    if (!process.env.RESONATE_NO_TRAY) createTray();
  });
  // Give the renderer a moment to write the library (and the playback position) before quitting.
  let flushed = false;
  app.on('before-quit', (e) => {
    quitting = true;
    if (flushed || !win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    e.preventDefault();
    const done = () => { if (flushed) return; flushed = true; app.quit(); };
    ipcMain.once('app:flushed', done);
    setTimeout(done, 2000);
    win.webContents.send('app:flush');
  });
  app.on('activate', showWindow);
}
