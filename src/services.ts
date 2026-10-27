import { shallow } from 'zustand/shallow';
import { downloadsBlocked, epInfo, flushSave, getEp, sleepLabel, useStore, type State } from './store';
import { dlSummary } from './model';
import { platform } from './platform';
import { startEngine } from './audio/engine';

const HOUR = 3600000;

/** Wires the store to the OS: downloads, tray, metered network, timers. Call once after hydration. */
export function startServices() {
  const st = () => useStore.getState();
  startEngine();

  platform.download.onEvent((e) => st().onDownloadEvent(e));
  let blocked: boolean | null = null;
  let par: string | null = null;
  let traySig = '';
  let folder: string | null = null;
  let autostart: boolean | null = null;

  const sync = (s: State) => {
    const b = downloadsBlocked(s);
    if (b !== blocked) { blocked = b; platform.download.setPaused(b); }
    if (s.sv.par !== par) { par = s.sv.par; platform.download.setConcurrency(parseInt(par, 10)); }
    if (s.folder !== folder) { folder = s.folder; void s.updateUsage(); }
    // Applied at every launch too, so the autostart entry follows the app if it moves.
    if (s.tg.autostart !== autostart) { autostart = s.tg.autostart; void platform.setAutostart(autostart).catch(() => {}); }
    const cur = epInfo(s, s.cur);
    const tray = {
      title: cur?.title ?? '',
      show: cur?.show.title ?? '',
      playing: s.playing,
      speed: s.speed,
      sleep: sleepLabel(s.sleep),
      upNext: s.queue.filter((k) => k !== s.cur).slice(0, 2).map((k) => ({ key: k, title: epInfo(s, k)?.title ?? '' })),
      downloads: dlSummary(s),
      dlPaused: s.dlPaused,
    };
    const sig = JSON.stringify(tray);
    if (sig !== traySig) { traySig = sig; platform.updateTray(tray); }
  };
  // What sync() reads, and no more: playback position, toasts and screen changes don't run it.
  useStore.subscribe(
    (s) => ({
      dlPaused: s.dlPaused, metered: s.metered, tg: s.tg, sv: s.sv, folder: s.folder, shows: s.shows, cur: s.cur, playing: s.playing,
      speed: s.speed, sleep: s.sleep, queue: s.queue, dl: s.dl,
    }),
    () => sync(st()),
    { equalityFn: shallow },
  );
  sync(st());

  platform.onTrayAction((a) => {
    const s = st();
    switch (a.type) {
      case 'toggle': s.togglePlay(); break;
      case 'back': s.skipBack(); break;
      case 'fwd': s.skipFwd(); break;
      case 'speed': s.cycleSpeed(); break;
      case 'refresh': void s.refresh(); break;
      case 'dlPause': s.toggleDlPause(); break;
      case 'play': s.play(a.key); break;
      case 'sleep':
        s.setSleep(a.mode === 'off' ? { mode: 'off' } : a.mode === 'chapter' ? { mode: 'chapter' } : a.mode === 'episode' ? { mode: 'episode' } : { mode: 'timer', minutes: a.mode, remaining: a.mode * 60 });
        break;
    }
  });

  const checkMetered = async () => {
    const metered = await platform.isMetered().catch(() => null);
    if (metered !== st().metered) useStore.setState({ metered });
  };
  void checkMetered();
  setInterval(checkMetered, 60000);

  setInterval(() => st().tick(), 1000);

  // Playback position reaches disk every 30 s while playing, and on quit.
  setInterval(() => { if (st().playing) st().checkpoint(); }, 30000);
  platform.onFlush(async () => { st().checkpoint(); await flushSave(); });

  // Downloads that were queued, running or failed when Resonate last quit resume from their .part files.
  if (platform.isDesktop) {
    const s = st();
    const live = s.dlPending.filter((k) => epInfo(s, k) && !getEp(s, k).file);
    if (live.length !== s.dlPending.length) useStore.setState({ dlPending: live });
    live.forEach((k) => st().startDownload(k));
  }

  // "Delete played episodes" and the storage limit apply on a timer, not only after refreshes and downloads.
  // They go by the sizes recorded for each download, so this needs no walk of the folder; that is done once now
  // (for the figure in Preferences) and again when the folder changes or the user asks.
  const cleanup = () => { void st().cleanupStorage({ quiet: true }); };
  void st().updateUsage();
  cleanup();
  setInterval(cleanup, HOUR);

  const maybeRefresh = () => {
    const s = st();
    if (s.shows.length && Date.now() - s.lastChecked > HOUR) void s.refresh();
  };
  maybeRefresh();
  setInterval(maybeRefresh, 60000);
  if (st().cur) void st().loadMeta(st().cur!);
}
