import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { trackedBytes, useStore, type Settings, type Toggles } from '../store';
import { delLabel, keepLabel, skipLabel, speedLabel } from '../settings-labels';
import { Seg, Toggle } from '../components/ui';
import { platform } from '../platform';
import { clockLabel } from '../model';
import { exportOpmlFile, importOpmlFile } from '../lib/library-io';
import { CountrySelect, SourceSelect } from '../components/DirectoryCard';

type Row = { label: string; hint?: string } & (
  | { kind: 'toggle'; k: keyof Toggles }
  | { kind: 'value'; value: string; action: string; run: () => void }
  | { kind: 'node'; node: ReactNode }
);

export function SettingsScreen() {
  const s = useStore(useShallow((s) => ({
    directory: s.directory, eps: s.eps, folder: s.folder, set: s.set, setPrefs: s.setPrefs, setSetting: s.setSetting, setToggle: s.setToggle,
    shows: s.shows, storageLimitGb: s.storageLimitGb, sv: s.sv, sync: s.sync, syncing: s.syncing, tg: s.tg, toast: s.toast,
    folderBytes: s.folderBytes, updateUsage: s.updateUsage,
  })));
  const changeFolder = async () => {
    if (!platform.isDesktop) { s.set({ dialog: 'folder' }); return; }
    const folder = await platform.pickFolder(s.folder);
    if (!folder || folder === s.folder) return;
    const from = s.folder;
    s.setPrefs({ folder });
    // Offer to bring already-downloaded episodes along.
    if (Object.values(s.eps).some((e) => e.file)) s.set({ dialog: 'move', pendingMove: { from, to: folder } });
    else s.toast(`New downloads will be saved to ${folder}`);
  };
  const seg = <K extends keyof Settings>(k: K, options: Settings[K][], format?: (v: Settings[K]) => string) =>
    <Seg options={options} value={s.sv[k]} format={format} onPick={(v) => s.setSetting(k, v)} />;
  const usedGb = (trackedBytes(s.eps) / 1024 ** 3).toFixed(1);
  const groups: { title: string; rows: Row[] }[] = [
    { title: 'Downloads', rows: [
      { label: 'Download new episodes automatically', hint: 'Applies to shows without their own rule', kind: 'toggle', k: 'auto' },
      { label: 'Keep latest per show', kind: 'node', node: seg('keep', [1, 3, 5, 'all'], keepLabel) },
      { label: 'Pause on metered connections', hint: 'Uses NetworkManager connection state', kind: 'toggle', k: 'metered' },
      { label: 'Simultaneous downloads', kind: 'node', node: seg('par', [1, 2, 4]) },
    ] },
    { title: 'Storage', rows: [
      { label: 'Download folder', hint: platform.isDesktop ? 'One sub-folder per show' : 'Downloads need the desktop app', kind: 'value', value: s.folder, action: 'Change…', run: () => void changeFolder() },
      { label: 'Delete played episodes', hint: 'Downloaded files only; the episode stays in your library', kind: 'node', node: seg('del', ['never', 'day', 'week'], delLabel) },
      { label: 'Storage limit', hint: `${usedGb} GB of downloaded episodes · oldest played files are removed first`, kind: 'value', value: `${s.storageLimitGb} GB`, action: 'Edit', run: () => s.set({ dialog: 'storage' }) },
      ...(platform.isDesktop ? [{ label: 'Folder size', hint: 'Everything in the folder, including files Resonate no longer tracks; the limit doesn’t count those', kind: 'value', value: s.folderBytes == null ? 'Not measured yet' : `${(s.folderBytes / 1024 ** 3).toFixed(1)} GB`, action: 'Recalculate', run: () => void s.updateUsage() } as Row] : []),
    ] },
    { title: 'Playback', rows: [
      { label: 'Default speed', kind: 'node', node: seg('speed', [1, 1.2, 1.5, 2], speedLabel) },
      { label: 'Trim silence', hint: 'Shortens pauses without changing pitch', kind: 'toggle', k: 'silence' },
      { label: 'Skip back / forward', kind: 'node', node: seg('skip', [{ back: 10, fwd: 30 }, { back: 15, fwd: 30 }, { back: 30, fwd: 60 }], skipLabel) },
      { label: 'Notify on new episodes', kind: 'toggle', k: 'notify' },
    ] },
    ...(platform.isDesktop ? [{ title: 'Desktop', rows: [
      { label: 'Start Resonate when you log in', hint: 'Opens hidden in the tray', kind: 'toggle', k: 'autostart' },
    ] as Row[] }] : []),
    { title: 'Discover', rows: [
      { label: 'Region', hint: 'Charts, suggestions and Apple Podcasts search', kind: 'node', node: <CountrySelect /> },
      { label: 'Search', hint: 'All directories merges Apple Podcasts, gpodder.net, fyyd and Podcast Index', kind: 'node', node: <SourceSelect /> },
      { label: 'Podcast Index', hint: s.directory.podcastIndex ? 'Included when searching all directories' : 'Needs a free API key from api.podcastindex.org', kind: 'value', value: s.directory.podcastIndex ? 'Key saved' : 'Off', action: s.directory.podcastIndex ? 'Change…' : 'Add key…', run: () => s.set({ dialog: 'podcastIndex' }) },
    ] },
    { title: 'Sync & subscriptions', rows: [
      { label: 'Sync server', hint: s.sync.server ? `gpodder-compatible · ${s.syncing ? 'syncing…' : `last synced ${clockLabel(s.sync.lastSynced)}`}` : 'gpodder-compatible · subscriptions and play positions', kind: 'value', value: s.sync.server ? `${s.sync.user}@${s.sync.server.replace(/^https?:\/\//, '')}` : 'Not connected', action: 'Configure', run: () => s.set({ dialog: 'sync' }) },
      { label: 'Subscriptions', hint: 'OPML works with almost every podcast app', kind: 'value', value: `${s.shows.length} feeds`, action: 'Export OPML', run: () => void exportOpmlFile() },
      { label: 'Import subscriptions', kind: 'value', value: '', action: 'Import OPML…', run: () => void importOpmlFile() },
    ] },
  ];

  const control = (r: Row): ReactNode => {
    if (r.kind === 'toggle') return <Toggle on={s.tg[r.k]} onToggle={() => s.setToggle(r.k)} label={r.label} />;
    if (r.kind === 'node') return r.node;
    return (
      <div className="prefs-value">
        <span className="prefs-value-text">{r.value}</span>
        <button className="btn btn-secondary prefs-btn" onClick={r.run}>{r.action}</button>
      </div>
    );
  };

  return (
    <div className="page wide prefs">
      <h1 className="page-title">Preferences</h1>
      {groups.map((g) => (
        <section key={g.title} className="prefs-group">
          <div className="prefs-heading">{g.title}</div>
          <div className="prefs-card">
            {g.rows.map((r) => (
              <div key={r.label} className="prefs-row">
                <div className="prefs-text">
                  <span className="prefs-label">{r.label}</span>
                  {r.hint && <span className="prefs-hint">{r.hint}</span>}
                </div>
                {control(r)}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
