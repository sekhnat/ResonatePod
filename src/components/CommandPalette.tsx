import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
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

export function paletteItems(s: PaletteState): PalItem[] {
  const q = s.query.trim().toLowerCase();
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
  const shows = s.shows.map((x) => ({ label: x.title, hint: 'Show', icon: 'ph ph-microphone', run: () => s.openShow(x.id) }));
  const eps: PalItem[] = [];
  s.shows.forEach((x) => x.eps.forEach((e) => eps.push({ label: e.title, hint: x.title, icon: 'ph ph-play-circle', run: () => s.play(`${x.id}:${e.guid}`) })));
  if (s.syncServer) extra.push({ label: 'Sync now', hint: '', icon: 'ph ph-arrows-left-right', run: () => { s.set({ palette: false }); void s.runSync(); } });
  return [...cmds, ...extra, ...shows, ...eps].filter((x) => x.label.toLowerCase().includes(q) || x.hint.toLowerCase().includes(q)).slice(0, 9);
}

export function CommandPalette() {
  const s = useStore(useShallow(palette));
  const ref = useRef<HTMLInputElement>(null);
  const [sel, setSel] = useState(0);
  const items = paletteItems(s);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { setSel(0); }, [s.query]);
  const close = () => s.set({ palette: false });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[sel]) items[sel].run();
      else { s.go('discover', { discoverQuery: s.query }); }
    } else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb,var(--color-bg) 55%,transparent)', backdropFilter: 'blur(2px)', display: 'flex', justifyContent: 'center', paddingTop: 90, zIndex: 10 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette" style={{ width: 540, height: 'fit-content', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', boxShadow: '0 1px 0 var(--color-neutral-800)' }}>
          <i className="ph ph-magnifying-glass" style={{ fontSize: 17, color: 'var(--color-neutral-400)' }} />
          <input ref={ref} value={s.query} onChange={(e) => s.set({ query: e.target.value })} onKeyDown={onKey} placeholder="Type a command, show or episode…" aria-label="Command"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'none', color: 'var(--color-text)', font: 'inherit', fontSize: 15, caretColor: 'var(--color-accent)' }} />
          <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--color-neutral-900)', color: 'var(--color-neutral-400)' }}>Esc</span>
        </div>
        <div role="listbox" style={{ display: 'flex', flexDirection: 'column', padding: 6, maxHeight: 360, overflow: 'auto' }}>
          {items.map((p, i) => (
            <button key={p.label + p.hint} role="option" aria-selected={i === sel} onClick={p.run} onMouseEnter={() => setSel(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', border: 'none', borderRadius: 'var(--radius-md)', background: i === sel ? 'var(--color-neutral-800)' : 'transparent', color: 'var(--color-text)', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}>
              <i className={p.icon} style={{ fontSize: 16, color: 'var(--color-neutral-400)' }} />
              <span style={{ flex: 1 }}>{p.label}</span>
              <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{p.hint}</span>
            </button>
          ))}
          {!items.length && <div style={{ padding: '16px 10px', fontSize: 13, color: 'var(--color-neutral-500)' }}>No matches. Press Enter to search podcast directories.</div>}
        </div>
      </div>
    </div>
  );
}
