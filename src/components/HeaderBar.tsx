import { useStore } from '../store';
import { totalUnplayed } from '../model';
import { platform } from '../platform';
import { APP_VERSION } from '../version';
import { exportOpmlFile, importOpmlFile } from '../lib/library-io';
import { GhostIcon, useOutside } from './ui';

export function HeaderBar() {
  const s = useStore();
  const chrome = platform.desktop;
  const show = s.shows.find((x) => x.id === s.showId);
  const titles: Record<string, [string, string]> = {
    inbox: ['New episodes', `${totalUnplayed(s)} unplayed`],
    shows: ['Shows', `${s.shows.length} subscription${s.shows.length === 1 ? '' : 's'}`],
    show: [show?.title ?? 'Show', show?.author ?? ''],
    queue: ['Queue', 'Up next'],
    downloads: ['Downloads', s.dl.length ? [`${s.dl.filter((d) => !d.error).length} in progress`, ...(s.dl.some((d) => d.error) ? [`${s.dl.filter((d) => d.error).length} failed`] : [])].join(' · ') : 'All done'],
    discover: ['Discover', 'Apple Podcasts · gpodder.net · fyyd'],
    settings: ['Preferences', `Resonate ${APP_VERSION}`],
  };
  const [title, sub] = s.shows.length || s.screen === 'discover' || s.screen === 'settings' ? titles[s.screen] : ['Welcome', 'Resonate'];
  const menuRef = useOutside<HTMLDivElement>(s.menu === 'main', () => s.set({ menu: null }), '[data-menu-trigger="main"]');
  const closeMenu = () => s.set({ menu: null });
  const controls: [string, number, string, () => void][] = chrome === 'KDE'
    ? [['ph-caret-down', 14, 'Minimize', platform.minimize], ['ph-caret-up', 14, 'Maximize', platform.toggleMaximize], ['ph-x-circle', 15, 'Close', platform.close]]
    : [['ph-minus', 11, 'Minimize', platform.minimize], ['ph-square', 10, 'Maximize', platform.toggleMaximize], ['ph-x', 11, 'Close', platform.close]];

  return (
    <div className="titlebar" onDoubleClick={(e) => { if (e.target === e.currentTarget) platform.toggleMaximize(); }}
      style={{ height: 46, flex: 'none', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '0 var(--space-3)', background: 'linear-gradient(180deg,var(--color-surface),color-mix(in srgb,var(--color-surface) 60%,var(--color-bg)))', boxShadow: '0 1px 0 var(--color-neutral-900)', position: 'relative', zIndex: 8 }}>
      {chrome === 'KDE' && <i className="ph-fill ph-waveform" style={{ fontSize: 18, color: 'var(--color-accent)', padding: '0 4px' }} />}
      <div style={{ display: 'flex', gap: 2, width: 212 }}>
        <GhostIcon icon="ph ph-caret-left" title="Back" onClick={s.goBack} color="var(--color-text)" style={{ opacity: s.history.length ? 1 : 0.45 }} />
        <GhostIcon icon={s.refreshing ? 'ph ph-circle-notch spin' : 'ph ph-arrows-clockwise'} title="Refresh all feeds (Ctrl+R)" onClick={() => void s.refresh()} color="var(--color-text)" />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15, minWidth: 0, pointerEvents: 'none' }}>
        <span style={{ fontSize: 13, fontWeight: 600, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
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
            <MenuItem icon="ph ph-arrows-clockwise" label="Refresh all feeds" hint="Ctrl R" run={() => { closeMenu(); void s.refresh(); }} />
            <MenuItem icon="ph ph-plus" label="Add show…" run={() => s.go('discover')} />
            <div className="menu-sep" />
            <MenuItem icon="ph ph-file-arrow-up" label="Import OPML…" hint="Ctrl O" run={() => { closeMenu(); void importOpmlFile(); }} />
            <MenuItem icon="ph ph-file-arrow-down" label="Export OPML…" hint="Ctrl E" run={() => { closeMenu(); void exportOpmlFile(); }} />
            {platform.isDesktop && <MenuItem icon="ph ph-folder-open" label="Open download folder" run={() => { closeMenu(); platform.openFolder(s.folder); }} />}
            <div className="menu-sep" />
            <MenuItem icon="ph ph-gear-six" label="Preferences" hint="Ctrl ," run={() => s.go('settings')} />
            <MenuItem icon="ph ph-keyboard" label="Keyboard shortcuts" hint="Ctrl /" run={() => s.set({ menu: null, dialog: 'shortcuts' })} />
            <MenuItem icon="ph ph-info" label="About Resonate" run={() => s.set({ menu: null, dialog: 'about' })} />
            {platform.isDesktop && (
              <>
                <div className="menu-sep" />
                <MenuItem icon="ph ph-power" label="Quit" hint="Ctrl Q" run={platform.quit} />
              </>
            )}
          </div>
        )}
      </div>
      {platform.isDesktop && (
        <div style={{ display: 'flex', gap: chrome === 'KDE' ? 14 : 10, marginLeft: 6, color: 'var(--color-neutral-400)' }}>
          {controls.map(([icon, size, label, fn]) => (
            <button key={label} title={label} aria-label={label} onClick={fn} className={chrome === 'KDE' ? 'h-text' : 'h-border'}
              style={chrome === 'KDE'
                ? { border: 'none', padding: 0, background: 'none', color: 'inherit', cursor: 'pointer', display: 'grid', placeItems: 'center' }
                : { width: 22, height: 22, borderRadius: '50%', border: '1px solid transparent', padding: 0, background: 'var(--color-neutral-800)', color: 'var(--color-text)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <i className={`ph ${icon}`} style={{ fontSize: size }} />
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
