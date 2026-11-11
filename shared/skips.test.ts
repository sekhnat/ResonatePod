import { describe, expect, it } from 'vitest';
import { activeSegment, cleanSegments, isSkipSet, parseSkipFile, skipAt, type SkipCategory, type SkipSegment } from './skips';

const seg = (start: number, end: number, cat: SkipCategory = 'sponsor'): SkipSegment => ({ start, end, cat });
const ads = new Set<SkipCategory>(['sponsor', 'promo']);

describe('parseSkipFile', () => {
  it('reads the exported format, keyed by file path', () => {
    const m = parseSkipFile(JSON.stringify({
      '/p/a.mp3': { duration: 600, kind: 'announcement', segments: [{ start: 0, end: 30, category: 'promo', source: 'fp+text' }] },
      '/p/b.mp3': { segments: [{ start: 10, end: 20, category: 'sponsor' }, { start: 500, end: 520, category: 'outro' }] },
    }));
    expect([...m.keys()]).toEqual(['/p/a.mp3', '/p/b.mp3']);
    expect(m.get('/p/a.mp3')).toEqual([seg(0, 30, 'promo')]);
    expect(m.get('/p/b.mp3')).toEqual([seg(10, 20), seg(500, 520, 'outro')]);
  });

  it('drops what it cannot use and refuses what is not a segments file', () => {
    const m = parseSkipFile(JSON.stringify({
      'relative.mp3': { segments: [{ start: 0, end: 30, category: 'promo' }] },
      '/p/a.mp3': { segments: [{ start: 'x', end: 30, category: 'promo' }, { start: 5, end: 9, category: 'weather' }, { start: 9, end: 9.5, category: 'promo' }] },
      '/p/b.mp3': 'nope',
    }));
    expect(m.size).toBe(0);
    expect(() => parseSkipFile('not json')).toThrow('isn’t JSON');
    expect(() => parseSkipFile('[1, 2]')).toThrow('isn’t a segments file');
  });
});

describe('cleanSegments', () => {
  it('sorts, joins overlaps of one category and trims overlaps of different ones', () => {
    expect(cleanSegments([seg(50, 60), seg(10, 30), seg(25, 40), seg(38, 45, 'outro'), seg(39, 40, 'intro')]))
      .toEqual([seg(10, 40), seg(40, 45, 'outro'), seg(50, 60)]);
  });
});

describe('isSkipSet', () => {
  it('accepts a stored set and rejects malformed ones', () => {
    expect(isSkipSet({ file: '/p/a.mp3', bytes: 10, segs: [seg(1, 5)] })).toBe(true);
    expect(isSkipSet({ file: '/p/a.mp3', segs: [] })).toBe(true);
    expect(isSkipSet({ file: 3, segs: [] })).toBe(false);
    expect(isSkipSet({ file: '/p/a.mp3', segs: [{ start: 1, end: 2, cat: 'weather' }] })).toBe(false);
  });
});

describe('skipAt', () => {
  const segs = [seg(0, 30), seg(100, 160, 'outro'), seg(200, 260), seg(260, 300, 'promo')];

  it('skips a segment playback runs into', () => {
    expect(skipAt(segs, ads, 199.7, 200.1)).toBe(segs[2]);
    expect(skipAt(segs, ads, 199.7, 199.9)).toBeNull();
  });

  it('skips one that starts where the episode is loaded', () => {
    expect(skipAt(segs, ads, null, 0.2)).toBe(segs[0]);
    expect(skipAt(segs, ads, null, 15)).toBeNull();
  });

  it('leaves a segment alone when a person seeks into its middle, or goes back into it', () => {
    expect(skipAt(segs, ads, 120, 230)).toBeNull();
    expect(skipAt(segs, ads, 250, 210)).toBeNull();
    expect(skipAt(segs, ads, 120, 200.1)).toBeNull();
  });

  it('chains straight into the next segment after a jump', () => {
    expect(skipAt(segs, ads, 260, 260.2)).toBe(segs[3]);
  });

  it('skips only enabled categories, and not undone segments or ones nearly over', () => {
    expect(skipAt(segs, ads, 99.8, 100.1)).toBeNull();
    expect(skipAt(segs, new Set(['outro']), 99.8, 100.1)).toBe(segs[1]);
    expect(skipAt(segs, ads, 199.7, 200.1, new Set([segs[2]]))).toBeNull();
    expect(skipAt([seg(10, 10.6)], ads, 9.9, 10.2)).toBeNull();
  });
});

describe('activeSegment', () => {
  it('finds the segment playback is in', () => {
    const segs = [seg(0, 30), seg(100, 160, 'outro')];
    expect(activeSegment(segs, 120)).toBe(segs[1]);
    expect(activeSegment(segs, 60)).toBeNull();
    expect(activeSegment(segs, 160)).toBeNull();
  });
});
