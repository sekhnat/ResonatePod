import { findShow } from '../selectors';
import type { Slice } from '../types';

export const createUiSlice: Slice<'go' | 'goBack' | 'openShow' | 'set' | 'toast' | 'dismissToast'> = (set, get) => {
  let toastId = 0;

  return {
    go: (screen, extra) =>
      set((s) => ({ screen, history: [...s.history, { screen: s.screen, showId: s.showId }].slice(-50), palette: false, menu: null, npFull: false, ...extra })),
    goBack: () =>
      set((s) => {
        const h = [...s.history];
        const p = h.pop();
        return p ? { screen: p.screen, showId: findShow(s, p.showId) ? p.showId : s.showId, history: h } : {};
      }),
    openShow: (id) => get().go('show', { showId: id }),
    set: (patch) => set(patch),
    toast: (text) => {
      const id = ++toastId;
      set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text }] }));
      setTimeout(() => get().dismissToast(id), 3800);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  };
};
