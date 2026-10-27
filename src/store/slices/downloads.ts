import { shortHash } from '../../../shared/filename';
import { platform } from '../../platform';
import { GB, cleanupKeys, epInfo, getEp, sharesFileName, trackedBytes, withEp } from '../selectors';
import { type ActiveDl, type Slice } from '../types';

export const createDownloadsSlice: Slice<'startDownload' | 'cancelDownload' | 'moveDownloads' | 'deleteFile' | 'toggleDlPause' | 'onDownloadEvent' | 'updateUsage' | 'cleanupStorage'> = (set, get) => {
  return {
    startDownload: (key) => {
      const s = get();
      const info = epInfo(s, key);
      const existing = s.dl.find((d) => d.key === key);
      if (!info || (existing && !existing.error && !existing.retryAt) || getEp(s, key).file) return;
      if (!platform.isDesktop) { s.toast('Downloading needs the Resonate desktop app'); return; }
      set({
        dl: existing ? s.dl.map((d) => (d.key === key ? { ...d, error: undefined, retryAt: undefined, active: false } : d)) : [...s.dl, { key, received: 0, total: info.ep.sizeBytes, speed: 0 }],
        dlPending: s.dlPending.includes(key) ? s.dlPending : [...s.dlPending, key],
      });
      platform.download.start({ key, url: info.ep.enclosureUrl, folder: s.folder, showTitle: info.show.title, title: info.title, pubDate: info.ep.pubDate, mime: info.ep.enclosureType, suffix: sharesFileName(s, info) ? shortHash(key) : undefined });
    },
    cancelDownload: (key) => {
      platform.download.cancel(key);
      set((s) => ({ dl: s.dl.filter((d) => d.key !== key), dlPending: s.dlPending.filter((k) => k !== key) }));
    },
    moveDownloads: async (from, to) => {
      const files = Object.values(get().eps).map((e) => e.file).filter((f): f is string => !!f);
      set({ pendingMove: null, dialog: null });
      if (!files.length) return;
      get().toast(`Moving downloaded episodes to ${to}…`);
      const moved = await platform.moveFiles(from, to, files).catch(() => []);
      const map = new Map(moved.map((m) => [m.from, m.to]));
      set((x) => ({ eps: Object.fromEntries(Object.entries(x.eps).map(([k, v]) => [k, v.file && map.has(v.file) ? { ...v, file: map.get(v.file) } : v])) }));
      get().toast(moved.length ? `Moved ${moved.length} episode${moved.length > 1 ? 's' : ''} to ${to}` : 'No files were moved');
      void get().updateUsage();
    },
    deleteFile: async (key, quiet) => {
      const s = get();
      const st = getEp(s, key);
      if (!st.file) return;
      await platform.deleteFile(st.file).catch(() => {});
      const now = get();
      set({ eps: withEp(now.eps, key, { ...getEp(now, key), file: undefined, fileBytes: undefined }) });
      if (!quiet) s.toast(`Deleted “${epInfo(s, key)?.title ?? 'episode'}” from disk`);
    },
    toggleDlPause: () => set((s) => ({ dlPaused: !s.dlPaused })),
    onDownloadEvent: (e) => {
      const s = get();
      const patch = (p: Partial<ActiveDl>) => set({ dl: s.dl.map((d) => (d.key === e.key ? { ...d, ...p } : d)) });
      if (e.type === 'progress') {
        const d = s.dl.find((x) => x.key === e.key);
        patch({ received: e.received, total: e.total || d?.total || 0, speed: e.speed, retryAt: undefined, active: true });
      } else if (e.type === 'retry') {
        patch({ retryAt: e.at, speed: 0, active: false });
      } else if (e.type === 'requeue') {
        patch({ retryAt: undefined, speed: 0, active: false });
      } else if (e.type === 'done') {
        set({
          dl: s.dl.filter((d) => d.key !== e.key),
          dlPending: s.dlPending.filter((k) => k !== e.key),
          eps: { ...s.eps, [e.key]: { ...getEp(s, e.key), file: e.path, fileBytes: e.bytes } },
          dlDone: [{ key: e.key, when: Date.now() }, ...s.dlDone.filter((d) => d.key !== e.key)].slice(0, 50),
        });
        // Streaming may not have allowed reading chapters from the file; try the local copy.
        if (e.key === s.cur && !s.meta[e.key]?.chapters?.length) {
          const meta = { ...get().meta };
          delete meta[e.key];
          set({ meta });
          void get().loadMeta(e.key);
        }
        void get().cleanupStorage({ quiet: true });
      } else {
        patch({ error: e.message, retryAt: undefined, speed: 0, active: false });
        s.toast(`Download failed: ${epInfo(s, e.key)?.title ?? 'episode'} (${e.message})`);
      }
    },
    updateUsage: async () => {
      if (!platform.isDesktop) return;
      const bytes = await platform.diskUsage(get().folder).catch(() => null);
      if (bytes != null) set({ folderBytes: bytes });
    },
    cleanupStorage: async (opts = {}) => {
      const s = get();
      const keys = cleanupKeys({ ...s, sv: s.tg.deletePlayed ? s.sv : { ...s.sv, del: 'never' } });
      for (const k of keys) await get().deleteFile(k, true);
      if (keys.length) s.toast(`Freed space: removed ${keys.length} played episode${keys.length > 1 ? 's' : ''}`);
      if (!opts.quiet && trackedBytes(get().eps) > s.storageLimitGb * GB) s.toast('Storage limit reached — delete episodes or raise the limit in Preferences');
    },
  };
};
