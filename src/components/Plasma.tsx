import { art, chaptersFor, fmt, mono } from '../data';
import { currentChapter, epInfo, useStore } from '../store';
import { dlSummary, rowsFor } from '../model';
import { SeekBar, SleepButton } from './PlayerBar';
import { GhostIcon, useOutside } from './ui';

function Clock() {
  const d = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.15, fontSize: 11.5 }}>
      <span>{time}</span><span style={{ fontSize: 10, color: 'var(--color-neutral-500)' }}>{date}</span>
    </div>
  );
}

/** Mock KDE Plasma panel giving the window its desktop context. */
export function PlasmaPanel() {
  const s = useStore();
  const restore = () => s.set({ windowHidden: !s.windowHidden });
  return (
    <div className="plasma" data-screen-label="Plasma panel" style={{ height: 44, display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '0 var(--space-4)', borderRadius: 'var(--radius-md)', background: 'color-mix(in srgb,var(--color-surface) 85%,black)', boxShadow: 'var(--shadow-sm)' }}>
      <i className="ph ph-squares-four" style={{ fontSize: 20, color: 'var(--color-neutral-300)' }} />
      <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
        <button onClick={restore} title={s.windowHidden ? 'Show Resonate' : 'Minimize Resonate'} className="h-n800"
          style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px', border: 'none', borderRadius: 6, background: s.windowHidden ? 'transparent' : 'var(--color-neutral-900)', color: s.windowHidden ? 'var(--color-neutral-400)' : 'var(--color-text)', fontSize: 12, cursor: 'pointer', boxShadow: s.windowHidden ? 'inset 0 -2px 0 var(--color-neutral-700)' : 'inset 0 -2px 0 var(--color-accent)' }}>
          <i className="ph-fill ph-waveform" style={{ color: 'var(--color-accent)', fontSize: 15 }} />Resonate
        </button>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px', borderRadius: 6, fontSize: 12, color: 'var(--color-neutral-400)' }}><i className="ph ph-folder" style={{ fontSize: 15 }} />Dolphin</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px', borderRadius: 6, fontSize: 12, color: 'var(--color-neutral-400)' }}><i className="ph ph-terminal-window" style={{ fontSize: 15 }} />Konsole</span>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', color: 'var(--color-neutral-300)' }}>
        <button data-tray-trigger onClick={() => s.set({ trayOpen: !s.trayOpen })} title="Resonate" aria-label="Resonate tray" aria-expanded={s.trayOpen} className="h-n800"
          style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 6, background: s.trayOpen ? 'var(--color-neutral-800)' : 'transparent', color: 'var(--color-accent)', cursor: 'pointer', position: 'relative' }}>
          <i className={s.playing ? 'ph-fill ph-waveform' : 'ph ph-waveform'} style={{ fontSize: 17 }} />
        </button>
        <i className="ph ph-wifi-high" style={{ fontSize: 16 }} />
        <i className={s.muted ? 'ph ph-speaker-x' : 'ph ph-speaker-high'} style={{ fontSize: 16 }} />
        <i className="ph ph-battery-high" style={{ fontSize: 17 }} />
        <Clock />
      </div>
    </div>
  );
}

/** The Plasma system-tray popover: a mini player. */
export function TrayPopover() {
  const s = useStore();
  const ref = useOutside<HTMLDivElement>(s.trayOpen && !s.trayPinned, () => s.set({ trayOpen: false }), '[data-tray-trigger]');
  const cur = epInfo(s, s.cur);
  if (!cur) return null;
  const ch = chaptersFor(cur);
  const ci = currentChapter(ch, s.pos);
  const upNext = rowsFor(s, s.queue.filter((k) => k !== s.cur)).slice(0, 2);
  const btn = { color: 'var(--color-neutral-300)' };

  return (
    <div ref={ref} data-screen-label="Tray popover" role="dialog" aria-label="Resonate mini player"
      style={{ position: 'absolute', right: 96, bottom: 54, zIndex: 20, width: 340, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'color-mix(in srgb,var(--color-surface) 92%,black)', boxShadow: 'var(--shadow-lg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 500 }}><i className="ph-fill ph-waveform" style={{ color: 'var(--color-accent)', fontSize: 15 }} />Resonate</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <GhostIcon icon={s.refreshing ? 'ph ph-circle-notch spin' : 'ph ph-arrows-clockwise'} title="Refresh feeds" size={26} iconSize={14} color="var(--color-text)" onClick={s.refresh} />
          <GhostIcon icon="ph ph-arrow-square-out" title="Open window" size={26} iconSize={14} color="var(--color-text)" onClick={() => s.set({ trayOpen: false, windowHidden: false })} />
          <GhostIcon icon={s.trayPinned ? 'ph-fill ph-push-pin' : 'ph ph-push-pin'} title={s.trayPinned ? 'Unpin' : 'Pin'} size={26} iconSize={14} color={s.trayPinned ? 'var(--color-accent)' : 'var(--color-text)'} onClick={() => s.set({ trayPinned: !s.trayPinned })} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
        <span style={{ width: 64, height: 64, flex: 'none', borderRadius: 'var(--radius-md)', background: art(cur.show.hue), display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 500, color: 'var(--color-neutral-100)' }}>{mono(cur.show.title)}</span>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.25 }}>{cur.title}</span>
          <span style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cur.show.title} · {ch[ci].t}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SeekBar height={12} thumb={false} ticks={false} glow={false} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--color-neutral-500)', fontVariantNumeric: 'tabular-nums' }}>
          <span>{fmt(s.pos)}</span><span>-{fmt((cur.dur - s.pos) / s.speed)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button className="btn btn-secondary" onClick={s.cycleSpeed} title="Playback speed" style={{ fontSize: 11.5, padding: '3px 8px', minHeight: 0, width: 46, fontVariantNumeric: 'tabular-nums' }}>{s.speed}×</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <GhostIcon icon="ph ph-arrow-counter-clockwise" title="Skip back" size={30} style={btn} onClick={s.skipBack} />
          <button className="btn btn-icon btn-primary" onClick={s.togglePlay} aria-label={s.playing ? 'Pause' : 'Play'} style={{ width: 38, height: 38, borderRadius: '50%' }}>
            <i className={s.playing ? 'ph-fill ph-pause' : 'ph-fill ph-play'} style={{ fontSize: 15 }} />
          </button>
          <GhostIcon icon="ph ph-arrow-clockwise" title="Skip forward" size={30} style={btn} onClick={s.skipFwd} />
        </div>
        <SleepButton id="sleep-tray" size={30} iconSize={15} placement={{ bottom: 36, right: 0 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 'var(--space-3)', boxShadow: '0 -1px 0 var(--color-neutral-800)' }}>
        <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>Up next</span>
        {upNext.map((e) => (
          <button key={e.key} className="h-n800" onClick={() => s.play(e.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 6px', margin: '0 -6px', border: 'none', borderRadius: 6, background: 'none', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
            <span style={{ width: 26, height: 26, flex: 'none', borderRadius: 4, background: e.art, display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 600, color: 'var(--color-neutral-100)' }}>{e.mono}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{e.durMin} min</span>
          </button>
        ))}
        {!upNext.length && <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Queue is empty</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--color-neutral-400)' }}>
        <i className="ph ph-download-simple" style={{ fontSize: 14 }} />
        <span style={{ flex: 1 }}>{dlSummary(s)}</span>
        <button className="btn btn-ghost" onClick={s.toggleDlPause} style={{ fontSize: 11.5, padding: '2px 6px', minHeight: 0 }}>{s.dlPaused ? 'Resume all' : 'Pause all'}</button>
      </div>
    </div>
  );
}
