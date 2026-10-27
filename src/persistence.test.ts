import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { makeShow } from '../test/perf/fixture';
import { platform, type Platform } from './platform';
import { diffLibrary, flushSave, hydrate, startPersistence } from './persistence';
import { getPlayhead, setPlayhead } from './playhead';
import { useStore } from './store';

const initial = useStore.getState();
const st = () => useStore.getState();
const K = 'show-0:show-0-ep-0';
const K1 = 'show-0:show-0-ep-1';

let libPatch: MockInstance<Platform['libPatch']>;
const sent = () => libPatch.mock.calls.map((c) => c[0]);

beforeEach(() => {
  useStore.setState({ ...initial, hydrated: true, shows: [makeShow(0, 3, 40)], eps: { [K]: { played: false, pos: 0, inbox: true } } }, true);
  setPlayhead(0);
  libPatch = vi.spyOn(platform, 'libPatch').mockResolvedValue();
  startPersistence();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('saving as the store changes', () => {
  it('writes nothing for playback ticks, download progress or screen changes', async () => {
    st().play(K);
    await flushSave();
    libPatch.mockClear();
    for (let t = 1; t < 20; t++) st().onTime(t);
    useStore.setState({ dl: [{ key: K1, received: 5, total: 10, speed: 1 }], screen: 'queue', toasts: [{ id: 1, text: 'hi' }] });
    await flushSave();
    expect(libPatch).not.toHaveBeenCalled();
  });

  it('saves the position at a checkpoint, as the episode’s state, and nothing else', async () => {
    st().play(K);
    await flushSave();
    libPatch.mockClear();
    for (let t = 1; t < 20; t++) st().onTime(t);
    st().checkpoint();
    await flushSave();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toEqual({ epState: { upsert: { [K]: expect.objectContaining({ pos: 19 }) }, delete: [] } });
    expect(JSON.stringify(sent()[0]).length).toBeLessThan(300);
  });

  it('keeps silence-trim savings out of the saves until the checkpoint', async () => {
    await flushSave();
    libPatch.mockClear();
    for (let i = 0; i < 10; i++) st().addTrimSaved(1.5);
    await flushSave();
    expect(libPatch).not.toHaveBeenCalled();
    st().checkpoint();
    await flushSave();
    expect(sent()).toEqual([{ kv: { trimSaved: 15 } }]);
  });

  it('writes once after a short wait, however many changes happen in it', async () => {
    vi.useFakeTimers();
    startPersistence();
    st().setSpeed(1.5);
    st().setVolume(0.5);
    st().toggleMute();
    await vi.advanceTimersByTimeAsync(1900);
    expect(libPatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(sent()).toEqual([{ kv: { speed: 1.5, volume: 0.5, muted: true } }]);
  });

  it('saves one after another, each covering only what the last did not', async () => {
    let finish!: () => void;
    libPatch.mockImplementationOnce(() => new Promise<void>((ok) => { finish = ok; }));
    st().setSpeed(1.5);
    const first = flushSave();
    await vi.waitFor(() => expect(libPatch).toHaveBeenCalledTimes(1)); // the first save is under way
    st().setVolume(0.5);
    const second = flushSave();
    await new Promise((ok) => setTimeout(ok, 10));
    expect(sent()).toEqual([{ kv: { speed: 1.5 } }]); // the second waits for the first
    finish();
    await Promise.all([first, second]);
    expect(sent()).toEqual([{ kv: { speed: 1.5 } }, { kv: { volume: 0.5 } }]);
  });

  it('sends a change that failed to save again with the next one', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    libPatch.mockRejectedValueOnce(new Error('disk full'));
    st().setSpeed(1.5);
    await flushSave();
    st().setVolume(0.5);
    await flushSave();
    expect(sent()).toEqual([{ kv: { speed: 1.5 } }, { kv: { speed: 1.5, volume: 0.5 } }]);
    expect(err).toHaveBeenCalledOnce();
  });
});

describe('what a change costs', () => {
  const saved = () => ({ shows: st().shows, eps: st().eps, ...Object.fromEntries(Object.entries(st())) }) as Parameters<typeof diffLibrary>[0];
  const withState = (patch: Parameters<typeof useStore.setState>[0]) => { const before = saved(); useStore.setState(patch); return diffLibrary(before, saved()); };

  it('is nothing when nothing saved has changed', () => {
    expect(diffLibrary(saved(), saved())).toBeNull();
    expect(withState({ screen: 'queue', playing: true })).toBeNull();
  });

  it('is a few hundred bytes for an episode marked played, in a library of thousands', () => {
    const big = makeShow(1, 3000, 2048);
    useStore.setState({ shows: [...st().shows, big] });
    const before = saved();
    st().markPlayed(K, true);
    const patch = diffLibrary(before, saved())!;
    expect(Object.keys(patch)).toEqual(['epState']);
    expect(JSON.stringify(patch).length).toBeLessThan(400);
  });

  it('is the show, its place and its episodes for a new subscription', () => {
    const patch = withState({ shows: [...st().shows, makeShow(1, 2, 10)] })!;
    expect(patch.shows).toMatchObject({ upsert: [{ id: 'show-1' }], delete: [], order: ['show-0', 'show-1'] });
    expect(patch.shows!.upsert![0]).not.toHaveProperty('eps');
    expect(patch.episodes!.upsert!.map((e) => `${e.show}:${e.ep.guid}`)).toEqual(['show-1:show-1-ep-0', 'show-1:show-1-ep-1']);
  });

  it('is just the new episode when a refresh finds one, and nothing for the ones that did not change', () => {
    const [show] = st().shows;
    const fresh = { ...show.eps[0], guid: 'new', pubDate: show.eps[0].pubDate + 1 };
    const patch = withState({ shows: [{ ...show, eps: [fresh, ...show.eps] }] })!;
    expect(patch.episodes).toEqual({ upsert: [{ show: 'show-0', ep: fresh }], delete: [] });
    expect(patch.shows).toBeUndefined(); // the show's own fields are the same
  });

  it('names an episode that left the show, and the show whose fields changed', () => {
    const [show] = st().shows;
    const patch = withState({ shows: [{ ...show, title: 'Renamed', eps: show.eps.slice(1) }] })!;
    expect(patch.episodes).toEqual({ upsert: [], delete: [{ show: 'show-0', guid: 'show-0-ep-0' }] });
    expect(patch.shows).toEqual({ upsert: [expect.objectContaining({ id: 'show-0', title: 'Renamed' })], delete: [] });
  });

  it('is a deletion for an unsubscribed show, with its state', () => {
    const patch = withState({ shows: [], eps: {} })!;
    expect(patch.shows).toEqual({ upsert: [], delete: ['show-0'], order: [] });
    expect(patch.epState).toEqual({ upsert: {}, delete: [K] });
  });

  it('is only the order when shows are rearranged', () => {
    useStore.setState({ shows: [...st().shows, makeShow(1, 1, 10)] });
    const [a, b] = st().shows;
    expect(withState({ shows: [b, a] })).toEqual({ shows: { upsert: [], delete: [], order: ['show-1', 'show-0'] } });
  });

  it('is the setting, by name', () => {
    expect(withState({ speed: 2, folder: '~/Pods' })).toEqual({ kv: { speed: 2, folder: '~/Pods' } });
  });
});

describe('reading the library at start-up', () => {
  const snapshot = () => ({
    shows: [{ id: 'a', title: 'A', eps: [{ guid: 'x', pubDate: 5, title: 'X' }] }, { id: 'b', title: 'B', eps: [] }],
    epState: { 'a:x': { played: false, pos: 42, inbox: true } },
    kv: { cur: 'a:x', speed: 1.5, tg: { auto: false }, queue: ['a:x'] },
  });

  it('fills the store, lays saved settings over the defaults, and puts the playhead where the playing episode was', async () => {
    useStore.setState({ ...initial, hydrated: false }, true);
    vi.spyOn(platform, 'libLoad').mockResolvedValue(snapshot() as never);
    await hydrate();
    expect(st()).toMatchObject({ hydrated: true, showId: 'a', cur: 'a:x', speed: 1.5, queue: ['a:x'] });
    expect(st().shows.map((s) => s.id)).toEqual(['a', 'b']);
    expect(st().shows[0].eps[0]).not.toHaveProperty('description');
    expect(st().tg).toEqual({ ...initial.tg, auto: false }); // the toggles this version added are still there
    expect(st().eps['a:x']).toMatchObject({ pos: 42 });
    expect(getPlayhead()).toBe(42);
    expect(st().volume).toBe(initial.volume); // not saved, so the default
  });

  it('does not save what it just read, and saves what changes after', async () => {
    vi.spyOn(platform, 'libLoad').mockResolvedValue(snapshot() as never);
    await hydrate();
    await flushSave();
    expect(libPatch).not.toHaveBeenCalled();
    st().setSpeed(2);
    await flushSave();
    expect(sent()).toEqual([{ kv: { speed: 2 } }]);
  });

  it('opens without saving when the library could not be read, rather than saving over it', async () => {
    useStore.setState({ ...initial, hydrated: false }, true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(platform, 'libLoad').mockRejectedValue(new Error('schema 9'));
    await hydrate();
    expect(st().hydrated).toBe(true);
    expect(st().toasts[0].text).toContain('Changes won’t be saved');
    st().setSpeed(2);
    await flushSave();
    expect(libPatch).not.toHaveBeenCalled();
  });
});

