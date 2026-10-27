import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, upgradeOverrides, upgradeSettings } from './settings';

describe('upgradeSettings', () => {
  it('reads every label an earlier version saved', () => {
    expect(upgradeSettings({ keep: '3', par: '2', speed: '1.2×', del: '1 week', skip: '15 / 30 s' })).toEqual(DEFAULT_SETTINGS);
    expect(upgradeSettings({ keep: 'All', par: '4', speed: '2×', del: 'Never', skip: '30 / 60 s' }))
      .toEqual({ keep: 'all', par: 4, speed: 2, del: 'never', skip: { back: 30, fwd: 60 } });
    expect(upgradeSettings({ keep: '1', par: '1', speed: '1.5×', del: '1 day', skip: '10 / 30 s' }))
      .toEqual({ keep: 1, par: 1, speed: 1.5, del: 'day', skip: { back: 10, fwd: 30 } });
    expect(upgradeSettings({ keep: '5', speed: '1×' }).keep).toBe(5);
    expect(upgradeSettings({ speed: '1×' }).speed).toBe(1);
  });

  it('passes typed values through unchanged, so upgrading twice changes nothing', () => {
    const typed = { keep: 'all', par: 4, speed: 1.75, del: 'day', skip: { back: 20, fwd: 45 } } as const;
    expect(upgradeSettings(typed)).toEqual(typed);
    expect(upgradeSettings(upgradeSettings({ keep: '5', par: '4', speed: '2×', del: 'Never', skip: '30 / 60 s' })))
      .toEqual(upgradeSettings({ keep: '5', par: '4', speed: '2×', del: 'Never', skip: '30 / 60 s' }));
  });

  it('falls back to the default for each field it cannot use, and keeps the ones it can', () => {
    expect(upgradeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(upgradeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(upgradeSettings('1.2×')).toEqual(DEFAULT_SETTINGS);
    expect(upgradeSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(upgradeSettings({ keep: 'many', par: 0, speed: 'fast', del: 'sometimes', skip: 'a / b' })).toEqual(DEFAULT_SETTINGS);
    expect(upgradeSettings({ keep: -2, par: 1.5, speed: -1, skip: { back: 0, fwd: 30 } })).toEqual(DEFAULT_SETTINGS);
    expect(upgradeSettings({ speed: NaN, par: Infinity })).toEqual(DEFAULT_SETTINGS);
    expect(upgradeSettings({ speed: '1.5×', par: 'x' })).toEqual({ ...DEFAULT_SETTINGS, speed: 1.5 });
  });

  it('gives back an object of its own, never the default itself', () => {
    const a = upgradeSettings({});
    a.skip.back = 99;
    expect(DEFAULT_SETTINGS.skip.back).toBe(15);
    expect(upgradeSettings({}).skip.back).toBe(15);
  });
});

describe('upgradeOverrides', () => {
  it('reads every label an earlier version saved, and drops "Global"', () => {
    expect(upgradeOverrides({
      a: { dl: 'Latest 3', speed: '1.5×', trim: 'On', intro: '30 s' },
      b: { dl: 'All', speed: 'Global', trim: 'Off', intro: 'Off' },
      c: { dl: 'Off', trim: 'Global' },
      d: { dl: 'Global', speed: 'Global', trim: 'Global', intro: 'Off' },
      e: {},
    })).toEqual({
      a: { dl: 3, speed: 1.5, trim: true, intro: 30 },
      b: { dl: 'all', trim: false },
      c: { dl: 'off' },
    });
    expect(upgradeOverrides({ a: { dl: 'Latest 1', intro: '90 s', speed: '1×' } })).toEqual({ a: { dl: 1, speed: 1, intro: 90 } });
  });

  it('passes typed overrides through, including an explicit "off" and trim false', () => {
    const typed = { a: { dl: 'off', trim: false }, b: { dl: 5, speed: 1.25, intro: 60 }, c: { dl: 'all', trim: true } } as const;
    expect(upgradeOverrides(typed)).toEqual(typed);
    expect(upgradeOverrides(upgradeOverrides(typed))).toEqual(typed);
  });

  it('ignores what it cannot use', () => {
    expect(upgradeOverrides(undefined)).toEqual({});
    expect(upgradeOverrides('x')).toEqual({});
    expect(upgradeOverrides([1, 2])).toEqual({});
    expect(upgradeOverrides({ a: 'nope', b: null, c: { dl: 'Latest x', speed: 'fast', trim: 'maybe', intro: 'soon' }, d: { dl: 0, speed: 0, intro: 0 } })).toEqual({});
    expect(upgradeOverrides({ a: { dl: 'Latest 2', speed: 'fast' } })).toEqual({ a: { dl: 2 } });
  });
});
