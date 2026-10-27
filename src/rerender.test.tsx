// Components must not re-render for store changes they don't show: the position ticks about four times a second
// and download progress replaces `dl` just as often, so a whole-store subscription redraws the window constantly.
import { Profiler, act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HeaderBar } from './components/HeaderBar';
import { Sidebar } from './components/Sidebar';
import { useStore } from './store';
import { makeShow } from '../test/perf/fixture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initial = useStore.getState();
const K = 'show-0:show-0-ep-0';

function mount(ui: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let commits = 0;
  act(() => { root.render(<Profiler id="t" onRender={() => { commits++; }}>{ui}</Profiler>); });
  commits = 0; // the first paint doesn't count
  return { container, commits: () => commits, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

const change = (patch: Parameters<typeof useStore.setState>[0]) => act(() => { useStore.setState(patch); });

let view: ReturnType<typeof mount> | null = null;
beforeEach(() => {
  useStore.setState({ ...initial, hydrated: true, shows: [makeShow(0, 3)], eps: { [K]: { played: false, pos: 0, inbox: true } }, showId: 'show-0', cur: K }, true);
});
afterEach(() => { view?.unmount(); view = null; });

describe('the window shell', () => {
  it('stays put while playback advances and downloads make progress', () => {
    view = mount(<><HeaderBar /><Sidebar /></>);
    for (let t = 1; t <= 10; t++) change({ pos: t });
    for (let i = 1; i <= 10; i++) change({ dl: [{ key: K, received: i * 100, total: 5000, speed: 100 }] });
    expect(view.commits()).toBe(1); // the first download row changed the counts (0 → 1 download); the progress after it didn't
  });

  it('does follow the things it shows', () => {
    view = mount(<><HeaderBar /><Sidebar /></>);
    expect(view.container.textContent).toContain('1 unplayed');
    change({ eps: { [K]: { played: true, pos: 0, inbox: true } } });
    expect(view.container.textContent).toContain('0 unplayed');
    change({ queue: [K, K] });
    expect(view.container.querySelector('nav')!.textContent).toContain('Queue2');
  });
});
