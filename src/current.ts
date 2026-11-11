import type { Chapter } from './data';
import { chaptersOf, epInfo, skipsFor, useStore } from './store';

const NO_CHAPTERS: Chapter[] = [];

/** The episode playing now. The same object until that episode or its show changes, so it is cheap to select. */
export const useCurrent = () => useStore((s) => epInfo(s, s.cur));

/** Its chapters: the same array until they load or the episode changes. */
export const useChapters = () => useStore((s) => { const cur = epInfo(s, s.cur); return cur ? chaptersOf(s, cur) : NO_CHAPTERS; });

/** Its skip segments: the same array until they change (none for a stream or a file they weren't measured on). */
export const useSkips = () => useStore((s) => skipsFor(s, s.cur));
