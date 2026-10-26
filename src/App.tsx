import { useEffect, useState } from 'react';
import { useStore, type Screen } from './store';
import { exportOpml, downloadText, parseOpml } from './lib/opml';
import { HeaderBar } from './components/HeaderBar';
import { Sidebar } from './components/Sidebar';
import { PlayerBar } from './components/PlayerBar';
import { NowPlayingFull, NowPlayingPanel } from './components/NowPlaying';
import { Dialogs, ShowSettingsDialog } from './components/Dialogs';
import { CommandPalette } from './components/CommandPalette';
import { PlasmaPanel, TrayPopover } from './components/Plasma';
import { ShowScreen } from './screens/ShowScreen';
import { InboxScreen } from './screens/InboxScreen';
import { ShowsScreen } from './screens/ShowsScreen';
import { QueueScreen } from './screens/QueueScreen';
import { DownloadsScreen } from './screens/DownloadsScreen';
import { DiscoverScreen } from './screens/DiscoverScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const params = new URLSearchParams(location.search);
const chrome = params.get('chrome')?.toUpperCase() === 'GNOME' ? 'GNOME' : 'KDE';
const showSubs = params.get('subscriptions') !== 'false';
const NAV_KEYS: Screen[] = ['inbox', 'shows', 'queue', 'downloads', 'discover'];

const SCREENS: Record<Screen, () => JSX.Element | null> = {
  show: ShowScreen, inbox: InboxScreen, shows: ShowsScreen, queue: QueueScreen,
  downloads: DownloadsScreen, discover: DiscoverScreen, settings: SettingsScreen,
};

export default function App() {
  const s = useStore();
  const [maximized, setMaximized] = useState(params.get('mode') === 'app');
  const Main = SCREENS[s.screen];

  useEffect(() => {
    const t = setInterval(() => useStore.getState().tick(), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const inInput = /INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName || '');
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'k') { e.preventDefault(); st.set({ palette: true, query: '' }); }
      else if (mod && k === 'r') { e.preventDefault(); st.refresh(); }
      else if (mod && k === ',') { e.preventDefault(); st.go('settings'); }
      else if (mod && k === '/') { e.preventDefault(); st.set({ dialog: 'shortcuts' }); }
      else if (mod && k === 'w') { e.preventDefault(); st.set({ windowHidden: true, trayOpen: false }); }
      else if (mod && /^[1-5]$/.test(k)) { e.preventDefault(); st.go(NAV_KEYS[+k - 1]); }
      else if (e.key === 'Escape') { st.set({ palette: false, cfgOpen: false, npFull: false, dialog: null, menu: null }); }
      else if (inInput || mod) return;
      else if (e.key === ' ') { e.preventDefault(); st.togglePlay(); }
      else if (e.key === 'ArrowLeft') { st.skipBack(); }
      else if (e.key === 'ArrowRight') { st.skipFwd(); }
    };
    const onExport = () => {
      const st = useStore.getState();
      downloadText('resonate-subscriptions.opml', exportOpml(st.shows.map((x) => ({ title: x.title, xmlUrl: x.feedUrl }))));
      st.toast(`Exported ${st.shows.length} feeds to resonate-subscriptions.opml`);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resonate:export-opml', onExport);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resonate:export-opml', onExport); };
  }, []);

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const feeds = parseOpml(await file.text());
      const n = s.importFeeds(feeds);
      s.toast(feeds.length ? `Imported ${n} of ${feeds.length} feeds from ${file.name}` : `No feeds found in ${file.name}`);
      if (n) s.go('shows');
    } catch (err) {
      s.toast(`Couldn’t import ${file.name}: ${(err as Error).message}`);
    }
  };

  return (
    <div className={maximized ? 'app-mode' : undefined}>
      <input id="opml-input" type="file" accept=".opml,.xml,text/xml,text/x-opml" hidden onChange={onImport} />
      <div className="desktop">
        <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'relative' }}>
          <div className="window" data-screen-label="Resonate window"
            style={{ width: 1280, height: 800, flex: 'none', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', position: 'relative', visibility: s.windowHidden ? 'hidden' : 'visible' }}>
            <HeaderBar chrome={chrome} maximized={maximized} onMaximize={() => setMaximized((m) => !m)} />
            <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
              <Sidebar showSubs={showSubs} />
              <main style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 'var(--space-8)' }}>
                <Main />
              </main>
              {s.npOpen && <NowPlayingPanel />}
              {s.npFull && <NowPlayingFull />}
              {s.cfgOpen && <ShowSettingsDialog />}
              <Dialogs />
            </div>
            <PlayerBar />
            {s.palette && <CommandPalette />}
            <div className="toasts" aria-live="polite">
              {s.toasts.map((t) => (
                <div key={t.id} className="toast" onClick={() => s.dismissToast(t.id)}>
                  <i className="ph ph-info" style={{ color: 'var(--color-accent)', fontSize: 15 }} />{t.text}
                </div>
              ))}
            </div>
          </div>
          <PlasmaPanel />
          {s.trayOpen && !maximized && <TrayPopover />}
        </div>
      </div>
    </div>
  );
}
