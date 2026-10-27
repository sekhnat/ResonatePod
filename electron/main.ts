import { app, BrowserWindow, crashReporter, dialog, ipcMain, Menu, nativeImage, net, protocol, safeStorage, screen, shell, Tray } from 'electron';
import { execFile } from 'node:child_process';
import { createReadStream, promises as fs, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { LibraryPatch } from '../shared/library';
import type { DownloadEvent, DownloadJob, HttpRequest, HttpResponse, TrayAction, TrayState } from '../shared/types';
import { readEmbeddedChapters } from '../shared/embedded';
import { DownloadManager, diskUsage, expandHome, moveFiles } from './downloads';
import { DownloadRoots, rootsFromLibrary } from './paths';
import { hopHeaders, originOf } from './hops';
import { checkRequest } from './bridge';
import { secretStatus } from './secrets';
import { readJsonFile, updateJsonFile, writeFileAtomicSync } from './files';
import { createLogger, type Logger } from './log';
import { LibraryDb, openLibrary } from './db/library';
import { importLegacyLibrary } from './db/legacy';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const USER_DATA = process.env.RESONATE_USER_DATA;
if (USER_DATA) app.setPath('userData', USER_DATA);
app.setName('Resonate');

// What goes wrong is written to <config>/logs/main.log (rotated) as well as to the console, so a bug report can include it.
let log: Logger | null = null;
function startLogging() {
  log = createLogger(app.getPath('logs'));
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => { original(...args); (level === 'log' || level === 'info' ? log!.info : level === 'warn' ? log!.warn : log!.error)(...args); };
  }
  process.on('uncaughtException', (err) => { log!.error('uncaught exception', err); });
  process.on('unhandledRejection', (reason) => { log!.error('unhandled rejection', reason); });
  // Crash dumps stay on this computer: nothing is ever sent anywhere.
  crashReporter.start({ uploadToServer: false, compress: true });
  log.info(`Resonate ${app.getVersion()} started (Electron ${process.versions.electron}, ${process.platform} ${process.arch})`);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'resonate-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } },
]);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// ---------- feed credentials (HTTP Basic, per origin) ----------

const credentials = new Map<string, string>();
const authFor = (url: string): Record<string, string> => {
  const c = credentials.get(originOf(url));
  return c ? { Authorization: c } : {};
};
const userAgent = () => `Resonate/${app.getVersion()}`;

// Test hook: RESONATE_URL_REWRITE='{"https://itunes.apple.com":"http://127.0.0.1:8080/apple"}'
// points outside services at a local fixture server (used by the e2e test only).
const rewrites = Object.entries((() => { try { return JSON.parse(process.env.RESONATE_URL_REWRITE ?? '{}') as Record<string, string>; } catch { return {}; } })());
const rewrite = (url: string) => {
  for (const [from, to] of rewrites) if (url.startsWith(from)) return to + url.slice(from.length);
  return url;
};

/**
 * A GET that follows redirects itself, hop by hop, and hands back the final answer as a web Response (the body streams).
 * Each hop gets only the headers its origin may have (see hopHeaders): net.fetch follows redirects with the headers it
 * started with, so the login for the first origin would go to wherever the server points it, a CDN or a tracker, and it
 * can't be told to stop (a "manual" redirect makes it throw). `toFetch` rewrites a URL just before it is requested.
 */
function fetchFollowing(url: string, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}, toFetch = (u: string) => u): Promise<Response> {
  return new Promise((resolve, reject) => {
    let r!: Electron.ClientRequest;
    let current = url;
    let hops = 0;
    let answered = false;
    const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fail = (err: Error) => { r?.abort(); reject(err); };
    if (init.signal?.aborted) { reject(aborted()); return; }
    init.signal?.addEventListener('abort', () => { r.abort(); if (!answered) reject(aborted()); }, { once: true });

    const open = (target: string) => {
      const mine = net.request({ url: toFetch(target), redirect: 'manual' });
      r = mine;
      for (const [k, v] of Object.entries(hopHeaders(init.headers, url, target, userAgent(), authFor))) mine.setHeader(k, v);
      mine.on('redirect', (_status, _method, to) => {
        if (r !== mine) return;
        if (++hops > 8) { fail(new Error('too many redirects')); return; }
        const sameOrigin = originOf(to) === originOf(current);
        current = to;
        if (sameOrigin) { mine.followRedirect(); return; }
        open(to); // another origin: a request of its own, with only the headers that origin may have
        mine.abort();
      });
      mine.on('response', (res) => {
        if (r !== mine) return;
        answered = true;
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
        // A response with no body to have must not be given one.
        const body = [101, 204, 205, 304].includes(res.statusCode) ? null : (Readable.toWeb(res as unknown as Readable) as ReadableStream);
        resolve(new Response(body, { status: res.statusCode, statusText: res.statusMessage, headers }));
      });
      mine.on('error', (err) => { if (r === mine && !answered) fail(err); });
      mine.end();
    };
    open(url);
  });
}

const downloads = new DownloadManager((url, init) => fetchFollowing(url, init));

const asset = (name: string) => path.join(__dirname, '..', 'assets', name);
const dataFile = (name: string) => path.join(app.getPath('userData'), name);

// Where the renderer is allowed to read, delete and download files (see paths.ts).
const roots = new DownloadRoots(dataFile('main-settings.json'), '~/Podcasts');

// The library (shows, episodes, state, settings), opened once the app is ready.
let library: LibraryDb | null = null;

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
  try { writeFileAtomicSync(dataFile('window.json'), JSON.stringify(st)); } catch { /* not fatal */ }
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
  const res = await fetchFollowing(url, { headers: range ? { Range: range } : {} }, rewrite);
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
      if (u.hostname === 'file') {
        const file = await roots.resolve(target);
        return file ? await serveFile(file, range) : new Response('Not one of your download folders', { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
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
  return readJsonFile<Record<string, string>>(dataFile('secrets.json'), {});
}
const decrypt = (v: string) => (v.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) : v.slice(6));
/** One change at a time, whole-file, so two logins saved together can't lose one of them. */
function writeSecret(key: string, value: string | null) {
  return updateJsonFile<Record<string, string>>(dataFile('secrets.json'), {}, (all) => {
    const next = { ...all };
    if (value == null) delete next[key];
    else next[key] = safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(value).toString('base64') : 'plain:' + value;
    return next;
  }, 0o600);
}
async function loadCredentials() {
  for (const [k, v] of Object.entries(await readSecrets())) {
    if (!k.startsWith('auth:')) continue;
    try { credentials.set(k.slice(5), decrypt(v)); } catch { /* unreadable on this machine */ }
  }
}

interface TextResponse { status: number; text: string; header(name: string): string | undefined; finalUrl: string; permanent: boolean }

// A server that stops answering must not hold a refresh worker forever: give up when nothing has
// arrived for the idle time, or when the whole exchange outlasts the total time.
const HTTP_IDLE_MS = Number(process.env.RESONATE_HTTP_TIMEOUT_MS) || 20_000;
const HTTP_TOTAL_MS = Number(process.env.RESONATE_HTTP_TIMEOUT_MS) || 60_000;
// Bodies are buffered whole, so a runaway response must be cut off rather than held in memory.
const HTTP_MAX_BYTES = 50 * 1024 * 1024;

/** Requests the page may still cancel, by the name it gave them. */
const cancellers = new Map<string, () => void>();

/**
 * GET/POST with redirects followed by hand, so we know whether every hop was permanent. A redirect to another origin
 * is a new request without the first origin's login (see hopHeaders); a POST isn't followed to another origin at all.
 */
function request(url: string, req: HttpRequest, id?: string): Promise<TextResponse> {
  return new Promise((resolve, reject) => {
    let r!: Electron.ClientRequest;
    let current = url;
    let finalUrl = url;
    let permanent = true;
    let hops = 0;
    let settled = false;
    let idle: NodeJS.Timeout | undefined;
    const finish = (err: Error | null, value?: TextResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(total);
      if (id) cancellers.delete(id);
      if (err) { r.abort(); reject(err); } else resolve(value!);
    };
    const timedOut = () => finish(new Error('timed out'));
    const total = setTimeout(timedOut, HTTP_TOTAL_MS);
    if (id) cancellers.set(id, () => finish(new Error('cancelled')));
    const touch = () => { clearTimeout(idle); idle = setTimeout(timedOut, HTTP_IDLE_MS); };
    touch();
    const cap = Math.min(req.maxBytes ?? HTTP_MAX_BYTES, HTTP_MAX_BYTES);

    const open = (target: string, body?: string) => {
      const mine = net.request({ url: rewrite(target), method: req.method ?? 'GET', redirect: 'manual' });
      r = mine;
      for (const [k, v] of Object.entries(hopHeaders(req.headers, url, target, userAgent(), authFor))) mine.setHeader(k, v);
      mine.on('redirect', (status, _method, to) => {
        if (r !== mine) return;
        if (++hops > 8) { finish(new Error('too many redirects')); return; }
        if (status !== 301 && status !== 308) permanent = false;
        const sameOrigin = originOf(to) === originOf(current);
        if (!sameOrigin && (req.method ?? 'GET') !== 'GET') { finish(new Error('the server redirected to another site')); return; }
        finalUrl = to;
        touch();
        if (sameOrigin) { current = to; mine.followRedirect(); return; }
        // Another origin: a request of its own, with only the headers that origin may have; this one is dropped.
        current = to;
        open(to);
        mine.abort();
      });
      mine.on('response', (res) => {
        if (r !== mine) return;
        const chunks: Buffer[] = [];
        let received = 0;
        touch();
        if (Number(res.headers['content-length']) > cap) { finish(new Error('response too large')); return; }
        res.on('data', (c) => {
          received += c.length;
          if (received > cap) { finish(new Error('response too large')); return; }
          chunks.push(c);
          touch();
        });
        res.on('end', () => finish(null, {
          status: res.statusCode,
          text: Buffer.concat(chunks).toString('utf8'),
          header: (n) => { const v = res.headers[n.toLowerCase()]; return Array.isArray(v) ? v[0] : v; },
          finalUrl,
          permanent: hops > 0 && permanent,
        }));
        res.on('error', (err) => finish(err));
      });
      mine.on('error', (err) => { if (r === mine) finish(err); });
      if (body) mine.write(body);
      mine.end();
    };
    open(url, req.body);
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
    const res = await fetchFollowing(url, { headers: { Range: `bytes=${o}-${o + n - 1}` } });
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

  ipcMain.on('http:cancel', (_e, id: string) => { cancellers.get(String(id))?.(); });
  ipcMain.handle('http', async (_e, url: string, req: HttpRequest = {}, id?: string): Promise<HttpResponse> => {
    checkRequest(url, req);
    const res = await request(url, req ?? {}, typeof id === 'string' ? id : undefined); // a null from the page is as good as nothing
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
  ipcMain.handle('media:chapters', async (_e, file: string | null, url: string) => {
    const local = file ? await roots.resolve(file) : null;
    if (file && !local) return null;
    return embeddedChapters(local, url).catch(() => null);
  });
  ipcMain.handle('autostart:set', (_e, on: boolean) => setAutostart(on));

  ipcMain.handle('lib:load', () => library!.load());
  ipcMain.handle('lib:patch', (_e, patch: LibraryPatch) => library!.patch(patch));
  ipcMain.handle('lib:notes', (_e, show: string, guid: string) => library!.notes(String(show), String(guid)));

  ipcMain.handle('dl:start', async (_e, job: DownloadJob) => {
    const folder = await roots.resolve(job.folder);
    if (!folder) {
      win?.webContents.send('dl:event', { type: 'error', key: job.key, message: 'That isn’t one of your download folders' } satisfies DownloadEvent);
      return;
    }
    downloads.start({ ...job, folder });
  });
  ipcMain.handle('dl:cancel', (_e, key: string) => downloads.cancel(key));
  ipcMain.handle('dl:paused', (_e, paused: boolean) => downloads.setPaused(paused));
  ipcMain.handle('dl:concurrency', (_e, n: number) => downloads.setConcurrency(n));
  downloads.on('event', (ev) => win?.webContents.send('dl:event', ev));

  // Every path from the renderer goes through roots.resolve, and only what it returns is touched.
  ipcMain.handle('fs:delete', async (_e, file: string) => {
    const target = await roots.resolve(file);
    if (target) await fs.rm(target, { force: true });
  });
  ipcMain.handle('fs:move', async (_e, from: string, to: string, files: string[]) => {
    const [src, dst] = await Promise.all([roots.resolve(from), roots.resolve(to)]);
    if (!src || !dst || !Array.isArray(files)) return [];
    const allowed = (await Promise.all(files.map((f) => roots.resolve(f)))).filter((f): f is string => !!f);
    return moveFiles(src, dst, allowed);
  });
  ipcMain.handle('fs:usage', async (_e, folder: string) => {
    const dir = await roots.resolve(folder);
    return dir ? diskUsage(dir) : 0;
  });
  ipcMain.handle('fs:showInFolder', async (_e, file: string) => {
    const target = await roots.resolve(file);
    if (target) shell.showItemInFolder(target);
  });
  ipcMain.handle('fs:openFolder', async (_e, folder: string) => {
    const dir = await roots.resolve(folder);
    if (!dir) return 'That isn’t one of your download folders';
    await fs.mkdir(dir, { recursive: true });
    return shell.openPath(dir);
  });

  ipcMain.handle('dialog:folder', async (_e, current: string) => {
    const r = await dialog.showOpenDialog(win!, { title: 'Download folder', defaultPath: expandHome(current), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    await roots.add(r.filePaths[0]); // choosing it in the native dialog is what makes it a download folder
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

  // Errors the page didn't handle, for the log; a flood from a loop is cut off by the file's rotation.
  ipcMain.on('log:renderer', (_e, message: unknown, detail: unknown) => {
    log?.error('renderer:', String(message).slice(0, 2000), detail ? String(detail).slice(0, 4000) : '');
  });
  ipcMain.handle('log:open', () => shell.openPath(app.getPath('logs')));
  ipcMain.handle('secret:status', () => secretStatus(safeStorage));
  ipcMain.handle('secret:get', async (_e, key: string) => {
    const v = (await readSecrets())[key];
    try { return v ? decrypt(v) : null; } catch { return null; } // saved on another machine or keyring: as good as not saved
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
    startLogging();
    await loadCredentials();
    await roots.load(() => fs.readFile(dataFile('library.json'), 'utf8').then(rootsFromLibrary, () => []));
    const opened = openLibrary(dataFile('library.db'));
    library = opened.db;
    if (opened.recovered) console.warn(`library.db was damaged; kept as ${opened.recovered} and started a new library`);
    // A library saved by an older version (one JSON file) moves into the database once, and the file is kept as a backup.
    if (library.isEmpty()) {
      const legacy = await fs.readFile(dataFile('library.json'), 'utf8').catch(() => null);
      const imported = legacy ? importLegacyLibrary(library, legacy) : null;
      if (imported) {
        await fs.rename(dataFile('library.json'), dataFile('library.json.bak'));
        console.log(`Imported library.json: ${imported.shows} shows, ${imported.episodes} episodes, ${imported.states} episode states (kept as library.json.bak)`);
      }
    }
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
  app.on('will-quit', () => { library?.close(); library = null; });
  app.on('activate', showWindow);
}
