import type { TrayState } from '../../shared/types';

/**
 * Hands tray states to the desktop. Every change rebuilds the whole native menu (on Linux it is sent again over D-Bus),
 * and the "N active · M MB remaining" line changes on almost every download progress event. A change to anything else
 * (what is playing, the speed, the sleep timer) goes out at once; a change to that line alone goes out at most once
 * every `ms`, with the latest text when the wait is over.
 */
export function trayPusher(send: (tray: TrayState) => void, ms = 1000): (tray: TrayState) => void {
  let sig = '';
  let shown: string | null = null; // the download line the desktop has
  let sentAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: TrayState;

  const push = (tray: TrayState) => {
    clearTimeout(timer);
    timer = undefined;
    sentAt = Date.now();
    shown = tray.downloads;
    send(tray);
  };

  return (tray) => {
    latest = tray;
    const { downloads, ...rest } = tray;
    const next = JSON.stringify(rest);
    if (next !== sig) { sig = next; push(tray); return; }
    if (downloads === shown) { clearTimeout(timer); timer = undefined; return; }
    const wait = ms - (Date.now() - sentAt);
    if (wait <= 0) push(tray);
    else timer ??= setTimeout(() => push(latest), wait);
  };
}
