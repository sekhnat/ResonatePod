import { useEffect, useRef, useState, type ReactNode } from 'react';
import { art, mono } from '../data';
import { useStore, type Override } from '../store';
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
  const s = useStore();
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
              if (k === 'speed' && s.cur.startsWith(`${sh.id}:`)) s.setSpeed(parseFloat((v === 'Global' ? s.sv.speed : v).replace('×', '')));
            }} style={{ alignSelf: 'flex-start' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--color-neutral-400)' }} onClick={() => s.set({ cfgOpen: false, dialog: 'unsubscribe' })}>Unsubscribe…</button>
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
  const s = useStore();
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
  ['Ctrl W', 'Close to tray'],
  ['Esc', 'Close dialogs and the full Now playing view'],
];

export function Dialogs() {
  const s = useStore();
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
        validate={(v) => (/^\d+$/.test(v) && +v >= 1 ? (+v * 1024 < s.usedMb ? `Already using ${(s.usedMb / 1024).toFixed(1)} GB — pick a larger limit` : null) : 'Enter a whole number of gigabytes')}
        onSave={(v) => s.setPrefs({ storageLimitGb: +v })} />;
    case 'sync':
      return <FieldDialog title="Sync server" body="Subscriptions and play positions sync with any gpodder-compatible server." label="Server address" initial={s.syncServer}
        validate={(v) => (/^[\w.-]+(:\d+)?(\/\S*)?$/.test(v.replace(/^https?:\/\//, '')) ? null : 'Enter a host name, e.g. gpodder.net')}
        onSave={(v) => { s.setPrefs({ syncServer: v.replace(/^https?:\/\//, '') }); s.toast('Sync server updated'); }} />;
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
            <span style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>Version 1.4 · A podcast downloader and player for the Linux desktop.</span>
            <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{s.shows.length} subscriptions · {(s.usedMb / 1024).toFixed(1)} GB in {s.folder}</span>
          </div>
          <div className="dialog-actions" style={{ margin: 0, justifyContent: 'center' }}><button className="btn btn-primary" style={{ fontSize: 12 }} onClick={close}>Close</button></div>
        </Modal>
      );
    default:
      return null;
  }
}
