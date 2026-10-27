import { useStore } from './store';

/**
 * The live playback position, in seconds, behind one hook and one getter. The position changes about four times a
 * second, so only components that really show it should read it; everything else reads the rest of the store.
 * `select` can reduce it to something that changes less often (a whole second, a chapter number), and the
 * component then redraws only when that does.
 */
export const usePlayhead = <T,>(select: (pos: number) => T): T => useStore((s) => select(s.pos));

export const getPlayhead = () => useStore.getState().pos;
