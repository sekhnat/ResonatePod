// What a person sees and can do on the Downloads and Show screens, driven through the real store.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadsScreen } from './screens/DownloadsScreen';
import { ShowScreen } from './screens/ShowScreen';
import { platform } from './platform';
import { setPlayhead } from './playhead';
import { useStore } from './store';
import { makeShow } from '../test/perf/fixture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
const K = 'show-0:show-0-ep-0';

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
const mount = (ui: React.ReactElement) => {
  container = document.createElement('main'); // pages scroll inside <main>, which the virtual list looks for
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(ui); });
};
const click = (el: Element | null | undefined) => act(() => { (el as HTMLElement).click(); });
const byTitle = (title: string) => container.querySelector(`[title="${title}"]`);
const rowTitles = () => [...container.querySelectorAll('.h-row span[title]')].map((s) => s.textContent);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return (this as HTMLElement).tagName === 'MAIN' ? 800 : 60; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 800; } });
});
beforeEach(() => {
  setPlayhead(0);
  const show = makeShow(0, 6, 40);
  useStore.setState({ ...initial, hydrated: true, shows: [show], eps: {}, showId: 'show-0', screen: 'show' }, true);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the Downloads screen', () => {
  const downloading = (extra: object) => useStore.setState({ dl: [{ key: K, received: 1_000_000, total: 10_000_000, speed: 500_000, active: true, ...extra }] });

  it('shows progress for a running download and lets it be cancelled', () => {
    vi.spyOn(platform, 'download', 'get').mockReturnValue({ ...platform.download, cancel: vi.fn() });
    downloading({});
    mount(<DownloadsScreen />);
    expect(container.textContent).toContain('1.0 / 10 MB');
    expect(container.textContent).toContain('488 KB/s');
    expect(byTitle('Retry now')).toBeNull();
    click(byTitle('Cancel download'));
    expect(useStore.getState().dl).toEqual([]);
    expect(container.textContent).toContain('Nothing downloading right now.');
  });

  it('counts down to the next retry, offers to retry now, and shows a failure as one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 28, 12, 0, 0));
    downloading({ active: false, retryAt: Date.now() + 5000 });
    mount(<DownloadsScreen />);
    expect(container.textContent).toContain('Retrying in 5 s');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(container.textContent).toContain('Retrying in 2 s');
    expect(byTitle('Retry now')).not.toBeNull();
    act(() => { downloading({ active: false, retryAt: undefined, error: 'HTTP 404' }); });
    expect(container.textContent).toContain('Failed · HTTP 404');
    expect(byTitle('Remove')).not.toBeNull();
  });

  it('starts a failed download again when asked', () => {
    const start = vi.spyOn(platform.download, 'start').mockImplementation(() => {});
    vi.spyOn(platform, 'isDesktop', 'get').mockReturnValue(true);
    downloading({ active: false, error: 'the connection closed early' });
    mount(<DownloadsScreen />);
    click(byTitle('Retry now'));
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][0].key).toBe(K);
  });
});

describe('the Show screen', () => {
  const sort = (value: string) => act(() => {
    const select = container.querySelector('select[aria-label="Sort episodes"]') as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const filter = (name: string) => click([...container.querySelectorAll('[role="radio"]')].find((b) => b.textContent === name));

  it('lists the episodes newest first, and sorts and filters them', () => {
    mount(<ShowScreen />);
    expect(rowTitles()[0]).toContain('Episode 6');
    expect(rowTitles()).toHaveLength(6);
    sort('Oldest first');
    expect(rowTitles()[0]).toContain('Episode 1:');
    expect(useStore.getState().sorts['show-0']).toBe('Oldest first');
    useStore.setState({ eps: { 'show-0:show-0-ep-5': { played: true, pos: 0, inbox: false }, 'show-0:show-0-ep-4': { played: true, pos: 0, inbox: false } } });
    filter('Unplayed');
    expect(rowTitles()).toHaveLength(4);
    filter('Downloaded');
    expect(container.textContent).toContain('No downloaded episodes in this show.');
    filter('All');
    expect(rowTitles()).toHaveLength(6);
  });

  it('marks an episode played from its row, which moves it out of Unplayed', () => {
    mount(<ShowScreen />);
    filter('Unplayed');
    expect(rowTitles()).toHaveLength(6);
    click(byTitle('Mark played'));
    expect(useStore.getState().eps[K]).toMatchObject({ played: true });
    expect(rowTitles()).toHaveLength(5);
  });

  // (Rows are keyed by episode, so this holds with or without the page being keyed by show; the page key matters for the list's own state.)
  it('does not carry an open row over to another show', () => {
    useStore.setState({ shows: [...useStore.getState().shows, makeShow(1, 3, 40)] });
    vi.spyOn(platform, 'libNotes').mockResolvedValue('notes');
    mount(<ShowScreen />);
    click(byTitle('Show notes'));
    expect(byTitle('Hide show notes')).not.toBeNull();
    act(() => { useStore.setState({ showId: 'show-1' }); });
    expect(container.textContent).toContain('Stress Show 1');
    expect(byTitle('Hide show notes')).toBeNull();
  });
});
