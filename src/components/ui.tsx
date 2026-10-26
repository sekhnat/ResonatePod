import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Artwork tile: the feed's image, or a monogram placeholder when there is none (or it fails to load). */
export function Art({ bg, mono, img, size, font, radius = 6, weight = 600, style, children }: {
  bg: string; mono: string; img?: string; size: number | string; font: number; radius?: number | string; weight?: number; style?: CSSProperties; children?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImg = img && failed !== img;
  return (
    <span style={{ width: size, height: size, flex: 'none', borderRadius: radius, background: bg, display: 'grid', placeItems: 'center', fontSize: font, fontWeight: weight, color: 'var(--color-neutral-100)', overflow: 'hidden', position: 'relative', ...style }}>
      {showImg ? <img src={img} alt="" loading="lazy" onError={() => setFailed(img)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : mono}
      {children}
    </span>
  );
}

export function Seg<T extends string>({ options, value, onPick, style }: {
  options: readonly T[]; value: T; onPick: (v: T) => void; style?: CSSProperties;
}) {
  return (
    <div className="seg" role="radiogroup" style={style}>
      {options.map((o) => {
        const on = o === value;
        return (
          <span key={o} className="seg-opt" role="radio" aria-checked={on} tabIndex={0}
            onClick={() => onPick(o)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(o); } }}
            style={{ background: on ? 'var(--color-accent-800)' : 'transparent', color: on ? 'var(--color-accent-100)' : 'inherit', fontSize: 12, padding: '5px 10px' }}>
            {o}
          </span>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onToggle}
      style={{ width: 36, height: 20, borderRadius: 10, border: 'none', padding: 0, position: 'relative', flex: 'none', background: on ? 'var(--color-accent-700)' : 'var(--color-neutral-800)', cursor: 'pointer' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: on ? 'var(--color-accent-100)' : 'var(--color-neutral-400)', transition: 'left .15s' }} />
    </button>
  );
}

export const sectionLabel: CSSProperties = { fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' };

export const h1Style: CSSProperties = { margin: 0, fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em' };
export const subStyle: CSSProperties = { fontSize: 12.5, color: 'var(--color-neutral-400)' };

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={h1Style}>{title}</h1>
        {sub && <span style={subStyle}>{sub}</span>}
      </div>
      {children && <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>{children}</div>}
    </div>
  );
}

/** Round play/pause button used on every episode row. */
export function RowPlay({ isCur, isPlaying, onClick }: { isCur: boolean; isPlaying: boolean; onClick: () => void }) {
  return (
    <button className="btn btn-icon btn-secondary" onClick={onClick} title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'}
      style={{ width: 32, height: 32, borderRadius: '50%', color: isCur ? 'var(--color-accent)' : 'var(--color-neutral-300)', borderColor: isCur ? 'var(--color-accent)' : 'var(--color-divider)' }}>
      <i className={isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play'} style={{ fontSize: 13 }} />
    </button>
  );
}

export function GhostIcon({ icon, title, onClick, size = 32, iconSize = 16, color = 'var(--color-neutral-400)', style }: {
  icon: string; title: string; onClick?: () => void; size?: number; iconSize?: number; color?: string; style?: CSSProperties;
}) {
  return (
    <button className="btn btn-icon" title={title} aria-label={title} onClick={onClick} style={{ width: size, height: size, border: 'none', color, ...style }}>
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
