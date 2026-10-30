import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { art, mono } from '../data';
import { trackedBytes, useStore, type Override } from '../store';
import { dlRuleLabel, introLabel, keepLabel, onOff, orGlobal, speedLabel } from '../settings-labels';
import { platform } from '../platform';
import { restoreBackupFile } from '../lib/library-io';
import { APP_VERSION } from '../version';
import { Seg } from './ui';
import { useSecretConsent } from './SecretNotice';

function Modal({ onClose, width = 480, children, label }: { onClose: () => void; width?: number; children: ReactNode; label: string }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="dialog modal" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()} style={{ width }}>
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
  // One row of choices for one of the show's overrides; undefined is "follow the global setting".
  const row = <K extends keyof Override>(k: K, label: string, hint: string, options: (Override[K] | undefined)[], format: (v: Override[K] | undefined) => string) => (
    <div key={k} className="cfg-row">
      <div className="cfg-row-head">
        <span className="cfg-label">{label}</span>
        <span className="cfg-hint">{hint}</span>
      </div>
      <Seg options={options} value={ovr[k]} format={format} onPick={(v) => {
        s.setOverride(sh.id, k, v);
        // Speed and trim apply live when this show is playing.
        if (k === 'speed' && s.cur?.startsWith(`${sh.id}:`)) s.setSpeed((v as Override['speed']) ?? s.sv.speed);
      }} />
    </div>
  );
  return (
    <Modal onClose={close} label={`${sh.title} settings`}>
      <div className="cfg-head">
        <span className="cfg-art" style={{ background: art(sh.hue) }}>{mono(sh.title)}</span>
        <div className="cfg-meta">
          <span className="dialog-title cfg-title">{sh.title}</span>
          <span className="cfg-sub">Overrides for this show · Global uses Preferences</span>
        </div>
      </div>
      <div className="modal-fields">
        {row('dl', 'Auto-download', s.tg.auto ? `Global: latest ${keepLabel(s.sv.keep)}` : 'Global: off', [undefined, 1, 3, 'all', 'off'], orGlobal(dlRuleLabel))}
        {row('speed', 'Playback speed', `Global: ${speedLabel(s.sv.speed)}`, [undefined, 1, 1.2, 1.5, 2], orGlobal(speedLabel))}
        {row('trim', 'Trim silence', s.tg.silence ? 'Global: on' : 'Global: off', [undefined, true, false], orGlobal(onOff))}
        {row('intro', 'Skip intro', 'Skips from start on every episode', [undefined, 30, 60, 90], introLabel)}
      </div>
      <div className="modal-foot">
        <div className="modal-foot-left">
          <button className="btn btn-ghost btn-12 quiet" onClick={() => s.set({ cfgOpen: false, dialog: 'unsubscribe' })}>Unsubscribe…</button>
          <button className="btn btn-ghost btn-12 quiet" title="For private feeds that ask for a username and password"
            onClick={() => s.set({ cfgOpen: false, dialog: 'feedAuth', authFor: { url: sh.feedUrl, showId: sh.id } })}>Feed login…</button>
        </div>
        <div className="modal-foot-right">
          <button className="btn btn-secondary btn-12" onClick={() => s.resetOverride(sh.id)}>Reset to global</button>
          <button className="btn btn-primary btn-12" onClick={close}>Done</button>
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
      <div className="modal-head">
        <span className="dialog-title">{title}</span>
        <span className="dialog-body modal-text">{body}</span>
      </div>
      <div className="field">
        <label htmlFor="field-dialog-input">{label}</label>
        <div className="field-row">
          <input id="field-dialog-input" ref={ref} className="input mono" value={v} onChange={(e) => { setV(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
          {suffix && <span className="field-suffix">{suffix}</span>}
        </div>
        {err && <div className="form-error spaced">{err}</div>}
      </div>
      <div className="dialog-actions flush roomy">
        <button className="btn btn-secondary btn-12" onClick={close}>Cancel</button>
        <button className="btn btn-primary btn-12" onClick={save}>Save</button>
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
    cleanupStorage: s.cleanupStorage, dialog: s.dialog, eps: s.eps, folder: s.folder, moveDownloads: s.moveDownloads, pendingMove: s.pendingMove, restoreFrom: s.restoreFrom, set: s.set,
    setPrefs: s.setPrefs, showId: s.showId, shows: s.shows, storageLimitGb: s.storageLimitGb, toast: s.toast, unsubscribe: s.unsubscribe,
  })));
  const close = () => s.set({ dialog: null });
  const sh = s.shows.find((x) => x.id === s.showId);

  switch (s.dialog) {
    case 'unsubscribe':
      if (!sh) return null;
      return (
        <Modal onClose={close} width={420} label="Unsubscribe">
          <div className="modal-head loose">
            <span className="dialog-title">Unsubscribe from {sh.title}?</span>
            <span className="dialog-body modal-text">
              Resonate stops checking this feed and removes its episodes from your queue. Downloaded files stay in {s.folder} until you delete them.
            </span>
          </div>
          <div className="dialog-actions flush roomy">
            <button className="btn btn-secondary btn-12" onClick={close}>Cancel</button>
            <button className="btn btn-primary btn-12" onClick={() => s.unsubscribe(sh.id)}>Unsubscribe</button>
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
          <div className="modal-head loose">
            <span className="dialog-title">Move downloaded episodes?</span>
            <span className="dialog-body modal-text">
              New downloads go to {mv.to}. Move the {files.length} episode{files.length === 1 ? '' : 's'} already in {mv.from} ({gb < 0.1 ? `${Math.max(1, Math.round(gb * 1024))} MB` : `${gb.toFixed(1)} GB`}) there too?
            </span>
          </div>
          <div className="dialog-actions flush roomy">
            <button className="btn btn-secondary btn-12" onClick={leave}>Leave them</button>
            <button className="btn btn-primary btn-12" onClick={() => void s.moveDownloads(mv.from, mv.to)}>Move</button>
          </div>
        </Modal>
      );
    }
    case 'restore': {
      const b = s.restoreFrom;
      if (!b) return null;
      const cancel = () => s.set({ dialog: null, restoreFrom: null });
      const made = new Date(b.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      return (
        <Modal onClose={cancel} width={460} label="Restore library">
          <div className="modal-head loose">
            <span className="dialog-title">Replace your library with this backup?</span>
            <span className="dialog-body modal-text">
              {b.name} was made on {made} by Resonate {b.app}. It has {b.shows} show{b.shows === 1 ? '' : 's'} and {b.episodes.toLocaleString()} episode{b.episodes === 1 ? '' : 's'}.
            </span>
            <span className="dialog-body modal-text">
              Your subscriptions, episodes, play positions, queue and preferences are replaced, and Resonate reloads. The library you have now is kept as library.db.before-restore. Saved passwords aren’t in backups.
            </span>
          </div>
          <div className="dialog-actions flush roomy">
            <button className="btn btn-secondary btn-12" onClick={cancel}>Cancel</button>
            <button className="btn btn-primary btn-12" onClick={() => void restoreBackupFile()}>Restore</button>
          </div>
        </Modal>
      );
    }
    case 'shortcuts':
      return (
        <Modal onClose={close} width={460} label="Keyboard shortcuts">
          <span className="dialog-title">Keyboard shortcuts</span>
          <div className="sc-list">
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} className="sc-row">
                <span className="sc-keys"><span className="sc-key">{k}</span></span>
                <span className="sc-desc">{d}</span>
              </div>
            ))}
          </div>
          <div className="dialog-actions flush"><button className="btn btn-primary btn-12" onClick={close}>Done</button></div>
        </Modal>
      );
    case 'about':
      return (
        <Modal onClose={close} width={380} label="About Resonate">
          <div className="about">
            <i className="ph-fill ph-waveform about-icon" />
            <span className="dialog-title">Resonate</span>
            <span className="about-sub">Version {APP_VERSION} · A podcast downloader and player for the Linux desktop.</span>
            <span className="about-stat">{s.shows.length} subscriptions · {(trackedBytes(s.eps) / 1024 ** 3).toFixed(1)} GB in {s.folder}</span>
          </div>
          <div className="dialog-actions flush roomy center">
            {platform.isDesktop && <button className="btn btn-secondary btn-12" onClick={() => platform.openLogs()}>Open logs folder</button>}
            <button className="btn btn-primary btn-12" onClick={close}>Close</button>
          </div>
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
  const consent = useSecretConsent();
  const close = () => s.set({ dialog: null });
  const connected = !!s.sync.server;
  const save = async () => {
    if (consent.blocked || !server.trim() || !user.trim() || !password) return;
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
      <div className="modal-head">
        <span className="dialog-title">Sync server</span>
        <span className="dialog-body modal-text">
          Keep subscriptions and play positions in step with other apps through gpodder.net or a compatible server (oPodSync, Nextcloud gPodder Sync).
        </span>
      </div>
      <div className="modal-fields">
        {field('sync-server', 'Server', server, setServer, 'text', 'gpodder.net')}
        {field('sync-user', 'Username', user, setUser)}
        {field('sync-pass', connected ? 'Password (re-enter to change)' : 'Password', password, setPassword, 'password')}
        {consent.notice}
      </div>
      <div className="modal-foot">
        {connected ? <button className="btn btn-ghost btn-12 quiet" onClick={() => { s.disconnectSync(); close(); }}>Disconnect</button> : <span />}
        <div className="modal-foot-right">
          {connected && <button className="btn btn-secondary btn-12" disabled={s.syncing} onClick={() => void s.runSync()}>{s.syncing ? 'Syncing…' : 'Sync now'}</button>}
          <button className="btn btn-primary btn-12" disabled={busy || consent.blocked || !server.trim() || !user.trim() || !password} onClick={() => void save()}>
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
  const consent = useSecretConsent();
  if (!target) return null;
  const host = (() => { try { return new URL(target.url).host; } catch { return target.url; } })();
  const close = () => s.set({ dialog: null, authFor: null });
  const save = async () => {
    if (!user.trim() || busy || consent.blocked) return;
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
      <div className="modal-head">
        <span className="dialog-title">This feed needs a login</span>
        <span className="dialog-body modal-text">
          {host} asks for a username and password. {consent.secure ? 'Resonate stores them encrypted with your system keyring and' : 'Resonate'} only sends them to {host}.
        </span>
      </div>
      <div className="modal-fields">
        {field('feed-user', 'Username', user, setUser)}
        {field('feed-pass', 'Password', password, setPassword, 'password')}
        {consent.notice}
        {err && <div className="form-error">{err}</div>}
      </div>
      <div className="dialog-actions flush roomy">
        <button className="btn btn-secondary btn-12" onClick={close}>Cancel</button>
        <button className="btn btn-primary btn-12" disabled={busy || consent.blocked || !user.trim()} onClick={() => void save()}>
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
  const consent = useSecretConsent();
  const close = () => s.set({ dialog: null });
  const ok = key.trim() && secret.trim() && !consent.blocked;
  const save = async () => {
    if (!ok) return;
    await s.setPodcastIndexKey({ key: key.trim(), secret: secret.trim() });
    s.toast('Podcast Index added to search');
    close();
  };
  const field = (id: string, label: string, value: string, set: (v: string) => void, type = 'text') => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input mono" type={type} value={value} autoComplete="off" spellCheck={false} autoFocus={id === 'pi-key'}
        onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
    </div>
  );
  return (
    <Modal onClose={close} width={460} label="Podcast Index">
      <div className="modal-head">
        <span className="dialog-title">Podcast Index</span>
        <span className="dialog-body modal-text">
          The open Podcast Index lists over four million shows. Its API needs a key: sign up for free at
          {' '}<a className="pi-link" href="https://api.podcastindex.org/" target="_blank" rel="noreferrer">api.podcastindex.org</a>, then paste the key and secret here.
          {consent.secure ? ' They’re stored encrypted with your system keyring.' : ''}
        </span>
      </div>
      <div className="modal-fields">
        {field('pi-key', 'API key', key, setKey)}
        {field('pi-secret', 'API secret', secret, setSecret, 'password')}
        {consent.notice}
      </div>
      <div className="modal-foot">
        {s.directory.podcastIndex
          ? <button className="btn btn-ghost btn-12 quiet" onClick={() => { void s.setPodcastIndexKey(null); s.toast('Podcast Index removed'); close(); }}>Remove key</button>
          : <span />}
        <div className="modal-foot-right">
          <button className="btn btn-secondary btn-12" onClick={close}>Cancel</button>
          <button className="btn btn-primary btn-12" disabled={!ok} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
