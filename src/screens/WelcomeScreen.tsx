import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { isFeedUrl } from '../lib/opml';
import { importOpmlFile } from '../lib/library-io';
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

  return (
    <div className="welcome">
      <div className="welcome-hero">
        <i className="ph-fill ph-waveform welcome-icon" />
        <h1 className="page-title welcome-title">Welcome to Resonate</h1>
        <span className="page-sub welcome-sub">Subscribe to a few shows to get started. New episodes land in your inbox, download automatically, and play from here or the system tray.</span>
      </div>
      <div className="dsc-search">
        <div className="dsc-input-wrap">
          <i className="ph ph-magnifying-glass dsc-input-icon" />
          <input className="input dsc-input" autoFocus placeholder="Search podcasts, or paste an RSS feed URL" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
        </div>
        <button className="btn btn-primary btn-13" disabled={!q.trim() || s.adding > 0} onClick={() => void submit()}>
          {s.adding ? <i className="ph ph-circle-notch spin" /> : isFeedUrl(q) ? <i className="ph ph-rss" /> : <i className="ph ph-magnifying-glass" />}
          {isFeedUrl(q) ? 'Subscribe' : 'Search'}
        </button>
      </div>
      <div className="welcome-cards">
        <button className="h-ring welcome-card" onClick={() => s.go('discover')}>
          <i className="ph ph-compass welcome-card-icon" />
          <span className="welcome-card-title">Browse popular shows</span>
          <span className="welcome-card-text">Search Apple Podcasts, gpodder.net and fyyd at once, or browse the charts.</span>
        </button>
        <button className="h-ring welcome-card" onClick={() => void importOpmlFile()}>
          <i className="ph ph-file-arrow-up welcome-card-icon" />
          <span className="welcome-card-title">Import from another app</span>
          <span className="welcome-card-text">Bring your subscriptions over with an OPML file (Ctrl+O).</span>
        </button>
      </div>
      <Popular />
      <span className="welcome-note">
        Using gpodder.net or another sync server? <button className="btn btn-ghost welcome-note-btn" onClick={() => s.set({ dialog: 'sync' })}>Connect it</button> and your subscriptions come with you.
      </span>
    </div>
  );
}

/** A few shows to start with: AntennaPod-style suggestions for the user's region. */
function Popular() {
  const sug = useSuggestions(6);
  if (sug.state === 'error' || (sug.state === 'ok' && !sug.results.length)) return null;
  return (
    <section aria-label="Popular in your region" className="dsc-section">
      <div className="welcome-pop-head">
        <span className="section-label">Popular in your region</span>
        <CountrySelect look="small" />
      </div>
      {sug.state === 'loading'
        ? <span className="welcome-loading"><i className="ph ph-circle-notch spin" /> Finding popular shows…</span>
        : <div className="welcome-pop-grid">{sug.results.map((r) => <DirectoryCard key={r.id} r={r} />)}</div>}
    </section>
  );
}
