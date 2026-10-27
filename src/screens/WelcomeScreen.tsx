import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { isFeedUrl } from '../lib/opml';
import { importOpmlFile } from '../lib/library-io';
import { h1Style, sectionLabel, subStyle } from '../components/ui';
import { CountrySelect, DirectoryCard, useSuggestions } from '../components/DirectoryCard';

/** First run: no subscriptions yet. */
export function WelcomeScreen() {
  const s = useStore(useShallow((s) => ({ addFeed: s.addFeed, adding: s.adding, go: s.go, openShow: s.openShow, set: s.set })));
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', maxWidth: 720, paddingTop: 'var(--space-8)' }}>
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
          <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>Search Apple Podcasts, gpodder.net and fyyd at once, or browse the charts.</span>
        </button>
        <button className="h-ring" style={card} onClick={() => void importOpmlFile()}>
          <i className="ph ph-file-arrow-up" style={{ fontSize: 22, color: 'var(--color-accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>Import from another app</span>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>Bring your subscriptions over with an OPML file (Ctrl+O).</span>
        </button>
      </div>
      <Popular />
      <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
        Using gpodder.net or another sync server? <button className="btn btn-ghost" style={{ fontSize: 12, padding: '0 4px' }} onClick={() => s.set({ dialog: 'sync' })}>Connect it</button> and your subscriptions come with you.
      </span>
    </div>
  );
}

/** A few shows to start with: AntennaPod-style suggestions for the user's region. */
function Popular() {
  const sug = useSuggestions(6);
  if (sug.state === 'error' || (sug.state === 'ok' && !sug.results.length)) return null;
  return (
    <section aria-label="Popular in your region" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={sectionLabel}>Popular in your region</span>
        <CountrySelect style={{ minHeight: 28, fontSize: 12, padding: '2px 6px' }} />
      </div>
      {sug.state === 'loading'
        ? <span style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}><i className="ph ph-circle-notch spin" /> Finding popular shows…</span>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 'var(--space-3)' }}>{sug.results.map((r) => <DirectoryCard key={r.id} r={r} />)}</div>}
    </section>
  );
}
