import type { Chapter } from './data';
import { chaptersOf, epInfo, useStore } from './store';

const NO_CHAPTERS: Chapter[] = [];

/** The episode playing now. The same object until that episode or its show changes, so it is cheap to select. */
export const useCurrent = () => useStore((s) => epInfo(s, s.cur));

/** Its chapters: the same array until they load or the episode changes. */
export const useChapters = () => useStore((s) => { const cur = epInfo(s, s.cur); return cur ? chaptersOf(s, cur) : NO_CHAPTERS; });
