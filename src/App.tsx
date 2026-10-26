import { useEffect } from 'react';
import { useStore, type Screen } from './store';
import { platform } from './platform';
import { startServices } from './services';
import { exportOpmlFile, importOpmlFile } from './lib/library-io';
import { HeaderBar } from './components/HeaderBar';
import { Sidebar } from './components/Sidebar';
import { PlayerBar } from './components/PlayerBar';
import { NowPlayingFull, NowPlayingPanel } from './components/NowPlaying';
import { Dialogs, ShowSettingsDialog } from './components/Dialogs';
import { CommandPalette } from './components/CommandPalette';
import { ShowScreen } from './screens/ShowScreen';
import { InboxScreen } from './screens/InboxScreen';
import { ShowsScreen } from './screens/ShowsScreen';
import { QueueScreen } from './screens/QueueScreen';
import { DownloadsScreen } from './screens/DownloadsScreen';
import { DiscoverScreen } from './screens/DiscoverScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';

const NAV_KEYS: Screen[] = ['inbox', 'shows', 'queue', 'downloads', 'discover'];

const SCREENS: Record<Screen, () => JSX.Element | null> = {
  show: ShowScreen, inbox: InboxScreen, shows: ShowsScreen, queue: QueueScreen,
  downloads: DownloadsScreen, discover: DiscoverScreen, settings: SettingsScreen,
};

let started = false;

export default function App() {
  const s = useStore();
  const empty = !s.shows.length && s.screen !== 'discover' && s.screen !== 'settings';
  const Main = empty ? WelcomeScreen : SCREENS[s.screen];

  useEffect(() => {
    if (s.hydrated && !started) { started = true; startServices(); }
  }, [s.hydrated]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const inInput = /INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName || '');
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'k') { e.preventDefault(); st.set({ palette: true, query: '' }); }
      else if (mod && k === 'r') { e.preventDefault(); void st.refresh(); }
      else if (mod && k === ',') { e.preventDefault(); st.go('settings'); }
      else if (mod && k === '/') { e.preventDefault(); st.set({ dialog: 'shortcuts' }); }
      else if (mod && k === 'o') { e.preventDefault(); void importOpmlFile(); }
      else if (mod && k === 'e') { e.preventDefault(); void exportOpmlFile(); }
      else if (mod && k === 'w') { e.preventDefault(); platform.close(); }
      else if (mod && k === 'q') { e.preventDefault(); platform.quit(); }
      else if (mod && /^[1-5]$/.test(k)) { e.preventDefault(); st.go(NAV_KEYS[+k - 1]); }
      else if (e.key === 'Escape') { st.set({ palette: false, cfgOpen: false, npFull: false, dialog: null, menu: null }); }
      else if (inInput || mod) return;
      else if (e.key === ' ') { e.preventDefault(); st.togglePlay(); }
      else if (e.key === 'ArrowLeft') { st.skipBack(); }
      else if (e.key === 'ArrowRight') { st.skipFwd(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!s.hydrated) return <div style={{ height: '100vh', background: 'var(--color-bg)' }} />;

  return (
    <div className="window" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)', overflow: 'hidden', position: 'relative' }}>
      <HeaderBar />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 'var(--space-8)' }}>
          <Main />
        </main>
        {s.npOpen && s.cur && <NowPlayingPanel />}
        {s.npFull && s.cur && <NowPlayingFull />}
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
  );
}
