import { useEffect, useLayoutEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { MenuItem } from './HeaderBar';
import { useOutside } from './ui';

const MARGIN = 4;

/** What right-clicking an episode row offers, shown at the pointer. One for the whole app, so list rows don't each carry one. */
export function EpisodeMenu() {
  const s = useStore(useShallow((s) => ({ m: s.epMenu, set: s.set, playNext: s.playNext, addToQueue: s.addToQueue })));
  const close = () => s.set({ epMenu: null });
  const ref = useOutside<HTMLDivElement>(!!s.m, close);

  // Kept inside the window: moved left or up when the pointer is near the right or bottom edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!s.m || !el) return;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(MARGIN, Math.min(s.m.x, window.innerWidth - width - MARGIN))}px`;
    el.style.top = `${Math.max(MARGIN, Math.min(s.m.y, window.innerHeight - height - MARGIN))}px`;
  }, [s.m, ref]);

  // Scrolling the list (inside <main>) would leave it pointing at another row; leaving the window or resizing it also
  // puts it away. Other scrolling, such as the Now playing transcript following along, leaves it open, and so does
  // a scroll event that arrives late for a scroll from before the menu opened: only the list moving counts.
  useEffect(() => {
    if (!s.m) return;
    const shut = () => useStore.getState().set({ epMenu: null });
    const main = document.querySelector('main');
    const top = main?.scrollTop;
    const onScroll = () => { if (main?.scrollTop !== top) shut(); };
    main?.addEventListener('scroll', onScroll);
    window.addEventListener('blur', shut);
    window.addEventListener('resize', shut);
    return () => {
      main?.removeEventListener('scroll', onScroll);
      window.removeEventListener('blur', shut);
      window.removeEventListener('resize', shut);
    };
  }, [s.m]);

  if (!s.m) return null;
  const { key } = s.m;
  return (
    <div ref={ref} className="menu ep-menu" role="menu" style={{ left: s.m.x, top: s.m.y }} onContextMenu={(e) => e.preventDefault()}>
      <MenuItem icon="ph ph-arrow-line-up" label="Play next" run={() => { close(); s.playNext(key); }} />
      <MenuItem icon="ph ph-queue" label="Add to queue" run={() => { close(); s.addToQueue(key); }} />
    </div>
  );
}
