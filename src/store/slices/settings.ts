import { parseSkipFile } from '../../../shared/skips';
import { platform } from '../../platform';
import type { Slice } from '../types';

export const createSettingsSlice: Slice<'setOverride' | 'resetOverride' | 'setSort' | 'setToggle' | 'setSetting' | 'setPrefs' | 'setDirectory' | 'setPodcastIndexKey' | 'toggleAutoSkip' | 'importSkips'> = (set, get) => {
  return {
    setOverride: (showId, k, v) =>
      set((s) => {
        const mine = { ...s.ovr[showId], [k]: v };
        if (v === undefined) delete mine[k];
        const ovr = { ...s.ovr };
        if (Object.keys(mine).length) ovr[showId] = mine;
        else delete ovr[showId];
        return { ovr };
      }),
    resetOverride: (showId) =>
      set((s) => {
        const ovr = { ...s.ovr };
        delete ovr[showId];
        return { ovr };
      }),
    setSort: (scope, sort) =>
      set((s) => {
        const sorts = { ...s.sorts };
        if (sort === 'Newest first') delete sorts[scope];
        else sorts[scope] = sort;
        return { sorts };
      }),
    setToggle: (k) => set((s) => ({ tg: { ...s.tg, [k]: !s.tg[k] } })),
    setSetting: (k, v) => set((s) => ({ sv: { ...s.sv, [k]: v } })),
    setPrefs: (patch) => set(patch),
    toggleAutoSkip: (cat) => set((s) => ({ autoSkip: s.autoSkip.includes(cat) ? s.autoSkip.filter((c) => c !== cat) : [...s.autoSkip, cat] })),
    importSkips: (text, name) => {
      let parsed;
      try { parsed = parseSkipFile(text); } catch (err) {
        get().toast(`Couldn’t import ${name}: ${(err as Error).message}`);
        return null;
      }
      const s = get();
      // Segments are matched to the episode downloaded at the path they were measured on, and remember the file's
      // size then, so they stop applying if it is downloaded again (see skipsFor).
      const byFile = new Map<string, string>();
      for (const [key, st] of Object.entries(s.eps)) if (st.file) byFile.set(st.file, key);
      const eps = { ...s.eps };
      let episodes = 0, unmatched = 0;
      for (const [file, segs] of parsed) {
        const key = byFile.get(file);
        if (!key) { unmatched++; continue; }
        const st = eps[key];
        eps[key] = { ...st, skips: st.fileBytes != null ? { file, bytes: st.fileBytes, segs } : { file, segs } };
        episodes++;
      }
      if (episodes) set({ eps });
      const missing = unmatched ? ` (${unmatched.toLocaleString()} file${unmatched === 1 ? '' : 's'} not in your library)` : '';
      get().toast(episodes ? `Added skip segments to ${episodes.toLocaleString()} episode${episodes === 1 ? '' : 's'}${missing}` : `No downloaded episodes match ${name}${missing}`);
      return { episodes, unmatched };
    },
    setDirectory: (patch) => set((s) => ({ directory: { ...s.directory, ...patch } })),
    setPodcastIndexKey: async (key) => {
      await platform.setSecret('podcastindex', key ? JSON.stringify(key) : null);
      set((s) => ({ directory: { ...s.directory, podcastIndex: !!key, source: !key && s.directory.source === 'podcastindex' ? 'all' : s.directory.source } }));
    },
  };
};
