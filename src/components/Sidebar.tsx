import { useShallow } from 'zustand/react/shallow';
import { art, mono } from '../data';
import { Art } from './ui';
import { trackedBytes, useStore, type Screen } from '../store';
import { totalUnplayed, unplayedFor } from '../model';

export function Sidebar() {
  const s = useStore(useShallow((s) => ({
    screen: s.screen, showId: s.showId, shows: s.shows, eps: s.eps, queue: s.queue.length, dls: s.dl.length,
    storageLimitGb: s.storageLimitGb, folder: s.folder, go: s.go, openShow: s.openShow,
  })));
  const active = s.screen === 'show' ? 'shows' : s.screen;
  const unplayed = totalUnplayed(s);
  const nav: [Screen, string, string, string][] = [
    ['inbox', 'New episodes', 'ph ph-tray', unplayed ? String(unplayed) : ''],
    ['shows', 'Shows', 'ph ph-squares-four', ''],
    ['queue', 'Queue', 'ph ph-queue', s.queue ? String(s.queue) : ''],
    ['downloads', 'Downloads', 'ph ph-download-simple', s.dls ? String(s.dls) : ''],
    ['discover', 'Discover', 'ph ph-compass', ''],
  ];
  const usedGb = trackedBytes(s.eps) / 1024 ** 3;
  const pct = Math.min(100, (usedGb / s.storageLimitGb) * 100);

  return (
    <nav aria-label="Library" style={{ width: 228, flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-4) var(--space-3)', background: 'color-mix(in srgb,var(--color-surface) 45%,var(--color-bg))', overflow: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {nav.map(([id, label, icon, count]) => {
          const on = active === id;
          return (
            <button key={id} className="h-n900" onClick={() => s.go(id)} aria-current={on ? 'page' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 10px', border: 'none', borderRadius: 'var(--radius-md)', background: on ? 'var(--color-accent-900)' : 'transparent', color: on ? 'var(--color-accent-200)' : 'var(--color-text)', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
              <i className={icon} style={{ fontSize: 17 }} />
              <span style={{ flex: 1 }}>{label}</span>
              {count && <span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{count}</span>}
            </button>
          );
        })}
      </div>
      {s.shows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-neutral-500)', padding: '0 10px 6px' }}>Subscriptions</div>
          {s.shows.map((x) => {
            const n = unplayedFor(s, x.id);
            const on = s.screen === 'show' && s.showId === x.id;
            return (
              <button key={x.id} className="h-n900" onClick={() => s.openShow(x.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, height: 32, padding: '0 10px', border: 'none', borderRadius: 'var(--radius-md)', background: on ? 'var(--color-neutral-900)' : 'transparent', color: 'var(--color-text)', fontSize: 12.5, cursor: 'pointer', textAlign: 'left' }}>
                <Art bg={art(x.hue)} mono={mono(x.title)} img={x.imageUrl} size={20} font={8} radius={4} />
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.title}</span>
                {n > 0 && <span style={{ fontSize: 10.5, color: 'var(--color-accent-300)' }}>{n}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 10px' }} title={`${Math.round(pct)}% of the storage limit used`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-neutral-400)' }}>
            <span>{s.folder}</span><span>{usedGb.toFixed(1)} / {s.storageLimitGb} GB</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'var(--color-neutral-900)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-neutral-500)' }} />
          </div>
        </div>
        <button className="h-n900" onClick={() => s.go('settings')}
          style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 10px', border: 'none', borderRadius: 'var(--radius-md)', background: s.screen === 'settings' ? 'var(--color-accent-900)' : 'transparent', color: 'var(--color-text)', fontSize: 13, cursor: 'pointer' }}>
          <i className="ph ph-gear-six" style={{ fontSize: 17 }} />Preferences
        </button>
      </div>
    </nav>
  );
}
