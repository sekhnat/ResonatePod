import { platform } from '../../platform';
import type { Slice } from '../types';

export const createSettingsSlice: Slice<'setOverride' | 'resetOverride' | 'setSort' | 'setToggle' | 'setSeg' | 'setPrefs' | 'setDirectory' | 'setPodcastIndexKey'> = (set) => {
  return {
    setOverride: (showId, k, v) => set((s) => ({ ovr: { ...s.ovr, [showId]: { ...s.ovr[showId], [k]: v } } })),
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
    setSeg: (k, v) => set((s) => ({ sv: { ...s.sv, [k]: v } })),
    setPrefs: (patch) => set(patch),
    setDirectory: (patch) => set((s) => ({ directory: { ...s.directory, ...patch } })),
    setPodcastIndexKey: async (key) => {
      await platform.setSecret('podcastindex', key ? JSON.stringify(key) : null);
      set((s) => ({ directory: { ...s.directory, podcastIndex: !!key, source: !key && s.directory.source === 'podcastindex' ? 'all' : s.directory.source } }));
    },
  };
};
