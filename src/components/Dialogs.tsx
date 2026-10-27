import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { art, mono } from '../data';
import { trackedBytes, useStore, type Override } from '../store';
import { APP_VERSION } from '../version';
import { Seg } from './ui';

function Modal({ onClose, width = 480, children, label }: { onClose: () => void; width?: number; children: ReactNode; label: string }) {
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb,var(--color-bg) 60%,transparent)', backdropFilter: 'blur(2px)' }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()} style={{ width, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {children}
      </div>
    </div>
  );
}

export function ShowSettingsDialog() {
  const s = useStore(useShallow((s) => ({ cur: s.cur, ovr: s.ovr, resetOverride: s.resetOverride, set: s.set, setOverride: s.setOverride, setSpeed: s.setSpeed, showId: s.showId, shows: s.shows, sv: s.sv, tg: s.tg })));
  const sh = s.shows.find((x) => x.id === s.showId);
  if (!sh) return null;
  const close = () => s.set({ cfgOpen: false });
  const ovr = s.ovr[sh.id] ?? {};
  const rows: [keyof Override, string, string[], string][] = [
    ['dl', 'Auto-download', ['Global', 'Latest 1', 'Latest 3', 'All', 'Off'], s.tg.auto ? `Global: latest ${s.sv.keep}` : 'Global: off'],
    ['speed', 'Playback speed', ['Global', '1×', '1.2×', '1.5×', '2×'], `Global: ${s.sv.speed}`],
    ['trim', 'Trim silence', ['Global', 'On', 'Off'], s.tg.silence ? 'Global: on' : 'Global: off'],
    ['intro', 'Skip intro', ['Off', '30 s', '60 s', '90 s'], 'Skips from start on every episode'],
  ];
  return (
    <Modal onClose={close} label={`${sh.title} settings`}>
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
        <span style={{ width: 44, height: 44, flex: 'none', borderRadius: 6, background: art(sh.hue), display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 600, color: 'var(--color-neutral-100)' }}>{mono(sh.title)}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="dialog-title" style={{ margin: 0 }}>{sh.title}</span>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>Overrides for this show · Global uses Preferences</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {rows.map(([k, label, opts, hint]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 13 }}>{label}</span>
              <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{hint}</span>
            </div>
            <Seg options={opts} value={ovr[k] ?? opts[0]} onPick={(v) => {
              s.setOverride(sh.id, k, v);
              // Speed and trim apply live when this show is playing.
              if (k === 'speed' && s.cur?.startsWith(`${sh.id}:`)) s.setSpeed(parseFloat((v === 'Global' ? s.sv.speed : v).replace('×', '')));
            }} style={{ alignSelf: 'flex-start' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--color-neutral-400)' }} onClick={() => s.set({ cfgOpen: false, dialog: 'unsubscribe' })}>Unsubscribe…</button>
          <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--color-neutral-400)' }} title="For private feeds that ask for a username and password"
            onClick={() => s.set({ cfgOpen: false, dialog: 'feedAuth', authFor: { url: sh.feedUrl, showId: sh.id } })}>Feed login…</button>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button className="btn btn-secondary" onClick={() => s.resetOverride(sh.id)} style={{ fontSize: 12 }}>Reset to global</button>
          <button className="btn btn-primary" onClick={close} style={{ fontSize: 12 }}>Done</button>
        </div>
      </div>
    </Modal>
  );
}

function FieldDialog({ title, body, label, initial, suffix, validate, onSave }: {
  title: string; body: string; label: string; initial: string; suffix?: string;
  validate: (v: string) => string | null; onSave: (v: string) => void;
}) {
  const s = useStore(useShallow((s) => ({ set: s.set })));
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);
  const close = () => s.set({ dialog: null });
  const save = () => {
    const e = validate(v.trim());
    if (e) { setErr(e); return; }
    onSave(v.trim());
    close();
  };
  return (
    <Modal onClose={close} width={440} label={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="dialog-title">{title}</span>
        <span className="dialog-body" style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>{body}</span>
      </div>
      <div className="field">
        <label htmlFor="field-dialog-input">{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input id="field-dialog-input" ref={ref} className="input" value={v} onChange={(e) => { setV(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }} style={{ fontFamily: 'ui-monospace,monospace', fontSize: 13 }} />
          {suffix && <span style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>{suffix}</span>}
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--color-accent-300)', marginTop: 6 }}>{err}</div>}
      </div>
      <div className="dialog-actions" style={{ margin: 0, gap: 'var(--space-3)' }}>
        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={close}>Cancel</button>
        <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← / →', 'Skip back / forward'],
  ['Ctrl K', 'Search or run a command'],
  ['Ctrl R', 'Refresh all feeds'],
  ['Ctrl 1 – 5', 'New episodes, Shows, Queue, Downloads, Discover'],
  ['Ctrl ,', 'Preferences'],
  ['Ctrl /', 'Keyboard shortcuts'],
  ['Ctrl O / Ctrl E', 'Import / export OPML'],
  ['Ctrl W', 'Close to tray'],
  ['Ctrl Q', 'Quit'],
  ['Esc', 'Close dialogs and the full Now playing view'],
];

export function Dialogs() {
  const s = useStore(useShallow((s) => ({
    cleanupStorage: s.cleanupStorage, dialog: s.dialog, eps: s.eps, folder: s.folder, moveDownloads: s.moveDownloads, pendingMove: s.pendingMove, set: s.set,
    setPrefs: s.setPrefs, showId: s.showId, shows: s.shows, storageLimitGb: s.storageLimitGb, toast: s.toast, unsubscribe: s.unsubscribe,
  })));
  const close = () => s.set({ dialog: null });
  const sh = s.shows.find((x) => x.id === s.showId);

  switch (s.dialog) {
    case 'unsubscribe':
      if (!sh) return null;
      return (
        <Modal onClose={close} width={420} label="Unsubscribe">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="dialog-title">Unsubscribe from {sh.title}?</span>
            <span className="dialog-body" style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>
              Resonate stops checking this feed and removes its episodes from your queue. Downloaded files stay in {s.folder} until you delete them.
            </span>
          </div>
          <div className="dialog-actions" style={{ margin: 0, gap: 'var(--space-3)' }}>
            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={close}>Cancel</button>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => s.unsubscribe(sh.id)}>Unsubscribe</button>
          </div>
        </Modal>
      );
    case 'folder':
      return <FieldDialog title="Download folder" body="New downloads are saved here, one sub-folder per show." label="Folder" initial={s.folder}
        validate={(v) => (v.startsWith('/') || v.startsWith('~') ? null : 'Use an absolute path, or one starting with ~')}
        onSave={(folder) => { s.setPrefs({ folder }); s.toast(`Downloads will be saved to ${folder}`); }} />;
    case 'storage':
      return <FieldDialog title="Storage limit" body="When downloads pass this size, the oldest played files are removed first." label="Limit" suffix="GB" initial={String(s.storageLimitGb)}
        validate={(v) => (/^\d+$/.test(v) && +v >= 1 ? (+v * 1024 ** 3 < trackedBytes(s.eps) ? `Already using ${(trackedBytes(s.eps) / 1024 ** 3).toFixed(1)} GB — pick a larger limit` : null) : 'Enter a whole number of gigabytes')}
        onSave={(v) => { s.setPrefs({ storageLimitGb: +v }); void s.cleanupStorage(); }} />;
    case 'sync':
      return <SyncDialog />;
    case 'feedAuth':
      return <FeedAuthDialog />;
    case 'podcastIndex':
      return <PodcastIndexDialog />;
    case 'move': {
      const mv = s.pendingMove;
      if (!mv) return null;
      const files = Object.values(s.eps).filter((e) => e.file);
      const gb = files.reduce((a, e) => a + (e.fileBytes ?? 0), 0) / 1024 ** 3;
      const leave = () => { s.set({ dialog: null, pendingMove: null }); s.toast(`New downloads will be saved to ${mv.to}`); };
      return (
        <Modal onClose={leave} width={440} label="Move downloads">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="dialog-title">Move downloaded episodes?</span>
            <span className="dialog-body" style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>
              New downloads go to {mv.to}. Move the {files.length} episode{files.length === 1 ? '' : 's'} already in {mv.from} ({gb < 0.1 ? `${Math.max(1, Math.round(gb * 1024))} MB` : `${gb.toFixed(1)} GB`}) there too?
            </span>
          </div>
          <div className="dialog-actions" style={{ margin: 0, gap: 'var(--space-3)' }}>
            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={leave}>Leave them</button>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => void s.moveDownloads(mv.from, mv.to)}>Move</button>
          </div>
        </Modal>
      );
    }
    case 'shortcuts':
      return (
        <Modal onClose={close} width={460} label="Keyboard shortcuts">
          <span className="dialog-title">Keyboard shortcuts</span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {SHORTCUTS.map(([k, d], i) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', boxShadow: i ? '0 -1px 0 var(--color-neutral-800)' : undefined }}>
                <span style={{ width: 96, fontSize: 11, color: 'var(--color-neutral-300)' }}><span style={{ padding: '2px 6px', borderRadius: 4, background: 'var(--color-neutral-900)' }}>{k}</span></span>
                <span style={{ fontSize: 13 }}>{d}</span>
              </div>
            ))}
          </div>
          <div className="dialog-actions" style={{ margin: 0 }}><button className="btn btn-primary" style={{ fontSize: 12 }} onClick={close}>Done</button></div>
        </Modal>
      );
    case 'about':
      return (
        <Modal onClose={close} width={380} label="About Resonate">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <i className="ph-fill ph-waveform" style={{ fontSize: 44, color: 'var(--color-accent)' }} />
            <span className="dialog-title">Resonate</span>
            <span style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>Version {APP_VERSION} · A podcast downloader and player for the Linux desktop.</span>
            <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{s.shows.length} subscriptions · {(trackedBytes(s.eps) / 1024 ** 3).toFixed(1)} GB in {s.folder}</span>
          </div>
          <div className="dialog-actions" style={{ margin: 0, justifyContent: 'center' }}><button className="btn btn-primary" style={{ fontSize: 12 }} onClick={close}>Close</button></div>
        </Modal>
      );
    default:
      return null;
  }
}

function SyncDialog() {
  const s = useStore(useShallow((s) => ({ configureSync: s.configureSync, disconnectSync: s.disconnectSync, runSync: s.runSync, set: s.set, sync: s.sync, syncing: s.syncing, toast: s.toast })));
  const [server, setServer] = useState(s.sync.server || 'gpodder.net');
  const [user, setUser] = useState(s.sync.user);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => s.set({ dialog: null });
  const connected = !!s.sync.server;
  const save = async () => {
    if (!server.trim() || !user.trim() || !password) return;
    setBusy(true);
    const ok = await s.configureSync(server.trim(), user.trim(), password);
    setBusy(false);
    if (ok) { s.toast(`Syncing with ${server.trim()}`); close(); }
  };
  const field = (id: string, label: string, value: string, set: (v: string) => void, type = 'text', placeholder = '') => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" type={type} value={value} placeholder={placeholder} autoComplete="off"
        onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
    </div>
  );
  return (
    <Modal onClose={close} width={440} label="Sync server">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="dialog-title">Sync server</span>
        <span className="dialog-body" style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>
          Keep subscriptions and play positions in step with other apps through gpodder.net or a compatible server (oPodSync, Nextcloud gPodder Sync).
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {field('sync-server', 'Server', server, setServer, 'text', 'gpodder.net')}
        {field('sync-user', 'Username', user, setUser)}
        {field('sync-pass', connected ? 'Password (re-enter to change)' : 'Password', password, setPassword, 'password')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {connected ? <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--color-neutral-400)' }} onClick={() => { s.disconnectSync(); close(); }}>Disconnect</button> : <span />}
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {connected && <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={s.syncing} onClick={() => void s.runSync()}>{s.syncing ? 'Syncing…' : 'Sync now'}</button>}
          <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={busy || !server.trim() || !user.trim() || !password} onClick={() => void save()}>
            {busy ? <i className="ph ph-circle-notch spin" /> : null}{connected ? 'Save' : 'Connect'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FeedAuthDialog() {
  const s = useStore(useShallow((s) => ({ authFor: s.authFor, set: s.set, signInFeed: s.signInFeed, toast: s.toast })));
  const target = s.authFor;
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!target) return null;
  const host = (() => { try { return new URL(target.url).host; } catch { return target.url; } })();
  const close = () => s.set({ dialog: null, authFor: null });
  const save = async () => {
    if (!user.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const r = await s.signInFeed(target.url, user.trim(), password, target.showId);
    setBusy(false);
    if (r === 'denied') { setErr('The server didn’t accept that username and password.'); return; }
    if (r === 'ok') s.toast(target.showId ? `Saved the login for ${host}` : `Signed in to ${host}`);
    if (useStore.getState().authFor === target) close();
  };
  const field = (id: string, label: string, value: string, set: (v: string) => void, type = 'text') => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" type={type} value={value} autoComplete="off" autoFocus={id === 'feed-user'}
        onChange={(e) => { set(e.target.value); setErr(null); }} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
    </div>
  );
  return (
    <Modal onClose={close} width={440} label="Feed login">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="dialog-title">This feed needs a login</span>
        <span className="dialog-body" style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>
          {host} asks for a username and password. Resonate stores them encrypted with your system keyring and only sends them to {host}.
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {field('feed-user', 'Username', user, setUser)}
        {field('feed-pass', 'Password', password, setPassword, 'password')}
        {err && <div style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>{err}</div>}
      </div>
      <div className="dialog-actions" style={{ margin: 0, gap: 'var(--space-3)' }}>
        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={close}>Cancel</button>
        <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={busy || !user.trim()} onClick={() => void save()}>
          {busy ? <i className="ph ph-circle-notch spin" /> : null}Sign in
        </button>
      </div>
    </Modal>
  );
}

function PodcastIndexDialog() {
  const s = useStore(useShallow((s) => ({ directory: s.directory, set: s.set, setPodcastIndexKey: s.setPodcastIndexKey, toast: s.toast })));
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const close = () => s.set({ dialog: null });
  const ok = key.trim() && secret.trim();
  const save = async () => {
    if (!ok) return;
    await s.setPodcastIndexKey({ key: key.trim(), secret: secret.trim() });
    s.toast('Podcast Index added to search');
    close();
  };
  const field = (id: string, label: string, value: string, set: (v: string) => void, type = 'text') => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" type={type} value={value} autoComplete="off" spellCheck={false} autoFocus={id === 'pi-key'}
        style={{ fontFamily: 'ui-monospace,monospace', fontSize: 13 }}
        onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
    </div>
  );
  return (
    <Modal onClose={close} width={460} label="Podcast Index">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="dialog-title">Podcast Index</span>
        <span className="dialog-body" style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>
          The open Podcast Index lists over four million shows. Its API needs a key: sign up for free at
          {' '}<a href="https://api.podcastindex.org/" target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)' }}>api.podcastindex.org</a>, then paste the key and secret here.
          They’re stored encrypted with your system keyring.
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {field('pi-key', 'API key', key, setKey)}
        {field('pi-secret', 'API secret', secret, setSecret, 'password')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {s.directory.podcastIndex
          ? <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--color-neutral-400)' }} onClick={() => { void s.setPodcastIndexKey(null); s.toast('Podcast Index removed'); close(); }}>Remove key</button>
          : <span />}
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={close}>Cancel</button>
          <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={!ok} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
