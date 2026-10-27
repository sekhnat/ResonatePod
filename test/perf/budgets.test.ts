// `npm run test:perf`: fails when a hot path gets slower than its budget. Off by default, because timings
// depend on the machine; budgets leave room for a slow CI runner. Each Phase 2 change tightens its own line.
import { describe, expect, it } from 'vitest';
import { parseFeed } from '../../shared/feed';
import { inboxKeys, rowsFor, totalUnplayed } from '../../src/model';
import { epKey } from '../../src/data';
import { makeFeedXml, makeLibrary, measure, stateWith } from './fixture';

// Set at about three times what each took when they were added (58, 7, 15, 125 and 31 ms on a laptop).
const BUDGET_MS = {
  rowsFor: 16, // one 2,000-episode show: a frame; it took 58 ms before epInfo was indexed
  inboxKeys: 25, // goal 5
  totalUnplayed: 50, // the sidebar runs this on every render
  stringify: 400, // the whole library; Phase 3 stops doing this on every save
  parseFeed: 120, // 2,000 episodes, ~4.6 MB
};

describe.skipIf(!process.env.PERF)('performance budgets', () => {
  const lib = makeLibrary();
  const s = stateWith(lib);
  const keys = lib.shows[0].eps.map((e) => epKey(lib.shows[0].id, e.guid));
  const feed = makeFeedXml(2000);
  const timings: Record<string, number> = {};
  const within = (name: keyof typeof BUDGET_MS, fn: () => unknown, runs?: number) => {
    timings[name] = measure(fn, runs);
    expect(timings[name], `${name} took ${timings[name].toFixed(1)} ms; budget ${BUDGET_MS[name]} ms`).toBeLessThan(BUDGET_MS[name]);
  };

  it('builds the rows for a 2,000-episode show', () => within('rowsFor', () => rowsFor(s, keys)));
  it('lists the inbox', () => within('inboxKeys', () => inboxKeys(s)));
  it('counts unread for the sidebar', () => within('totalUnplayed', () => totalUnplayed(s)));
  it('serialises the library', () => within('stringify', () => JSON.stringify({ state: lib, version: 2 }), 3));
  it('parses a 2,000-episode feed', () => within('parseFeed', () => parseFeed(feed)));
  it('prints the numbers', () => {
    console.table(Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, { 'ms': +v.toFixed(1), 'budget ms': BUDGET_MS[k as keyof typeof BUDGET_MS] }])));
  });
});
