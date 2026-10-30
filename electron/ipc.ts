import { app, dialog, ipcMain, safeStorage, shell } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { BACKUP_EXT, summarise, type BackupSummary, type LibraryBackup } from '../shared/backup';
import type { LibraryPatch } from '../shared/library';
import type { DownloadEvent, DownloadJob, HttpRequest, HttpResponse, TrayState } from '../shared/types';
import { readEmbeddedChapters } from '../shared/embedded';
import { backupName, decodeBackup, encodeBackup, fitToMachine, MAX_BACKUP_BYTES } from './backup';
import { checkRequest } from './bridge';
import { ctx, dataFile } from './context';
import { readSecret, setCredential, writeSecret } from './credentials';
import { diskUsage, expandHome, moveFiles, type DownloadManager } from './downloads';
import { writeFileAtomic } from './files';
import { originOf } from './hops';
import { cancelRequest, fetchFollowing, request } from './http';
import type { DownloadRoots } from './paths';
import { batchProgress } from './progress-batch';
import { secretStatus } from './secrets';
import { setTrayState } from './tray';

function desktop(): 'KDE' | 'GNOME' {
  const d = (process.env.XDG_CURRENT_DESKTOP ?? '').toUpperCase();
  if (d.includes('KDE')) return 'KDE';
  if (d) return 'GNOME';
  return 'KDE';
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

/** Where the library is kept, as it was, when a backup replaces it. */
const BEFORE_RESTORE = 'library.db.before-restore';

/** Everything the page may ask of the main process. `roots` and `downloads` are made in main.ts, once the user-data path is set. */
export function registerIpc({ roots, downloads }: { roots: DownloadRoots; downloads: DownloadManager }) {
  ipcMain.on('env', (e) => { e.returnValue = { desktop: desktop(), hostname: hostname() }; });

  ipcMain.on('http:cancel', (_e, id: string) => cancelRequest(id));
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
    await setCredential(origin, user == null ? null : 'Basic ' + Buffer.from(`${user}:${password ?? ''}`).toString('base64'));
  });
  ipcMain.handle('media:chapters', async (_e, file: string | null, url: string) => {
    const local = file ? await roots.resolve(file) : null;
    if (file && !local) return null;
    return embeddedChapters(local, url).catch(() => null);
  });
  ipcMain.handle('autostart:set', (_e, on: boolean) => setAutostart(on));

  ipcMain.handle('lib:load', () => {
    const snapshot = ctx.library!.loadJson(); // a string: the window parses it, instead of an object graph being copied to it
    console.log(`Library read for the window ${Math.round(process.uptime() * 1000)} ms after launch`);
    return snapshot;
  });
  ipcMain.handle('lib:patch', (_e, patch: LibraryPatch) => ctx.library!.patch(patch));
  ipcMain.handle('lib:notes', (_e, show: string, guid: string) => ctx.library!.notes(String(show), String(guid)));

  // ---------- backup and restore ----------
  // The page asks for a backup to be chosen, shows what is in it, and only then asks for it to be restored: the backup
  // waits here in between, so the page never handles (or alters) what gets written.
  let chosen: { backup: LibraryBackup; summary: BackupSummary } | null = null;
  const backupFilter = [{ name: 'Resonate backup', extensions: [BACKUP_EXT] }];
  ipcMain.handle('lib:backup', async () => {
    const r = await dialog.showSaveDialog(ctx.win!, { title: 'Back up library', defaultPath: path.join(app.getPath('documents'), backupName()), filters: backupFilter });
    if (r.canceled || !r.filePath) return null;
    const backup = ctx.library!.backup(app.getVersion());
    await writeFileAtomic(r.filePath, encodeBackup(backup));
    console.log(`Library backed up to ${r.filePath}`);
    return summarise(backup, path.basename(r.filePath));
  });
  ipcMain.handle('lib:chooseBackup', async (): Promise<BackupSummary | { error: string } | null> => {
    chosen = null;
    const r = await dialog.showOpenDialog(ctx.win!, { title: 'Restore library', filters: [...backupFilter, { name: 'All files', extensions: ['*'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    try {
      if ((await fs.stat(file)).size > MAX_BACKUP_BYTES) throw new Error('This file is too big to be a Resonate backup');
      const backup = decodeBackup(await fs.readFile(file));
      chosen = { backup, summary: summarise(backup, path.basename(file)) };
      return chosen.summary;
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
  ipcMain.handle('lib:restore', async (): Promise<{ error: string } | null> => {
    if (!chosen) return { error: 'Choose a backup first' };
    const { backup, summary } = chosen;
    const library = ctx.library!;
    try {
      const fitted = await fitToMachine(backup, {
        hasFile: async (f) => { const p = await roots.resolve(f); return !!p && fs.access(p).then(() => true, () => false); },
        isDownloadFolder: async (f) => !!(await roots.resolve(f)),
        folder: library.setting('folder'),
        autostart: await fs.access(autostartFile()).then(() => true, () => false),
        podcastIndexKey: !!(await readSecret('podcastindex')),
      });
      // The library as it was, in case this wasn't the backup that was wanted.
      await library.copyTo(dataFile(BEFORE_RESTORE));
      for (const key of downloads.pending()) downloads.cancel(key); // they belong to the library being replaced
      library.replace(fitted, backup.notes);
    } catch (err) {
      console.error('Restoring a backup failed', err);
      return { error: (err as Error).message };
    }
    chosen = null;
    console.log(`Library restored from ${summary.name} (${summary.shows} shows, ${summary.episodes} episodes, made by Resonate ${summary.app}); the previous one is kept as ${BEFORE_RESTORE}`);
    // The page still holds the library that was replaced: it starts again and reads the restored one.
    setImmediate(() => ctx.win?.webContents.reload());
    return null;
  });

  ipcMain.handle('dl:start', async (_e, job: DownloadJob) => {
    const folder = await roots.resolve(job.folder);
    if (!folder) {
      ctx.win?.webContents.send('dl:event', { type: 'error', key: job.key, message: 'That isn’t one of your download folders' } satisfies DownloadEvent);
      return;
    }
    downloads.start({ ...job, folder });
  });
  ipcMain.handle('dl:cancel', (_e, key: string) => downloads.cancel(key));
  ipcMain.handle('dl:paused', (_e, paused: boolean) => downloads.setPaused(paused));
  ipcMain.handle('dl:concurrency', (_e, n: number) => downloads.setConcurrency(n));
  downloads.on('event', batchProgress((ev) => ctx.win?.webContents.send('dl:event', ev)));

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
    const r = await dialog.showOpenDialog(ctx.win!, { title: 'Download folder', defaultPath: expandHome(current), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    await roots.add(r.filePaths[0]); // choosing it in the native dialog is what makes it a download folder
    const home = app.getPath('home');
    return r.filePaths[0].startsWith(home) ? '~' + r.filePaths[0].slice(home.length) : r.filePaths[0];
  });
  ipcMain.handle('dialog:openOpml', async () => {
    const r = await dialog.showOpenDialog(ctx.win!, { title: 'Import subscriptions', filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { name: path.basename(r.filePaths[0]), text: await fs.readFile(r.filePaths[0], 'utf8') };
  });
  ipcMain.handle('dialog:saveOpml', async (_e, name: string, text: string) => {
    const r = await dialog.showSaveDialog(ctx.win!, { title: 'Export subscriptions', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'OPML', extensions: ['opml'] }] });
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
    ctx.log?.error('renderer:', String(message).slice(0, 2000), detail ? String(detail).slice(0, 4000) : '');
  });
  ipcMain.handle('log:open', () => shell.openPath(app.getPath('logs')));
  ipcMain.handle('secret:status', () => secretStatus(safeStorage));
  ipcMain.handle('secret:get', (_e, key: string) => readSecret(key));
  ipcMain.handle('secret:set', (_e, key: string, value: string | null) => writeSecret(key, value));

  ipcMain.on('tray:update', (_e, s: TrayState) => setTrayState(s));

  ipcMain.on('win:minimize', () => ctx.win?.minimize());
  ipcMain.on('win:maximize', () => (ctx.win?.isMaximized() ? ctx.win.unmaximize() : ctx.win?.maximize()));
  ipcMain.on('win:close', () => (ctx.tray ? ctx.win?.hide() : ctx.win?.close()));
  ipcMain.on('app:quit', () => { ctx.quitting = true; app.quit(); });
}
