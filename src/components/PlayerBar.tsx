import { useRef, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { art, fmt, mono, type Chapter } from '../data';
import { currentChapter, useStore, type Sleep } from '../store';
import { useChapters, useCurrent } from '../current';
import { usePlayhead } from '../playhead';
import { MenuItem } from './HeaderBar';
import { Art, GhostIcon, useOutside } from './ui';

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
  const cur = useCurrent();
  const chapters = useChapters();
  const pos = usePlayhead((p) => p);
  const { seek, skipBack, skipFwd } = useStore(useShallow((s) => ({ seek: s.seek, skipBack: s.skipBack, skipFwd: s.skipFwd })));
  const scrub = useScrub((f) => cur && cur.dur && seek(f * cur.dur));
  if (!cur) return null;
  const pct = `${cur.dur ? Math.min(100, (pos / cur.dur) * 100).toFixed(2) : 0}%`;
  return (
    <div ref={scrub.ref} onPointerDown={scrub.onPointerDown} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(cur.dur)} aria-valuenow={Math.round(pos)} aria-valuetext={fmt(pos)} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.stopPropagation(); skipBack(); } if (e.key === 'ArrowRight') { e.stopPropagation(); skipFwd(); } }}
      className="seek" style={{ height, ...style }}>
      <div className="seek-track" />
      <div className={`seek-fill${glow ? ' glow' : ''}`} style={{ width: pct }} />
      {ticks && !!cur.dur && chapters.slice(1).map((c) => (
        <span key={`${c.at}-${c.t}`} className="seek-tick" style={{ left: `${(c.at / cur.dur) * 100}%` }} />
      ))}
      {thumb && <span className="seek-thumb" style={{ left: pct }} />}
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
export function SleepButton({ id, size = 32, iconSize = 16, placement }: { id: 'sleep-bar'; size?: number; iconSize?: number; placement: CSSProperties }) {
  const s = useStore(useShallow((s) => ({ menu: s.menu, sleep: s.sleep, set: s.set, setSleep: s.setSleep })));
  const open = s.menu === id;
  const ref = useOutside<HTMLDivElement>(open, () => s.set({ menu: null }), `[data-sleep="${id}"] > button`);
  const active = s.sleep.mode !== 'off';
  const isOn = (o: Sleep) => o.mode === s.sleep.mode && (o.mode !== 'timer' || (s.sleep.mode === 'timer' && s.sleep.minutes === o.minutes));
  return (
    <div data-sleep={id} className="sleep-wrap">
      <GhostIcon icon={active ? 'ph-fill ph-moon' : 'ph ph-moon'} title={active ? `Sleep timer: ${s.sleep.mode === 'timer' ? `${Math.ceil(s.sleep.remaining / 60)} min left` : s.sleep.mode === 'chapter' ? 'end of chapter' : 'end of episode'}` : 'Sleep timer'}
        size={size} iconSize={iconSize} color={active ? 'var(--color-accent)' : 'var(--color-neutral-300)'}
        onClick={() => s.set({ menu: open ? null : id })} />
      {open && (
        <div ref={ref} className="menu sleep-menu" role="menu" style={placement}>
          <div className="menu-heading">Sleep timer</div>
          {SLEEP_OPTIONS.map(([label, o]) => <MenuItem key={label} icon={o.mode === 'off' ? 'ph ph-moon' : o.mode === 'timer' ? 'ph ph-timer' : 'ph ph-flag'} label={label} active={isOn(o)} run={() => s.setSleep(o)} />)}
        </div>
      )}
    </div>
  );
}

function Volume() {
  const s = useStore(useShallow((s) => ({ muted: s.muted, volume: s.volume, setVolume: s.setVolume, toggleMute: s.toggleMute })));
  const scrub = useScrub((f) => s.setVolume(f));
  const v = s.muted ? 0 : s.volume;
  return (
    <>
      <button title={s.muted ? 'Unmute' : 'Mute'} aria-label={s.muted ? 'Unmute' : 'Mute'} onClick={s.toggleMute} className="h-text vol-btn">
        <i className={`${s.muted || v === 0 ? 'ph ph-speaker-x' : v < 0.4 ? 'ph ph-speaker-low' : 'ph ph-speaker-high'} vol-icon`} />
      </button>
      <div ref={scrub.ref} onPointerDown={scrub.onPointerDown} role="slider" aria-label="Volume" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.stopPropagation(); s.setVolume(s.volume - 0.05); } if (e.key === 'ArrowRight') { e.stopPropagation(); s.setVolume(s.volume + 0.05); } }}
        className="vol-slider">
        <div className="vol-track">
          <div className="vol-fill" style={{ width: `${v * 100}%` }} />
        </div>
      </div>
    </>
  );
}

/** The time played, redrawn once a second rather than on every position update. */
function Elapsed() {
  return <>{usePlayhead((p) => fmt(p))}</>;
}

function Remaining({ dur, speed }: { dur: number; speed: number }) {
  return <>{usePlayhead((p) => (dur ? `-${fmt((dur - p) / speed)}` : '--:--'))}</>;
}

/** The title of the chapter playing, which changes a few times an episode. */
function ChapterName({ chapters }: { chapters: Chapter[] }) {
  return <>{chapters[usePlayhead((p) => currentChapter(chapters, p))].t}</>;
}

export function PlayerBar() {
  const s = useStore(useShallow((s) => ({
    playing: s.playing, speed: s.speed, skip: s.sv.skip, npOpen: s.npOpen, screen: s.screen,
    set: s.set, go: s.go, prevChapter: s.prevChapter, nextChapter: s.nextChapter, skipBack: s.skipBack, skipFwd: s.skipFwd,
    togglePlay: s.togglePlay, cycleSpeed: s.cycleSpeed,
  })));
  const cur = useCurrent();
  const ch = useChapters();
  const { back, fwd } = s.skip;
  if (!cur) return <IdleBar />;
  const btn = 'var(--color-neutral-300)';

  return (
    <div className="player live">
      <button className="player-now" onClick={() => s.set({ npFull: true })} title="Open Now playing">
        <Art bg={art(cur.show.hue)} mono={mono(cur.show.title)} img={cur.ep.imageUrl ?? cur.show.imageUrl} size={48} font={14} />
        <div className="player-now-text">
          <span className="player-title">{cur.title}</span>
          <span className="player-sub">{cur.show.title} · <ChapterName chapters={ch} /></span>
        </div>
      </button>
      <div className="player-center">
        <div className="player-controls">
          <GhostIcon icon="ph ph-skip-back" title="Previous chapter" size={30} color={btn} onClick={s.prevChapter} />
          <GhostIcon icon="ph ph-arrow-counter-clockwise" title={`Back ${back} s`} size={30} iconSize={17} color={btn} onClick={s.skipBack} />
          <button className="btn btn-icon btn-primary player-play" onClick={s.togglePlay} title="Play/Pause (Space)" aria-label={s.playing ? 'Pause' : 'Play'}>
            <i className={s.playing ? 'ph-fill ph-pause' : 'ph-fill ph-play'} />
          </button>
          <GhostIcon icon="ph ph-arrow-clockwise" title={`Forward ${fwd} s`} size={30} iconSize={17} color={btn} onClick={s.skipFwd} />
          <GhostIcon icon="ph ph-skip-forward" title="Next chapter" size={30} color={btn} onClick={s.nextChapter} />
        </div>
        <div className="player-time">
          <span className="player-elapsed"><Elapsed /></span>
          <SeekBar />
          <span className="player-remaining"><Remaining dur={cur.dur} speed={s.speed} /></span>
        </div>
      </div>
      <div className="player-right">
        <button className="btn btn-secondary player-speed" onClick={s.cycleSpeed} title="Playback speed">{s.speed}×</button>
        <SleepButton id="sleep-bar" placement={{ bottom: 40, right: -60 }} />
        <GhostIcon icon="ph ph-sidebar-simple" title="Now playing panel" color={s.npOpen ? 'var(--color-accent)' : 'var(--color-neutral-300)'} className="flip-x" onClick={() => s.set({ npOpen: !s.npOpen })} />
        <GhostIcon icon="ph ph-queue" title="Queue" color={s.screen === 'queue' ? 'var(--color-accent)' : 'var(--color-neutral-300)'} onClick={() => s.go('queue')} />
        <Volume />
      </div>
    </div>
  );
}

/** Shown before anything has been played. */
function IdleBar() {
  const s = useStore(useShallow((s) => ({ first: s.queue[0], play: s.play })));
  return (
    <div className="player idle">
      <span className="idle-art"><i className="ph ph-waveform idle-icon" /></span>
      <span className="idle-text">Nothing playing. Pick an episode{s.first ? ', or start your queue' : ''}.</span>
      {s.first && <button className="btn btn-primary idle-play" onClick={() => s.play(s.first)}><i className="ph-fill ph-play" />Play queue</button>}
    </div>
  );
}
