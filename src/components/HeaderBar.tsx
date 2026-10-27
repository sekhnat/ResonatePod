import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { totalUnplayed } from '../model';
import { platform } from '../platform';
import { APP_VERSION } from '../version';
import { exportOpmlFile, importOpmlFile } from '../lib/library-io';
import { GhostIcon, useOutside } from './ui';

export function HeaderBar() {
  // Counts rather than the lists they come from: download progress replaces `dl` four times a second.
  const s = useStore(useShallow((s) => ({
    show: s.shows.find((x) => x.id === s.showId), shows: s.shows.length, screen: s.screen, unplayed: totalUnplayed(s), folder: s.folder,
    dls: s.dl.length, failed: s.dl.filter((d) => d.error).length, canGoBack: s.history.length > 0, refreshing: s.refreshing, menu: s.menu,
    set: s.set, go: s.go, goBack: s.goBack, refresh: s.refresh,
  })));
  const chrome = platform.desktop;
  const { show } = s;
  const titles: Record<string, [string, string]> = {
    inbox: ['New episodes', `${s.unplayed} unplayed`],
    shows: ['Shows', `${s.shows} subscription${s.shows === 1 ? '' : 's'}`],
    show: [show?.title ?? 'Show', show?.author ?? ''],
    queue: ['Queue', 'Up next'],
    downloads: ['Downloads', s.dls ? [`${s.dls - s.failed} in progress`, ...(s.failed ? [`${s.failed} failed`] : [])].join(' · ') : 'All done'],
    discover: ['Discover', 'Apple Podcasts · gpodder.net · fyyd'],
    settings: ['Preferences', `Resonate ${APP_VERSION}`],
  };
  const [title, sub] = s.shows || s.screen === 'discover' || s.screen === 'settings' ? titles[s.screen] : ['Welcome', 'Resonate'];
  const menuRef = useOutside<HTMLDivElement>(s.menu === 'main', () => s.set({ menu: null }), '[data-menu-trigger="main"]');
  const closeMenu = () => s.set({ menu: null });
  const controls: [string, number, string, () => void][] = chrome === 'KDE'
    ? [['ph-caret-down', 14, 'Minimize', platform.minimize], ['ph-caret-up', 14, 'Maximize', platform.toggleMaximize], ['ph-x-circle', 15, 'Close', platform.close]]
    : [['ph-minus', 11, 'Minimize', platform.minimize], ['ph-square', 10, 'Maximize', platform.toggleMaximize], ['ph-x', 11, 'Close', platform.close]];

  return (
    <div className="titlebar" onDoubleClick={(e) => { if (e.target === e.currentTarget) platform.toggleMaximize(); }}>
      {chrome === 'KDE' && <i className="ph-fill ph-waveform titlebar-brand" />}
      <div className="titlebar-nav">
        <GhostIcon icon="ph ph-caret-left" title="Back" onClick={s.goBack} color="var(--color-text)" style={{ opacity: s.canGoBack ? 1 : 0.45 }} />
        <GhostIcon icon={s.refreshing ? 'ph ph-circle-notch spin' : 'ph ph-arrows-clockwise'} title="Refresh all feeds (Ctrl+R)" onClick={() => void s.refresh()} color="var(--color-text)" />
      </div>
      <div className="titlebar-title">
        <span className="titlebar-title-main">{title}</span>
        <span className="titlebar-title-sub">{sub}</span>
      </div>
      <button className="h-border titlebar-search" onClick={() => s.set({ palette: true, query: '' })}>
        <i className="ph ph-magnifying-glass titlebar-search-icon" />
        <span className="titlebar-search-text">Search or run a command</span>
        <span className="titlebar-kbd">Ctrl K</span>
      </button>
      <div className="titlebar-menu">
        <button className={`btn btn-icon titlebar-menu-btn${s.menu === 'main' ? ' open' : ''}`} data-menu-trigger="main" title="Main menu" aria-label="Main menu" aria-expanded={s.menu === 'main'}
          onClick={() => s.set({ menu: s.menu === 'main' ? null : 'main' })}>
          <i className="ph ph-list titlebar-menu-icon" />
        </button>
        {s.menu === 'main' && (
          <div ref={menuRef} className="menu titlebar-menu-pop" role="menu">
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
        <div className={`win-controls ${chrome === 'KDE' ? 'kde' : 'gnome'}`}>
          {controls.map(([icon, size, label, fn]) => (
            <button key={label} title={label} aria-label={label} onClick={fn} className={`win-btn ${chrome === 'KDE' ? 'kde h-text' : 'gnome h-border'}`}>
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
      {active && !hint && <i className="ph ph-check menu-check" />}
    </button>
  );
}
