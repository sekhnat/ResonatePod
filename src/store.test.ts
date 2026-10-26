import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore, getEp, ruleFor } from './store';
import { inboxKeys, totalUnplayed } from './model';

const initial = useStore.getState();
const st = () => useStore.getState();

beforeEach(() => {
  useStore.setState(initial, true);
  vi.useRealTimers();
});

describe('playback', () => {
  it('advances the clock by the playback speed each tick', () => {
    st().tick();
    expect(st().pos).toBeCloseTo(1834 + 1.2);
  });

  it('toggles play when the current episode is played again', () => {
    st().play('kp:1');
    expect(st().playing).toBe(false);
  });

  it('saves progress of the outgoing episode and applies the default speed', () => {
    st().play('ct:0');
    expect(st().cur).toBe('ct:0');
    expect(getEp(st(), 'kp:1').progress).toBeCloseTo(1834 / (64 * 60));
    expect(st().speed).toBe(1.2);
  });

  it('applies the per-show intro skip when starting from the beginning', () => {
    st().setOverride('ct', 'intro', '60 s');
    st().play('ct:0');
    expect(st().pos).toBe(60);
  });

  it('uses skip amounts from preferences', () => {
    st().setSeg('skip', '30 / 60 s');
    st().skipBack();
    expect(st().pos).toBe(1804);
    st().skipFwd();
    expect(st().pos).toBe(1864);
  });

  it('marks the episode played and advances the queue at the end', () => {
    useStore.setState({ pos: 64 * 60 - 0.5 });
    st().tick();
    expect(getEp(st(), 'kp:1').played).toBe(true);
    expect(st().cur).toBe('ct:0');
    expect(st().queue[0]).toBe('ct:0');
  });

  it('stops at the end of the chapter when the sleep timer says so', () => {
    st().setSleep({ mode: 'chapter' });
    // Chapter 3 starts at 2026.67 s in the scaled KP chapter list.
    useStore.setState({ pos: 2026 });
    st().tick();
    expect(st().playing).toBe(false);
    expect(st().sleep.mode).toBe('off');
  });
});

describe('downloads', () => {
  it('only progresses as many downloads as the parallel limit', () => {
    st().tick();
    const [a, b, c] = st().dl;
    expect(a.p).toBeGreaterThan(0.42);
    expect(b.p).toBeGreaterThan(0.08);
    expect(c.p).toBe(0);
  });

  it('moves finished downloads to disk and the completed list', () => {
    useStore.setState({ dl: [{ key: 'kp:0', p: 0.999, mb: 79 }] });
    st().tick();
    expect(st().dl).toHaveLength(0);
    expect(getEp(st(), 'kp:0').downloaded).toBe(true);
    expect(st().dlDone[0].key).toBe('kp:0');
  });

  it('does not progress while paused', () => {
    st().toggleDlPause();
    st().tick();
    expect(st().dl[0].p).toBe(0.42);
  });

  it('deletes a file and frees storage', () => {
    const before = st().usedMb;
    st().deleteFile('kp:1');
    expect(getEp(st(), 'kp:1').downloaded).toBe(false);
    expect(st().usedMb).toBe(before - 70);
  });
});

describe('auto-download rules', () => {
  it('falls back to the global rule', () => {
    expect(ruleFor(st(), 'sa')).toEqual({ value: 'Latest 3', global: true });
    st().setToggle('auto');
    expect(ruleFor(st(), 'sa').value).toBe('Off');
  });

  it('queues downloads on refresh according to each show’s rule', () => {
    vi.useFakeTimers();
    st().refresh();
    vi.advanceTimersByTime(2300);
    const keys = st().dl.map((d) => d.key);
    expect(keys).toContain('kp:0');
    expect(keys).not.toContain('kp:3'); // played
    expect(keys).not.toContain('kp:1'); // already on disk
  });
});

describe('queue and library', () => {
  it('reorders and clears the queue, keeping the current episode', () => {
    st().moveQueue(4, 1);
    expect(st().queue[1]).toBe('se:1');
    st().clearQueue();
    expect(st().queue).toEqual(['kp:1']);
  });

  it('marks all new episodes played except the one playing', () => {
    expect(totalUnplayed(st())).toBe(9);
    st().markAllPlayed();
    expect(inboxKeys(st()).filter((k) => !getEp(st(), k).played)).toEqual(['kp:1']);
  });

  it('subscribes from Discover and unsubscribes again', () => {
    st().toggleDiscover('Packet Loss');
    const show = st().shows.find((x) => x.title === 'Packet Loss');
    expect(show).toBeTruthy();
    st().toggleDiscover('Packet Loss');
    expect(st().shows.find((x) => x.title === 'Packet Loss')).toBeUndefined();
  });

  it('moves playback off a show when it is unsubscribed', () => {
    st().unsubscribe('kp');
    expect(st().shows.some((x) => x.id === 'kp')).toBe(false);
    expect(st().cur.startsWith('kp:')).toBe(false);
    expect(st().queue.some((k) => k.startsWith('kp:'))).toBe(false);
  });

  it('adds a feed by URL once', () => {
    const id = st().addFeed('https://feeds.example.org/show.xml');
    expect(id).toBeTruthy();
    expect(st().addFeed('https://feeds.example.org/show.xml')).toBeNull();
  });
});
