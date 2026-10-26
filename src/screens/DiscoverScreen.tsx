import { useRef } from 'react';
import { CATS, DISCOVER, art, mono } from '../data';
import { useStore } from '../store';
import { isFeedUrl } from '../lib/opml';
import { Art, h1Style } from '../components/ui';
import { Empty } from './ShowScreen';

export function DiscoverScreen() {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const q = s.discoverQuery.trim().toLowerCase();
  const results = DISCOVER.filter((d) => (s.cat === 'Popular' || d.cat === s.cat) && (!q || isFeedUrl(q) || `${d.title} ${d.blurb} ${d.author}`.toLowerCase().includes(q)));
  const subscribed = (title: string) => s.shows.some((x) => x.title === title);

  const addByUrl = () => {
    const url = s.discoverQuery.trim();
    if (!isFeedUrl(url)) {
      input.current?.focus();
      s.toast('Paste an RSS feed URL into the search field first');
      return;
    }
    const id = s.addFeed(url);
    if (id) {
      s.set({ discoverQuery: '' });
      s.toast('Feed added');
      s.openShow(id);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 860 }}>
      <h1 style={h1Style}>Discover</h1>
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: 11, fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input ref={input} className="input" placeholder="Search podcasts, or paste an RSS feed URL" style={{ paddingLeft: 34 }}
            value={s.discoverQuery} onChange={(e) => s.set({ discoverQuery: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && isFeedUrl(s.discoverQuery)) addByUrl(); }} />
        </div>
        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={addByUrl}><i className="ph ph-rss" style={{ fontSize: 14 }} />Add by URL</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {CATS.map((c) => {
          const on = s.cat === c;
          return (
            <span key={c} className="seg-opt" role="button" tabIndex={0} aria-pressed={on} onClick={() => s.set({ cat: c })}
              onKeyDown={(e) => { if (e.key === 'Enter') s.set({ cat: c }); }}
              style={{ border: '1px solid var(--color-divider)', borderRadius: 999, fontSize: 12, padding: '5px 12px', background: on ? 'var(--color-accent-800)' : 'transparent', color: on ? 'var(--color-accent-100)' : 'inherit' }}>{c}</span>
          );
        })}
      </div>
      {isFeedUrl(q) && (
        <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>
          That looks like a feed URL — press Enter or <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '0 4px' }} onClick={addByUrl}>Add by URL</button> to subscribe.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 'var(--space-4)' }}>
        {results.map((r) => {
          const on = subscribed(r.title);
          return (
            <div key={r.title} className="card" style={{ flexDirection: 'row', gap: 'var(--space-4)', padding: 'var(--space-4)', alignItems: 'flex-start' }}>
              <Art bg={art(r.hue)} mono={mono(r.title)} size={64} font={18} weight={500} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="card-title" style={{ fontSize: 14 }}>{r.title}</span>
                <span style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', lineHeight: 1.4 }}>{r.blurb}</span>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                  <span className="card-meta" style={{ margin: 0 }}>{r.cat} · {r.freq}</span>
                  <button className="btn btn-primary" onClick={() => s.toggleDiscover(r.title)}
                    style={{ fontSize: 11.5, padding: '3px 10px', minHeight: 0, color: on ? 'var(--color-neutral-400)' : 'var(--color-accent)', borderColor: on ? 'var(--color-divider)' : 'var(--color-accent)' }}>
                    {on ? 'Subscribed' : 'Subscribe'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!results.length && <Empty icon="ph ph-magnifying-glass" text="No podcasts match. Try another search, or paste a feed URL." />}
    </div>
  );
}
