// Components must not re-render for store changes they don't show: the position ticks about four times a second
// and download progress replaces `dl` just as often, so a whole-store subscription redraws the window constantly.
import { Profiler, act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './components/CommandPalette';
import { Dialogs } from './components/Dialogs';
import { InboxScreen } from './screens/InboxScreen';
import { QueueScreen } from './screens/QueueScreen';
import { ShowScreen } from './screens/ShowScreen';
import { HeaderBar } from './components/HeaderBar';
import { NowPlayingPanel } from './components/NowPlaying';
import { PlayerBar } from './components/PlayerBar';
import { Sidebar } from './components/Sidebar';
import { SettingsScreen } from './screens/SettingsScreen';
import { ShowsScreen } from './screens/ShowsScreen';
import { useStore } from './store';
import { setPlayhead } from './playhead';
import { makeLibrary, makeShow } from '../test/perf/fixture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The player bar's buttons are GhostIcons, which only redraw when the bar's own body does.
const ghost = vi.hoisted(() => ({ renders: 0 }));
vi.mock('./components/ui', async (original) => {
  const ui = await original<typeof import('./components/ui')>();
  return { ...ui, GhostIcon: (p: Parameters<typeof ui.GhostIcon>[0]) => { ghost.renders++; return ui.GhostIcon(p); } };
});

const initial = useStore.getState();
const K = 'show-0:show-0-ep-0';

function mount(ui: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let commits = 0;
  // Pages scroll inside a <main>, which is what the virtual lists look for.
  act(() => { root.render(<main><Profiler id="t" onRender={() => { commits++; }}>{ui}</Profiler></main>); });
  commits = 0; // the first paint doesn't count
  return { container, commits: () => commits, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

const change = (patch: Parameters<typeof useStore.setState>[0]) => act(() => { useStore.setState(patch); });
const move = (pos: number) => act(() => { setPlayhead(pos); });

let view: ReturnType<typeof mount> | null = null;
beforeAll(() => {
  // jsdom does no layout. Give the page and its rows a size so a virtual list has something to mount.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return (this as HTMLElement).tagName === 'MAIN' ? 600 : 60; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 800; } });
});
beforeEach(() => {
  setPlayhead(0);
  useStore.setState({ ...initial, hydrated: true, shows: [makeShow(0, 3)], eps: { [K]: { played: false, pos: 0, inbox: true } }, showId: 'show-0', cur: K }, true);
});
afterEach(() => { view?.unmount(); view = null; });

describe('the player bar', () => {
  it('redraws its buttons for playback changes, not as the position advances', () => {
    view = mount(<PlayerBar />);
    ghost.renders = 0;
    for (let t = 1; t <= 10; t++) move(t * 10);
    for (let i = 1; i <= 10; i++) change({ dl: [{ key: K, received: i * 100, total: 5000, speed: 100 }] });
    expect(ghost.renders).toBe(0);
    // ...while the parts that show the position keep up.
    expect(view.container.querySelector('[aria-label="Seek"]')!.getAttribute('aria-valuenow')).toBe('100');
    expect(view.container.textContent).toContain('1:40');
    change({ playing: true });
    expect(ghost.renders).toBeGreaterThan(0);
  });
});

describe('the now playing panel', () => {
  it('redraws its header and artwork for episode changes, and its chapters when the chapter changes', () => {
    change({ meta: { [K]: { chapters: [{ t: 'Opening', at: 0 }, { t: 'Second half', at: 50 }] } } });
    view = mount(<NowPlayingPanel />);
    expect(view.container.textContent).toContain('1 of 2');
    ghost.renders = 0;
    for (let t = 1; t <= 10; t++) move(t * 4); // up to 40 s, still in the first chapter
    expect(ghost.renders).toBe(0);
    expect(view.commits()).toBe(0);
    move(60);
    expect(view.container.textContent).toContain('2 of 2');
    expect(ghost.renders).toBe(0); // the chapter list redrew, the panel header did not
  });
});

describe('the command palette', () => {
  it('stays put while playback advances, and follows the query', () => {
    change({ palette: true, query: '' });
    view = mount(<CommandPalette />);
    for (let t = 1; t <= 10; t++) move(t);
    expect(view.commits()).toBe(0);
    change({ query: 'episode 3' });
    expect(view.container.textContent).toContain('Episode 3');
  });
});

describe('a long show page', () => {
  const rows = (v: ReturnType<typeof mount>) => v.container.querySelectorAll('.h-row');

  beforeEach(() => {
    const lib = makeLibrary({ shows: 1, episodes: 2000 });
    useStore.setState({ shows: lib.shows, eps: lib.eps, showId: 'show-0', cur: K, screen: 'show' });
  });

  it('mounts only the rows near the top of 2,000 episodes', () => {
    view = mount(<ShowScreen />);
    expect(rows(view).length).toBeGreaterThan(5);
    expect(rows(view).length).toBeLessThan(40);
    expect(view.container.textContent).toContain('2,000'.replace(',', '') + ' episodes');
  });

  it('redraws one row for that episode’s download progress, and none as playback advances', () => {
    view = mount(<ShowScreen />);
    ghost.renders = 0;
    for (let t = 1; t <= 10; t++) move(t * 10);
    expect(ghost.renders).toBe(0);
    for (let i = 1; i <= 10; i++) change({ dl: [{ key: K, received: i * 500, total: 5000, speed: 100 }] });
    expect(ghost.renders).toBe(10 * 3); // three buttons in the one row whose percentage changed, ten times
    expect(view.container.textContent).toContain('100%');
  });

  it('keeps an open row’s notes to that show', () => {
    view = mount(<ShowScreen />);
    act(() => { (view!.container.querySelector('[title="Show notes"]') as HTMLElement).click(); });
    expect(view.container.textContent).toContain('Show notes for this episode');
    change({ showId: 'show-0', filter: 'Unplayed' });
    expect(rows(view).length).toBeGreaterThan(0);
  });
});

describe('episode lists', () => {
  const OTHER = 'show-0:show-0-ep-1';
  it.each([
    ['New episodes', () => <InboxScreen />, {}],
    ['Queue', () => <QueueScreen />, { queue: [K] }],
  ])('%s: rows stay put unless one is the playing episode, whose time left runs live', (_name, ui, extra) => {
    change({ cur: OTHER, ...extra });
    view = mount(ui());
    for (let t = 1; t <= 10; t++) move(t * 10);
    expect(view.commits()).toBe(0);
    change({ cur: K });
    move(100);
    expect(view.container.textContent).toContain('28:20 left'); // 1800 s episode
    move(1000);
    expect(view.container.textContent).toContain('13:20 left');
    expect(view.container.textContent).not.toContain('28:20 left');
  });
});

describe('screens and dialogs that do not show the position', () => {
  it.each([
    ['Dialogs', () => <Dialogs />],
    ['Preferences', () => <SettingsScreen />],
    ['Shows', () => <ShowsScreen />],
  ])('%s stays put while playback advances and downloads make progress', (_name, ui) => {
    view = mount(ui());
    for (let t = 1; t <= 10; t++) move(t);
    for (let i = 1; i <= 10; i++) change({ dl: [{ key: K, received: i * 100, total: 5000, speed: 100 }] });
    expect(view.commits()).toBe(0);
  });
});

describe('the window shell', () => {
  it('stays put while playback advances and downloads make progress', () => {
    view = mount(<><HeaderBar /><Sidebar /></>);
    for (let t = 1; t <= 10; t++) move(t);
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
