import { app, Menu, nativeImage, Tray } from 'electron';
import type { TrayAction, TrayState } from '../shared/types';
import { asset, ctx, showWindow } from './context';

// ---------- tray ----------

let trayState: TrayState | null = null;
const sendTray = (a: TrayAction) => ctx.win?.webContents.send('tray:action', a);

function buildTrayMenu() {
  const { tray } = ctx;
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
    { label: 'Quit', click: () => { ctx.quitting = true; app.quit(); } },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(s?.title ? `Resonate — ${s.title}` : 'Resonate');
}

export function createTray() {
  const img = nativeImage.createFromPath(asset('tray-22.png'));
  const tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  ctx.tray = tray;
  tray.on('click', () => (ctx.win?.isVisible() && ctx.win.isFocused() ? ctx.win.hide() : showWindow()));
  buildTrayMenu();
}

/** What the page last said the tray should show; the menu is rebuilt from it. */
export function setTrayState(s: TrayState) {
  trayState = s;
  buildTrayMenu();
}
