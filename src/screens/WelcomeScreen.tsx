import { useState } from 'react';
import { useStore } from '../store';
import { isFeedUrl } from '../lib/opml';
import { importOpmlFile } from '../lib/library-io';
import { h1Style, subStyle } from '../components/ui';

/** First run: no subscriptions yet. */
export function WelcomeScreen() {
  const s = useStore();
  const [q, setQ] = useState('');
  const submit = async () => {
    const v = q.trim();
    if (!v) return;
    if (isFeedUrl(v)) {
      const id = await s.addFeed(v);
      if (id) s.openShow(id);
    } else {
      s.go('discover', { discoverQuery: v });
    }
  };
  const card = { display: 'flex', flexDirection: 'column', gap: 6, padding: 'var(--space-6)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', border: 'none', color: 'inherit', textAlign: 'left', cursor: 'pointer' } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', maxWidth: 640, paddingTop: 'var(--space-8)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <i className="ph-fill ph-waveform" style={{ fontSize: 40, color: 'var(--color-accent)' }} />
        <h1 style={{ ...h1Style, fontSize: 30 }}>Welcome to Resonate</h1>
        <span style={{ ...subStyle, fontSize: 14, lineHeight: 1.5 }}>Subscribe to a few shows to get started. New episodes land in your inbox, download automatically, and play from here or the system tray.</span>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: 11, fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input className="input" autoFocus placeholder="Search podcasts, or paste an RSS feed URL" style={{ paddingLeft: 34 }} value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
        </div>
        <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={!q.trim() || s.adding > 0} onClick={() => void submit()}>
          {s.adding ? <i className="ph ph-circle-notch spin" /> : isFeedUrl(q) ? <i className="ph ph-rss" /> : <i className="ph ph-magnifying-glass" />}
          {isFeedUrl(q) ? 'Subscribe' : 'Search'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <button className="h-ring" style={card} onClick={() => s.go('discover')}>
          <i className="ph ph-compass" style={{ fontSize: 22, color: 'var(--color-accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>Browse popular shows</span>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>Top podcasts from the Apple Podcasts directory, by category.</span>
        </button>
        <button className="h-ring" style={card} onClick={() => void importOpmlFile()}>
          <i className="ph ph-file-arrow-up" style={{ fontSize: 22, color: 'var(--color-accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>Import from another app</span>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>Bring your subscriptions over with an OPML file (Ctrl+O).</span>
        </button>
      </div>
      <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
        Using gpodder.net or another sync server? <button className="btn btn-ghost" style={{ fontSize: 12, padding: '0 4px' }} onClick={() => s.set({ dialog: 'sync' })}>Connect it</button> and your subscriptions come with you.
      </span>
    </div>
  );
}
