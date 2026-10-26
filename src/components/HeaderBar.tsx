import { useStore } from '../store';
import { totalUnplayed } from '../model';
import { GhostIcon, useOutside } from './ui';

export function HeaderBar({ chrome, maximized, onMaximize }: { chrome: 'KDE' | 'GNOME'; maximized: boolean; onMaximize: () => void }) {
  const s = useStore();
  const show = s.shows.find((x) => x.id === s.showId);
  const titles: Record<string, [string, string]> = {
    inbox: ['New episodes', `${totalUnplayed(s)} unplayed`],
    shows: ['Shows', `${s.shows.length} subscriptions`],
    show: [show?.title ?? 'Show', show?.author ?? ''],
    queue: ['Queue', 'Up next'],
    downloads: ['Downloads', s.dl.length ? `${s.dl.length} in progress` : 'All done'],
    discover: ['Discover', 'Browse the directory'],
    settings: ['Preferences', 'Resonate 1.4'],
  };
  const [title, sub] = titles[s.screen];
  const menuRef = useOutside<HTMLDivElement>(s.menu === 'main', () => s.set({ menu: null }), '[data-menu-trigger="main"]');
  const hide = () => { s.set({ windowHidden: true, trayOpen: false }); s.toast('Resonate is still running in the system tray'); };

  return (
    <div style={{ height: 46, flex: 'none', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '0 var(--space-3)', background: 'linear-gradient(180deg,var(--color-surface),color-mix(in srgb,var(--color-surface) 60%,var(--color-bg)))', boxShadow: '0 1px 0 var(--color-neutral-900)', position: 'relative', zIndex: 8 }}
      onDoubleClick={(e) => { if (e.target === e.currentTarget) onMaximize(); }}>
      {chrome === 'KDE' && <i className="ph-fill ph-waveform" style={{ fontSize: 18, color: 'var(--color-accent)', padding: '0 4px' }} />}
      <div style={{ display: 'flex', gap: 2, width: 212 }}>
        <GhostIcon icon="ph ph-caret-left" title="Back" onClick={s.goBack} color="var(--color-text)" style={{ opacity: s.history.length ? 1 : 0.45 }} />
        <GhostIcon icon={s.refreshing ? 'ph ph-circle-notch spin' : 'ph ph-arrows-clockwise'} title="Refresh all feeds (Ctrl+R)" onClick={s.refresh} color="var(--color-text)" />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{sub}</span>
      </div>
      <button className="h-border" onClick={() => s.set({ palette: true, query: '' })}
        style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, width: 220, padding: '0 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-divider)', background: 'color-mix(in srgb,var(--color-bg) 50%,transparent)', color: 'var(--color-neutral-500)', fontSize: 12, cursor: 'pointer' }}>
        <i className="ph ph-magnifying-glass" style={{ fontSize: 14 }} />
        <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Search or run a command</span>
        <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--color-neutral-900)', color: 'var(--color-neutral-400)' }}>Ctrl K</span>
      </button>
      <div style={{ position: 'relative' }}>
        <button className="btn btn-icon" data-menu-trigger="main" title="Main menu" aria-label="Main menu" aria-expanded={s.menu === 'main'}
          onClick={() => s.set({ menu: s.menu === 'main' ? null : 'main' })}
          style={{ width: 32, height: 32, border: 'none', background: s.menu === 'main' ? 'var(--color-neutral-800)' : undefined }}>
          <i className="ph ph-list" style={{ fontSize: 17 }} />
        </button>
        {s.menu === 'main' && (
          <div ref={menuRef} className="menu" role="menu" style={{ top: 38, right: 0 }}>
            <MenuItem icon="ph ph-arrows-clockwise" label="Refresh all feeds" hint="Ctrl R" run={() => { s.set({ menu: null }); s.refresh(); }} />
            <MenuItem icon="ph ph-plus" label="Add show…" run={() => s.go('discover')} />
            <div className="menu-sep" />
            <MenuItem icon="ph ph-file-arrow-up" label="Import OPML…" run={() => { s.set({ menu: null }); document.getElementById('opml-input')?.click(); }} />
            <MenuItem icon="ph ph-file-arrow-down" label="Export OPML…" run={() => { s.set({ menu: null }); window.dispatchEvent(new Event('resonate:export-opml')); }} />
            <div className="menu-sep" />
            <MenuItem icon="ph ph-gear-six" label="Preferences" hint="Ctrl ," run={() => s.go('settings')} />
            <MenuItem icon="ph ph-keyboard" label="Keyboard shortcuts" hint="Ctrl /" run={() => s.set({ menu: null, dialog: 'shortcuts' })} />
            <MenuItem icon="ph ph-info" label="About Resonate" run={() => s.set({ menu: null, dialog: 'about' })} />
            <div className="menu-sep" />
            <MenuItem icon="ph ph-sign-out" label="Close to tray" hint="Ctrl W" run={() => { s.set({ menu: null }); hide(); }} />
          </div>
        )}
      </div>
      {chrome === 'GNOME' && (
        <div style={{ display: 'flex', gap: 10, marginLeft: 6 }}>
          {[['ph-minus', 11, 'Minimize', hide], ['ph-square', 10, maximized ? 'Restore' : 'Maximize', onMaximize], ['ph-x', 11, 'Close', hide]].map(([icon, size, label, fn]) => (
            <button key={label as string} title={label as string} aria-label={label as string} onClick={fn as () => void} className="h-border"
              style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid transparent', padding: 0, background: 'var(--color-neutral-800)', color: 'var(--color-text)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <i className={`ph ${icon}`} style={{ fontSize: size as number }} />
            </button>
          ))}
        </div>
      )}
      {chrome === 'KDE' && (
        <div style={{ display: 'flex', gap: 14, marginLeft: 6, color: 'var(--color-neutral-400)' }}>
          {[['ph-caret-down', 14, 'Minimize', hide], ['ph-caret-up', 14, maximized ? 'Restore' : 'Maximize', onMaximize], ['ph-x-circle', 15, 'Close', hide]].map(([icon, size, label, fn]) => (
            <button key={label as string} title={label as string} aria-label={label as string} onClick={fn as () => void} className="h-text"
              style={{ border: 'none', padding: 0, background: 'none', color: 'inherit', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
              <i className={`ph ${icon}`} style={{ fontSize: size as number }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, label, hint, run, active }: { icon: string; label: string; hint?: string; run: () => void; active?: boolean }) {
  return (
    <button className={`menu-item${active ? ' active' : ''}`} role="menuitem" onClick={run}>
      <i className={icon} />
      <span>{label}</span>
      {hint && <span className="menu-hint">{hint}</span>}
      {active && !hint && <i className="ph ph-check" style={{ marginLeft: 'auto' }} />}
    </button>
  );
}
