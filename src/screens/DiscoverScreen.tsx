import { useEffect, useRef, useState } from 'react';
import { CATS, art, hueFor, mono } from '../data';
import { useStore } from '../store';
import { isFeedUrl } from '../lib/opml';
import { searchDirectory, topPodcasts, type DirectoryResult } from '../lib/directory';
import { Art, h1Style } from '../components/ui';
import { Empty } from './ShowScreen';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; results: DirectoryResult[] };

export function DiscoverScreen() {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const q = s.discoverQuery.trim();
  const isUrl = isFeedUrl(q);

  useEffect(() => {
    if (isUrl) return;
    let live = true;
    setLoad({ state: 'loading' });
    const genre = s.cat === 'Popular' ? undefined : s.cat;
    const t = setTimeout(() => {
      (q ? searchDirectory(q, genre) : topPodcasts(genre))
        .then((results) => { if (live) setLoad({ state: 'ok', results }); })
        .catch((err: Error) => { if (live) setLoad({ state: 'error', message: err.message }); });
    }, q ? 350 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q, s.cat, isUrl, retry]);

  const subscribedId = (feedUrl: string) => s.shows.find((x) => x.feedUrl === feedUrl)?.id;

  const addByUrl = async () => {
    if (!isUrl) {
      input.current?.focus();
      s.toast('Paste an RSS feed URL into the search field first');
      return;
    }
    setBusy(q);
    const id = await s.addFeed(q);
    setBusy(null);
    if (id) { s.set({ discoverQuery: '' }); s.openShow(id); }
  };

  const toggle = async (r: DirectoryResult) => {
    const id = subscribedId(r.feedUrl);
    if (id) { s.unsubscribe(id); return; }
    setBusy(r.feedUrl);
    await s.addFeed(r.feedUrl);
    setBusy(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 860 }}>
      <h1 style={h1Style}>Discover</h1>
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 11, top: 11, fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <input ref={input} className="input" placeholder="Search podcasts, or paste an RSS feed URL" style={{ paddingLeft: 34 }} autoFocus
            value={s.discoverQuery} onChange={(e) => s.set({ discoverQuery: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && isUrl) void addByUrl(); }} />
        </div>
        <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy === q && isUrl} onClick={() => void addByUrl()}>
          <i className={busy === q && isUrl ? 'ph ph-circle-notch spin' : 'ph ph-rss'} style={{ fontSize: 14 }} />Add by URL
        </button>
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
      {isUrl && (
        <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>
          That looks like a feed URL — press Enter or <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '0 4px' }} onClick={() => void addByUrl()}>Add by URL</button> to subscribe.
        </div>
      )}
      {!isUrl && load.state === 'loading' && <Empty icon="ph ph-circle-notch spin" text={q ? `Searching for “${q}”…` : 'Loading popular shows…'} />}
      {!isUrl && load.state === 'error' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--color-neutral-400)' }}>
          <i className="ph ph-wifi-slash" style={{ fontSize: 18 }} />Couldn’t reach the podcast directory ({load.message}).
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setRetry((n) => n + 1)}>Try again</button>
        </div>
      )}
      {!isUrl && load.state === 'ok' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 'var(--space-4)' }}>
            {load.results.map((r) => {
              const on = !!subscribedId(r.feedUrl);
              const working = busy === r.feedUrl;
              return (
                <div key={r.id} className="card" style={{ flexDirection: 'row', gap: 'var(--space-4)', padding: 'var(--space-4)', alignItems: 'flex-start' }}>
                  <Art bg={art(hueFor(r.title))} mono={mono(r.title)} img={r.artworkUrl} size={64} font={18} weight={500} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="card-title clamp-2" style={{ fontSize: 14 }}>{r.title}</span>
                    <span className="clamp-2" style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', lineHeight: 1.4 }}>{r.blurb}</span>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
                      <span className="card-meta" style={{ margin: 0, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.genre}</span>
                      <button className="btn btn-primary" disabled={working} onClick={() => void toggle(r)}
                        style={{ fontSize: 11.5, padding: '3px 10px', minHeight: 0, flex: 'none', color: on ? 'var(--color-neutral-400)' : 'var(--color-accent)', borderColor: on ? 'var(--color-divider)' : 'var(--color-accent)' }}>
                        {working ? <i className="ph ph-circle-notch spin" /> : on ? 'Subscribed' : 'Subscribe'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {!load.results.length && <Empty icon="ph ph-magnifying-glass" text="No podcasts match. Try another search, or paste a feed URL." />}
        </>
      )}
    </div>
  );
}
