// `npm run test:perf`: fails when a hot path gets slower than its budget. Off by default, because timings
// depend on the machine; budgets leave room for a slow CI runner. Each Phase 2 change tightens its own line.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFeed } from '../../shared/feed';
import { inboxKeys, rowsFor, totalUnplayed } from '../../src/model';
import { epKey } from '../../src/data';
import { setPlayhead } from '../../src/playhead';
import { ShowScreen } from '../../src/screens/ShowScreen';
import { useStore } from '../../src/store';
import { makeFeedXml, makeLibrary, measure, stateWith } from './fixture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Set at about three times what each took when they were added (58, 7, 15, 125 and 31 ms on a laptop).
const BUDGET_MS = {
  rowsFor: 16, // one 2,000-episode show: a frame; it took 58 ms before epInfo was indexed
  inboxKeys: 40, // when recomputed (about 12 ms) (the result is cached per library state); goal 5, which needs Phase 3's sparse inbox
  totalUnplayed: 50, // when recomputed; the sidebar asks on every render and now almost always hits the cache
  stringify: 400, // the whole library; Phase 3 stops doing this on every save
  parseFeed: 120, // 2,000 episodes, ~4.6 MB
  showPageUpdate: 30, // the 2,000-episode show page re-sorting and redrawing after an episode's state changes; the goal is a frame (16), 9 here, and 21 before the order was built from light records
  showPageTick: 4, // the same page for one playback tick plus one download progress event
};

describe.skipIf(!process.env.PERF)('performance budgets', () => {
  const lib = makeLibrary();
  const s = stateWith(lib);
  const keys = lib.shows[0].eps.map((e) => epKey(lib.shows[0].id, e.guid));
  const feed = makeFeedXml(2000);
  // inboxKeys and the unread counts are cached per library state, so they are timed on states they haven't seen.
  const fresh = Array.from({ length: 8 }, () => stateWith({ shows: lib.shows, eps: { ...lib.eps } }));
  let next = 0;
  const unseen = () => fresh[next++ % fresh.length];
  const timings: Record<string, number> = {};
  const within = (name: keyof typeof BUDGET_MS, fn: () => unknown, runs?: number) => {
    timings[name] = measure(fn, runs);
    expect(timings[name], `${name} took ${timings[name].toFixed(1)} ms; budget ${BUDGET_MS[name]} ms`).toBeLessThan(BUDGET_MS[name]);
  };

  it('builds the rows for a 2,000-episode show', () => within('rowsFor', () => rowsFor(s, keys)));
  it('lists the inbox', () => within('inboxKeys', () => inboxKeys(unseen())));
  it('counts unread for the sidebar', () => within('totalUnplayed', () => totalUnplayed(unseen())));
  it('serialises the library', () => within('stringify', () => JSON.stringify({ state: lib, version: 2 }), 3));
  it('parses a 2,000-episode feed', () => within('parseFeed', () => parseFeed(feed)));
  describe('the show page', () => {
    // jsdom does no layout: give the page and its rows a size so the virtual list mounts rows as it would on screen.
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    const container = document.createElement('main');
    const root = createRoot(container);
    const K = epKey('show-0', 'show-0-ep-0');
    beforeAll(() => {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return (this as HTMLElement).tagName === 'MAIN' ? 700 : 62; } });
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 900; } });
      useStore.setState({ ...useStore.getState(), hydrated: true, shows: lib.shows, eps: lib.eps, showId: 'show-0', cur: K, screen: 'show' });
      document.body.appendChild(container);
      act(() => { root.render(createElement(ShowScreen)); });
    });
    afterAll(() => {
      act(() => root.unmount());
      container.remove();
      if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
      if (offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
    });

    it('redraws after an episode’s state changes', () => {
      let n = 0;
      within('showPageUpdate', () => act(() => { useStore.setState({ eps: { ...useStore.getState().eps, [K]: { played: false, pos: ++n, inbox: true } } }); }));
    });
    it('redraws for a playback tick and a download progress event', () => {
      let n = 0;
      within('showPageTick', () => act(() => {
        n++;
        setPlayhead(n);
        useStore.setState({ dl: [{ key: K, received: n * 100, total: 1e6, speed: 100 }] });
      }), 20);
    });
  });

  it('prints the numbers', () => {
    console.table(Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, { 'ms': +v.toFixed(1), 'budget ms': BUDGET_MS[k as keyof typeof BUDGET_MS] }])));
  });
});
