import { parseSkipFile, type SkipSegment } from '../../../shared/skips';
import { platform } from '../../platform';
import type { Slice, State } from '../types';
import type { SkipSet } from '../../../shared/skips';

/**
 * Merges a parsed segments file into the episodes: segments are matched to the episode downloaded at the
 * path they were measured on and remember the file's size then, so they stop applying if the episode is
 * downloaded again (see skipsFor). Returns the states to set, how many entries matched the library, how
 * many of those actually changed, and how many files matched nothing.
 */
function mergeSkips(eps: State['eps'], parsed: Map<string, SkipSegment[]>): { eps: State['eps']; matched: number; changed: number; unmatched: number } {
  const byFile = new Map<string, string>();
  for (const [key, st] of Object.entries(eps)) if (st.file) byFile.set(st.file, key);
  const out = { ...eps };
  let matched = 0, changed = 0, unmatched = 0;
  for (const [file, segs] of parsed) {
    const key = byFile.get(file);
    if (!key) { unmatched++; continue; }
    const st = out[key];
    matched++;
    const skips: SkipSet = st.fileBytes != null ? { file, bytes: st.fileBytes, segs } : { file, segs };
    if (sameSegments(st.skips?.segs, skips.segs) && st.skips?.file === file && st.skips?.bytes === skips.bytes) continue;
    out[key] = { ...st, skips };
    changed++;
  }
  return { eps: out, matched, changed, unmatched };
}

/** Same stretches, same categories, same ends: whether the segments an episode has are already what the file says. */
function sameSegments(a: readonly SkipSegment[] | undefined, b: readonly SkipSegment[]): boolean {
  return !!a && a.length === b.length && a.every((s, i) => s.start === b[i].start && s.end === b[i].end && s.cat === b[i].cat);
}

export const createSettingsSlice: Slice<'setOverride' | 'resetOverride' | 'setSort' | 'setToggle' | 'setSetting' | 'setPrefs' | 'setDirectory' | 'setPodcastIndexKey' | 'toggleAutoSkip' | 'importSkips' | 'setSegmentsFile' | 'autoImportSkips'> = (set, get) => {
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
      const { eps, matched, unmatched } = mergeSkips(get().eps, parsed);
      if (matched) set({ eps });
      const missing = unmatched ? ` (${unmatched.toLocaleString()} file${unmatched === 1 ? '' : 's'} not in your library)` : '';
      get().toast(matched ? `Added skip segments to ${matched.toLocaleString()} episode${matched === 1 ? '' : 's'}${missing}` : `No downloaded episodes match ${name}${missing}`);
      return { episodes: matched, unmatched };
    },
    setSegmentsFile: (file) => {
      const path = file?.trim().replace(/\/$/, '');
      set({ segmentsFile: path || null });
    },
    autoImportSkips: (text, name) => {
      let parsed;
      try { parsed = parseSkipFile(text); } catch {
        platform.logError(`Resonate adscan: couldn’t read ${name}`);
        return 0;
      }
      const { eps, changed } = mergeSkips(get().eps, parsed);
      if (changed) {
        set({ eps });
        get().toast(`Updated skip segments for ${changed.toLocaleString()} episode${changed === 1 ? '' : 's'}`);
      }
      return changed;
    },
    setDirectory: (patch) => set((s) => ({ directory: { ...s.directory, ...patch } })),
    setPodcastIndexKey: async (key) => {
      await platform.setSecret('podcastindex', key ? JSON.stringify(key) : null);
      set((s) => ({ directory: { ...s.directory, podcastIndex: !!key, source: !key && s.directory.source === 'podcastindex' ? 'all' : s.directory.source } }));
    },
  };
};
