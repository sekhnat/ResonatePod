import { create } from 'zustand';

/**
 * The live playback position, in seconds, in a store of its own. It changes about four times a second, so it
 * stays out of the main store, where every change is seen by every subscriber; only the components that show it
 * read it. (The position that survives a restart is saved with the episode's state, on pause and at checkpoints.)
 */
const playhead = create<{ pos: number }>(() => ({ pos: 0 }));

/**
 * Reads the position through `select`, which can reduce it to something that changes less often (a whole second,
 * a chapter number); the component then redraws only when that does.
 */
export const usePlayhead = <T,>(select: (pos: number) => T): T => playhead((s) => select(s.pos));

export const getPlayhead = () => playhead.getState().pos;
export const setPlayhead = (pos: number) => { if (playhead.getState().pos !== pos) playhead.setState({ pos }); };
