import { describe, expect, it } from 'vitest';
import { lastAtOrBefore, pool } from './data';

// What the lookups did before: the last index starting at or before t, found by walking the whole list.
const linear = (at: number[], t: number) => Math.max(0, at.reduce((a, x, i) => (x <= t ? i : a), 0));
const find = (at: number[], t: number) => lastAtOrBefore(at, t, (x) => x);

describe('lastAtOrBefore', () => {
  it('finds the item playing at a time, and sticks to the first before anything has started', () => {
    const chapters = [0, 30, 95, 300];
    expect([-5, 0, 29.9, 30, 94, 95, 299, 300, 9999].map((t) => find(chapters, t))).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3]);
    expect(find([10, 20], 5)).toBe(0); // before the first line
    expect(find([], 5)).toBe(0);
    expect(find([7], 7)).toBe(0);
    expect(find([0, 1], Number.NaN)).toBe(0);
  });

  it('takes the last of several items that start together, as walking the list did', () => {
    expect(find([0, 5, 5, 5, 9], 5)).toBe(3);
    expect(find([0, 5, 5, 5, 9], 8)).toBe(3);
  });

  it('agrees with walking the whole list on random sorted lists', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    for (let n = 0; n < 300; n++) {
      const at = Array.from({ length: Math.floor(rand() * 40) }, () => Math.floor(rand() * 30)).sort((a, b) => a - b);
      for (let t = -1; t <= 31; t += 0.5) expect(find(at, t), `${JSON.stringify(at)} at ${t}`).toBe(linear(at, t));
    }
  });

  it('works on objects through the accessor', () => {
    const lines = [{ at: 0, text: 'a' }, { at: 4, text: 'b' }, { at: 9, text: 'c' }];
    expect(lines[lastAtOrBefore(lines, 5, (l) => l.at)].text).toBe('b');
  });
});

describe('pool', () => {
  it('handles every item, in order, never more than n at once', async () => {
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    await pool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      started.push(n);
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 5 - (n % 3)));
      running--;
    });
    expect(started).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it('does nothing for an empty list, and starts no more workers than there are items', async () => {
    await pool([], 4, async () => { throw new Error('unreachable'); });
    let running = 0;
    let peak = 0;
    await pool(['a'], 4, async () => { peak = Math.max(peak, ++running); await Promise.resolve(); running--; });
    expect(peak).toBe(1);
  });

  it('rejects when a worker throws', async () => {
    await expect(pool([1, 2], 2, async (n) => { if (n === 2) throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
