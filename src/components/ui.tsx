import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { SORTS, type Sort } from '../store';
import { liveMeta, type EpisodeRow } from '../model';
import { usePlayhead } from '../playhead';

export function SortSelect({ value, onPick }: { value: Sort; onPick: (v: Sort) => void }) {
  return (
    <select className="input select-compact" aria-label="Sort episodes" title="Sort episodes" value={value}
      onChange={(e) => onPick(e.target.value as Sort)}>
      {SORTS.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** Artwork tile: the feed's image, or a monogram placeholder when there is none (or it fails to load). */
export function Art({ bg, mono, img, size, font, radius = 6, weight = 600, className, style, children }: {
  bg: string; mono: string; img?: string; size: number | string; font: number; radius?: number | string; weight?: number; className?: string; style?: CSSProperties; children?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImg = img && failed !== img;
  return (
    <span className={className ? `art ${className}` : 'art'} style={{ width: size, height: size, borderRadius: radius, background: bg, fontSize: font, fontWeight: weight, ...style }}>
      {showImg ? <img className="art-img" src={img} alt="" loading="lazy" onError={() => setFailed(img)} /> : mono}
      {children}
    </span>
  );
}

/** A row of choices. Values can be anything; `format` makes the label (and tells which one is chosen), the value itself by default. */
export function Seg<T = string>({ options, value, onPick, format = String, style }: {
  options: readonly T[]; value: T; onPick: (v: T) => void; format?: (v: T) => string; style?: CSSProperties;
}) {
  return (
    <div className="seg" role="radiogroup" style={style}>
      {options.map((o) => {
        const label = format(o);
        const on = label === format(value);
        return (
          <span key={label} className="seg-opt" role="radio" aria-checked={on} tabIndex={0}
            onClick={() => onPick(o)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(o); } }}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button className="toggle" role="switch" aria-checked={on} aria-label={label} onClick={onToggle}>
      <span className="toggle-knob" />
    </button>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="page-heading">
        <h1 className="page-title">{title}</h1>
        {sub && <span className="page-sub">{sub}</span>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

/** Round play/pause button used on every episode row. */
/**
 * A row's detail line. The playing episode's shows its live time left, redrawn once a second; every other row
 * is static, so a list doesn't redraw as playback advances.
 */
export function RowMeta({ e, prefix = '' }: { e: EpisodeRow; prefix?: string }) {
  const sec = usePlayhead((p) => (e.isCur && e.dur ? Math.floor(p) : -1));
  return <>{prefix}{sec >= 0 ? liveMeta(e, sec) : e.meta}</>;
}

/** How far through an episode is shown, as a small bar: live for the playing one (in steps of half a percent), saved for the rest. */
export function RowProgress({ e }: { e: EpisodeRow }) {
  const progress = usePlayhead((p) => (e.isCur && e.dur ? Math.round((p / e.dur) * 200) / 200 : e.progress));
  if (!(progress > 0 && progress < 1)) return null;
  return (
    <div className="row-progress">
      <div className="row-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
    </div>
  );
}

export function RowPlay({ isCur, isPlaying, onClick }: { isCur: boolean; isPlaying: boolean; onClick: () => void }) {
  return (
    <button className={`btn btn-icon btn-secondary row-play${isCur ? ' cur' : ''}`} onClick={onClick} title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'}>
      <i className={isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play'} />
    </button>
  );
}

export function GhostIcon({ icon, title, onClick, size = 32, iconSize = 16, color = 'var(--color-neutral-400)', className, style }: {
  icon: string; title: string; onClick?: () => void; size?: number; iconSize?: number; color?: string; className?: string; style?: CSSProperties;
}) {
  return (
    <button className={`btn btn-icon ghost-icon${className ? ` ${className}` : ''}`} title={title} aria-label={title} onClick={onClick} style={{ width: size, height: size, color, ...style }}>
      <i className={icon} style={{ fontSize: iconSize }} />
    </button>
  );
}

/** Calls `onClose` on a mousedown outside `ref` (used by menus and the tray). */
export function useOutside<T extends HTMLElement>(active: boolean, onClose: () => void, ignore?: string) {
  const ref = useRef<T>(null);
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t)) return;
      if (ignore && t.closest(ignore)) return;
      cb.current();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [active, ignore]);
  return ref;
}
