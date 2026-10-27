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
    <nav aria-label="Library" className="sidebar">
      <div className="sidebar-group">
        {nav.map(([id, label, icon, count]) => {
          const on = active === id;
          return (
            <button key={id} className="h-n900 side-btn nav-item" onClick={() => s.go(id)} aria-current={on ? 'page' : undefined}>
              <i className={`${icon} side-icon`} />
              <span className="side-label">{label}</span>
              {count && <span className="nav-count">{count}</span>}
            </button>
          );
        })}
      </div>
      {s.shows.length > 0 && (
        <div className="sidebar-group">
          <div className="sidebar-heading">Subscriptions</div>
          {s.shows.map((x) => {
            const n = unplayedFor(s, x.id);
            const on = s.screen === 'show' && s.showId === x.id;
            return (
              <button key={x.id} className={`h-n900 side-btn sub-item${on ? ' on' : ''}`} onClick={() => s.openShow(x.id)}>
                <Art bg={art(x.hue)} mono={mono(x.title)} img={x.imageUrl} size={20} font={8} radius={4} />
                <span className="sub-title">{x.title}</span>
                {n > 0 && <span className="sub-count">{n}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="sidebar-foot">
        <div className="storage" title={`${Math.round(pct)}% of the storage limit used`}>
          <div className="storage-figures">
            <span>{s.folder}</span><span>{usedGb.toFixed(1)} / {s.storageLimitGb} GB</span>
          </div>
          <div className="storage-bar">
            <div className="storage-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button className={`h-n900 side-btn side-prefs${s.screen === 'settings' ? ' on' : ''}`} onClick={() => s.go('settings')}>
          <i className="ph ph-gear-six side-icon" />Preferences
        </button>
      </div>
    </nav>
  );
}
