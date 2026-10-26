import { useRef, type CSSProperties } from 'react';
import { art, chaptersFor, fmt, mono } from '../data';
import { currentChapter, epInfo, skipAmounts, useStore, type Sleep } from '../store';
import { MenuItem } from './HeaderBar';
import { GhostIcon, useOutside } from './ui';

/** Click-or-drag horizontal scrubber. Reports a 0–1 fraction. */
export function useScrub(onFrac: (f: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    onFrac(Math.max(0, Math.min(1, (x - r.left) / r.width)));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    at(e.clientX);
    const move = (ev: PointerEvent) => at(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { ref, onPointerDown };
}

export function SeekBar({ height = 14, thumb = true, ticks = true, glow = true, style }: { height?: number; thumb?: boolean; ticks?: boolean; glow?: boolean; style?: CSSProperties }) {
  const s = useStore();
  const cur = epInfo(s, s.cur);
  const scrub = useScrub((f) => cur && s.seek(f * cur.dur));
  if (!cur) return null;
  const pct = `${((s.pos / cur.dur) * 100).toFixed(2)}%`;
  return (
    <div ref={scrub.ref} onPointerDown={scrub.onPointerDown} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(cur.dur)} aria-valuenow={Math.round(s.pos)} aria-valuetext={fmt(s.pos)} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.stopPropagation(); s.skipBack(); } if (e.key === 'ArrowRight') { e.stopPropagation(); s.skipFwd(); } }}
      style={{ flex: 1, height, display: 'flex', alignItems: 'center', position: 'relative', cursor: 'pointer', touchAction: 'none', ...style }}>
      <div style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, background: 'var(--color-neutral-800)' }} />
      <div style={{ position: 'absolute', left: 0, width: pct, height: 4, borderRadius: 2, background: 'var(--color-accent)', boxShadow: glow ? '0 0 8px color-mix(in srgb,var(--color-accent) 60%,transparent)' : undefined }} />
      {ticks && chaptersFor(cur).slice(1).map((c) => (
        <span key={c.t} style={{ position: 'absolute', left: `${(c.at / cur.dur) * 100}%`, width: 2, height: 8, borderRadius: 1, background: 'var(--color-bg)' }} />
      ))}
      {thumb && <span style={{ position: 'absolute', left: pct, width: 10, height: 10, marginLeft: -5, borderRadius: '50%', background: 'var(--color-accent-200)' }} />}
    </div>
  );
}

const SLEEP_OPTIONS: [string, Sleep][] = [
  ['Off', { mode: 'off' }],
  ['15 minutes', { mode: 'timer', minutes: 15, remaining: 900 }],
  ['30 minutes', { mode: 'timer', minutes: 30, remaining: 1800 }],
  ['60 minutes', { mode: 'timer', minutes: 60, remaining: 3600 }],
  ['End of chapter', { mode: 'chapter' }],
  ['End of episode', { mode: 'episode' }],
];

/** Moon button + its menu. `placement` positions the menu relative to the button. */
export function SleepButton({ id, size = 32, iconSize = 16, placement }: { id: 'sleep-bar' | 'sleep-tray'; size?: number; iconSize?: number; placement: CSSProperties }) {
  const s = useStore();
  const open = s.menu === id;
  const ref = useOutside<HTMLDivElement>(open, () => s.set({ menu: null }), `[data-sleep="${id}"] > button`);
  const active = s.sleep.mode !== 'off';
  const isOn = (o: Sleep) => o.mode === s.sleep.mode && (o.mode !== 'timer' || (s.sleep.mode === 'timer' && s.sleep.minutes === o.minutes));
  return (
    <div data-sleep={id} style={{ position: 'relative' }}>
      <GhostIcon icon={active ? 'ph-fill ph-moon' : 'ph ph-moon'} title={active ? `Sleep timer: ${s.sleep.mode === 'timer' ? `${Math.ceil(s.sleep.remaining / 60)} min left` : s.sleep.mode === 'chapter' ? 'end of chapter' : 'end of episode'}` : 'Sleep timer'}
        size={size} iconSize={iconSize} color={active ? 'var(--color-accent)' : 'var(--color-neutral-300)'}
        onClick={() => s.set({ menu: open ? null : id })} />
      {open && (
        <div ref={ref} className="menu" role="menu" style={{ minWidth: 190, ...placement }}>
          <div style={{ padding: '4px 10px 6px', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>Sleep timer</div>
          {SLEEP_OPTIONS.map(([label, o]) => <MenuItem key={label} icon={o.mode === 'off' ? 'ph ph-moon' : o.mode === 'timer' ? 'ph ph-timer' : 'ph ph-flag'} label={label} active={isOn(o)} run={() => s.setSleep(o)} />)}
        </div>
      )}
    </div>
  );
}

function Volume() {
  const s = useStore();
  const scrub = useScrub((f) => s.setVolume(f));
  const v = s.muted ? 0 : s.volume;
  return (
    <>
      <button title={s.muted ? 'Unmute' : 'Mute'} aria-label={s.muted ? 'Unmute' : 'Mute'} onClick={s.toggleMute} className="h-text"
        style={{ border: 'none', background: 'none', padding: 0, marginLeft: 4, color: 'var(--color-neutral-300)', cursor: 'pointer', display: 'grid' }}>
        <i className={s.muted || v === 0 ? 'ph ph-speaker-x' : v < 0.4 ? 'ph ph-speaker-low' : 'ph ph-speaker-high'} style={{ fontSize: 16 }} />
      </button>
      <div ref={scrub.ref} onPointerDown={scrub.onPointerDown} role="slider" aria-label="Volume" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.stopPropagation(); s.setVolume(s.volume - 0.05); } if (e.key === 'ArrowRight') { e.stopPropagation(); s.setVolume(s.volume + 0.05); } }}
        style={{ width: 64, height: 14, display: 'flex', alignItems: 'center', cursor: 'pointer', touchAction: 'none' }}>
        <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'var(--color-neutral-800)' }}>
          <div style={{ width: `${v * 100}%`, height: '100%', borderRadius: 2, background: 'var(--color-neutral-400)' }} />
        </div>
      </div>
    </>
  );
}

export function PlayerBar() {
  const s = useStore();
  const cur = epInfo(s, s.cur);
  if (!cur) return null;
  const ch = chaptersFor(cur);
  const ci = currentChapter(ch, s.pos);
  const [back, fwd] = skipAmounts(s.sv.skip);
  const btn: CSSProperties = { color: 'var(--color-neutral-300)' };

  return (
    <div style={{ height: 78, flex: 'none', display: 'flex', alignItems: 'center', gap: 'var(--space-8)', padding: '0 var(--space-6)', background: 'var(--color-surface)', boxShadow: '0 -1px 0 var(--color-neutral-900)', position: 'relative', zIndex: 7 }}>
      <button onClick={() => s.set({ npFull: true })} title="Open Now playing"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', width: 270, flex: 'none', padding: 0, border: 'none', background: 'none', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ width: 48, height: 48, flex: 'none', borderRadius: 6, background: art(cur.show.hue), display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 600, color: 'var(--color-neutral-100)' }}>{mono(cur.show.title)}</span>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cur.title}</span>
          <span style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cur.show.title} · {ch[ci].t}</span>
        </div>
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <GhostIcon icon="ph ph-skip-back" title="Previous chapter" size={30} style={btn} onClick={s.prevChapter} />
          <GhostIcon icon="ph ph-arrow-counter-clockwise" title={`Back ${back} s`} size={30} iconSize={17} style={btn} onClick={s.skipBack} />
          <button className="btn btn-icon btn-primary" onClick={s.togglePlay} title="Play/Pause (Space)" aria-label={s.playing ? 'Pause' : 'Play'} style={{ width: 40, height: 40, borderRadius: '50%' }}>
            <i className={s.playing ? 'ph-fill ph-pause' : 'ph-fill ph-play'} style={{ fontSize: 16 }} />
          </button>
          <GhostIcon icon="ph ph-arrow-clockwise" title={`Forward ${fwd} s`} size={30} iconSize={17} style={btn} onClick={s.skipFwd} />
          <GhostIcon icon="ph ph-skip-forward" title="Next chapter" size={30} style={btn} onClick={s.nextChapter} />
        </div>
        <div style={{ width: '100%', maxWidth: 560, display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ width: 44, textAlign: 'right' }}>{fmt(s.pos)}</span>
          <SeekBar />
          <span style={{ width: 44 }}>-{fmt((cur.dur - s.pos) / s.speed)}</span>
        </div>
      </div>
      <div style={{ width: 270, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
        <button className="btn btn-secondary" onClick={s.cycleSpeed} title="Playback speed" style={{ fontSize: 12, padding: '3px 8px', minHeight: 0, fontVariantNumeric: 'tabular-nums', width: 48 }}>{s.speed}×</button>
        <SleepButton id="sleep-bar" placement={{ bottom: 40, right: -60 }} />
        <GhostIcon icon="ph ph-sidebar-simple" title="Now playing panel" color={s.npOpen ? 'var(--color-accent)' : 'var(--color-neutral-300)'} style={{ transform: 'scaleX(-1)' }} onClick={() => s.set({ npOpen: !s.npOpen })} />
        <GhostIcon icon="ph ph-queue" title="Queue" color={s.screen === 'queue' ? 'var(--color-accent)' : 'var(--color-neutral-300)'} onClick={() => s.go('queue')} />
        <Volume />
      </div>
    </div>
  );
}
