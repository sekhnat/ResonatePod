// `npm run bench`: how long the hot paths take on a library of 20 shows × 2,000 episodes.
import { bench, describe } from 'vitest';
import { parseFeed } from '../../shared/feed';
import { inboxKeys, rowsFor, totalUnplayed } from '../../src/model';
import { epKey } from '../../src/data';
import { makeFeedXml, makeLibrary, stateWith } from './fixture';

const lib = makeLibrary();
const s = stateWith(lib);
const keys = lib.shows[0].eps.map((e) => epKey(lib.shows[0].id, e.guid));
const feed = makeFeedXml(2000);

describe('render paths', () => {
  bench('rowsFor: one 2,000-episode show', () => { rowsFor(s, keys); });
  bench('inboxKeys', () => { inboxKeys(s); });
  bench('totalUnplayed (sidebar)', () => { totalUnplayed(s); });
});

describe('persistence and feeds', () => {
  bench('JSON.stringify the library', () => { JSON.stringify({ state: lib, version: 2 }); }, { iterations: 3, time: 0 });
  bench('parseFeed: 2,000 episodes', () => { parseFeed(feed); }, { iterations: 5, time: 0 });
});
