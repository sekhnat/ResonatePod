import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Episode, Show } from '../data';
import { useStore, type State } from '../store';
import { exportOpmlFile, importOpmlFile } from '../lib/library-io';

export interface PalItem { label: string; hint: string; icon: string; run: () => void }

/** What the palette reads from the store (and nothing it doesn't, so playback ticks don't redraw it). */
const palette = (s: State) => ({
  query: s.query, playing: s.playing, shows: s.shows, dlPaused: s.dlPaused, syncServer: s.sync.server,
  set: s.set, go: s.go, togglePlay: s.togglePlay, refresh: s.refresh, setSpeed: s.setSpeed, setSleep: s.setSleep,
  toggleDlPause: s.toggleDlPause, openShow: s.openShow, play: s.play, runSync: s.runSync,
});
export type PaletteState = ReturnType<typeof palette>;
export const selectPalette = palette;

/** A show or episode to search, with its text already lower-cased (one hint string is shared by all of a show's episodes). */
interface Entry { lower: string; hintLower: string; show: Show; ep?: Episode }

const indexes = new WeakMap<Show[], Entry[]>();

/** Every show, then every episode, in the order results are shown. Built once per list of shows, when first searched. */
export function searchIndex(shows: Show[]): Entry[] {
  let index = indexes.get(shows);
  if (!index) {
    index = shows.map((show) => ({ lower: show.title.toLowerCase(), hintLower: 'show', show }));
    for (const show of shows) {
      const hintLower = show.title.toLowerCase();
      for (const ep of show.eps) index.push({ lower: ep.title.toLowerCase(), hintLower, show, ep });
    }
    indexes.set(shows, index);
  }
  return index;
}

const MAX_RESULTS = 9;

export function paletteItems(s: PaletteState, query = s.query): PalItem[] {
  const q = query.trim().toLowerCase();
  const cmds: PalItem[] = [
    { label: s.playing ? 'Pause' : 'Play', hint: 'Space', icon: 'ph ph-play-pause', run: () => { s.set({ palette: false }); s.togglePlay(); } },
    { label: 'Refresh all feeds', hint: 'Ctrl R', icon: 'ph ph-arrows-clockwise', run: () => { s.set({ palette: false }); void s.refresh(); } },
    { label: 'Go to Downloads', hint: 'Ctrl 4', icon: 'ph ph-download-simple', run: () => s.go('downloads') },
    { label: 'Import OPML…', hint: 'Ctrl O', icon: 'ph ph-file-arrow-up', run: () => { s.set({ palette: false }); void importOpmlFile(); } },
    { label: 'Set speed to 1.5×', hint: '', icon: 'ph ph-gauge', run: () => s.setSpeed(1.5) },
    { label: 'Sleep timer: end of chapter', hint: '', icon: 'ph ph-moon', run: () => s.setSleep({ mode: 'chapter' }) },
    { label: 'Preferences', hint: 'Ctrl ,', icon: 'ph ph-gear-six', run: () => s.go('settings') },
  ];
  if (!q) return cmds;
  const extra: PalItem[] = [
    { label: 'Go to New episodes', hint: 'Ctrl 1', icon: 'ph ph-tray', run: () => s.go('inbox') },
    { label: 'Go to Shows', hint: 'Ctrl 2', icon: 'ph ph-squares-four', run: () => s.go('shows') },
    { label: 'Go to Queue', hint: 'Ctrl 3', icon: 'ph ph-queue', run: () => s.go('queue') },
    { label: 'Go to Discover', hint: 'Ctrl 5', icon: 'ph ph-compass', run: () => s.go('discover') },
    { label: 'Export OPML…', hint: 'Ctrl E', icon: 'ph ph-file-arrow-down', run: () => { s.set({ palette: false }); void exportOpmlFile(); } },
    { label: 'Pause all downloads', hint: '', icon: 'ph ph-pause', run: () => { s.set({ palette: false }); if (!s.dlPaused) s.toggleDlPause(); } },
    { label: 'Sleep timer: off', hint: '', icon: 'ph ph-moon', run: () => s.setSleep({ mode: 'off' }) },
    { label: 'Keyboard shortcuts', hint: 'Ctrl /', icon: 'ph ph-keyboard', run: () => s.set({ palette: false, dialog: 'shortcuts' }) },
  ];
  if (s.syncServer) extra.push({ label: 'Sync now', hint: '', icon: 'ph ph-arrows-left-right', run: () => { s.set({ palette: false }); void s.runSync(); } });
  const out = [...cmds, ...extra].filter((x) => x.label.toLowerCase().includes(q) || x.hint.toLowerCase().includes(q)).slice(0, MAX_RESULTS);
  // Shows and episodes: stop at the ninth hit, and only make a result (and its handler) for a hit.
  for (const e of out.length < MAX_RESULTS ? searchIndex(s.shows) : []) {
    if (!e.lower.includes(q) && !e.hintLower.includes(q)) continue;
    const { show, ep } = e;
    out.push(ep
      ? { label: ep.title, hint: show.title, icon: 'ph ph-play-circle', run: () => s.play(`${show.id}:${ep.guid}`) }
      : { label: show.title, hint: 'Show', icon: 'ph ph-microphone', run: () => s.openShow(show.id) });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/** `value`, once it has stopped changing for `ms`; an empty string shows at once. */
function useDebounced(value: string, ms: number) {
  const [later, setLater] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setLater(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value.trim() ? later : value;
}

export function CommandPalette() {
  const s = useStore(useShallow(palette));
  const ref = useRef<HTMLInputElement>(null);
  const [sel, setSel] = useState(0);
  // Typing stays instant; the search over every episode waits for a pause (and Enter always acts on the current text).
  const q = useDebounced(s.query, 100);
  const items = paletteItems(s, q);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { setSel(0); }, [s.query]);
  const close = () => s.set({ palette: false });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const now = q === s.query ? items : paletteItems(s);
      if (now[sel]) now[sel].run();
      else { s.go('discover', { discoverQuery: s.query }); }
    } else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div className="palette-backdrop" onClick={close}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="palette-input-row">
          <i className="ph ph-magnifying-glass palette-search-icon" />
          <input ref={ref} value={s.query} onChange={(e) => s.set({ query: e.target.value })} onKeyDown={onKey} placeholder="Type a command, show or episode…" aria-label="Command" className="palette-input" />
          <span className="palette-esc">Esc</span>
        </div>
        <div role="listbox" className="palette-list">
          {items.map((p, i) => (
            <button key={p.label + p.hint} role="option" aria-selected={i === sel} onClick={p.run} onMouseEnter={() => setSel(i)} className="palette-item">
              <i className={`${p.icon} palette-item-icon`} />
              <span className="palette-item-label">{p.label}</span>
              <span className="palette-item-hint">{p.hint}</span>
            </button>
          ))}
          {!items.length && <div className="palette-empty">No matches. Press Enter to search podcast directories.</div>}
        </div>
      </div>
    </div>
  );
}
