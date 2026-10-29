import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrayState } from '../../shared/types';
import { trayPusher } from './tray';

const tray = (over: Partial<TrayState> = {}): TrayState => ({
  title: 'Episode', show: 'Show', playing: false, speed: 1, sleep: 'Off', upNext: [], downloads: 'Nothing downloading', dlPaused: false, ...over,
});

let sent: TrayState[];
let push: (t: TrayState) => void;
beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  push = trayPusher((t) => sent.push(t), 1000);
});
afterEach(() => vi.useRealTimers());

describe('trayPusher', () => {
  it('sends the first state, and ignores a repeat of it', () => {
    push(tray());
    push(tray());
    expect(sent).toHaveLength(1);
  });

  it('sends a change to anything but the download line at once', () => {
    push(tray());
    push(tray({ playing: true }));
    push(tray({ playing: true, speed: 1.5 }));
    expect(sent.map((t) => `${t.playing} ${t.speed}`)).toEqual(['false 1', 'true 1', 'true 1.5']);
  });

  it('sends the download line at most once a second, with the latest text', () => {
    push(tray());
    for (let mb = 100; mb > 92; mb--) {
      vi.advanceTimersByTime(100);
      push(tray({ downloads: `1 active · ${mb} MB remaining` }));
    }
    expect(sent).toHaveLength(1); // 0.8 s of progress: nothing sent yet beyond the first state
    vi.advanceTimersByTime(200);
    expect(sent.map((t) => t.downloads)).toEqual(['Nothing downloading', '1 active · 93 MB remaining']);
  });

  it('sends the first change after a quiet spell straight away', () => {
    push(tray());
    vi.advanceTimersByTime(5000);
    push(tray({ downloads: '1 active · 50 MB remaining' }));
    expect(sent).toHaveLength(2);
  });

  it('carries the waiting download text along with a change to something else', () => {
    push(tray());
    push(tray({ downloads: '1 active · 50 MB remaining' }));
    push(tray({ downloads: '1 active · 49 MB remaining', playing: true }));
    expect(sent.at(-1)).toMatchObject({ playing: true, downloads: '1 active · 49 MB remaining' });
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(2); // the waiting timer went with it
  });

  it('sends nothing when the line goes back to what the desktop already shows', () => {
    push(tray());
    push(tray({ downloads: '1 active · 50 MB remaining' }));
    push(tray());
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);
  });
});
