import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CATS } from '../data';
import { useStore } from '../store';
import { isFeedUrl } from '../lib/opml';
import { SOURCES, appleId, browse, countryName, normalizeFeedUrl, searchDirectories, type DirectoryResult, type SearchOutcome, type Source } from '../lib/directory';
import { CountrySelect, DirectoryCard, SourceSelect, useSuggestions } from '../components/DirectoryCard';
import { Empty } from './ShowScreen';

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: T };

export function DiscoverScreen() {
  const s = useStore(useShallow((s) => ({ addFeed: s.addFeed, cat: s.cat, directory: s.directory, discoverQuery: s.discoverQuery, openShow: s.openShow, set: s.set, toast: s.toast })));
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const q = s.discoverQuery.trim();
  const isUrl = isFeedUrl(q);
  const { country, source } = s.directory;
  const sug = useSuggestions(6);

  const addByUrl = async () => {
    if (!isUrl) {
      input.current?.focus();
      s.toast('Paste an RSS feed or Apple Podcasts link into the search field first');
      return;
    }
    setBusy(true);
    const id = await s.addFeed(q);
    setBusy(false);
    if (id) { s.set({ discoverQuery: '' }); s.openShow(id); }
  };

  return (
    <div className="page">
      <h1 className="page-title">Discover</h1>
      <div className="dsc-search">
        <div className="dsc-input-wrap">
          <i className="ph ph-magnifying-glass dsc-input-icon" />
          <input ref={input} className="input dsc-input" placeholder="Search podcasts, or paste an RSS feed URL" autoFocus
            value={s.discoverQuery} onChange={(e) => s.set({ discoverQuery: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && isUrl) void addByUrl(); }} />
        </div>
        <button className="btn btn-secondary btn-12" disabled={busy && isUrl} onClick={() => void addByUrl()}>
          <i className={`${busy && isUrl ? 'ph ph-circle-notch spin' : 'ph ph-rss'} ico-14`} />Add by URL
        </button>
      </div>
      <div className="dsc-filters">
        <div className="dsc-cats">
        {CATS.map((c) => {
          const on = s.cat === c;
          return (
            <span key={c} className="seg-opt cat-chip" role="button" tabIndex={0} aria-pressed={on} onClick={() => s.set({ cat: c })}
              onKeyDown={(e) => { if (e.key === 'Enter') s.set({ cat: c }); }}>{c}</span>
          );
        })}
        </div>
        <div className="dsc-selects">
          <SourceSelect look="pill" />
          <CountrySelect look="pill" />
        </div>
      </div>
      {isUrl ? (
        <div className="dsc-hint">
          {appleId(q) ? 'That’s an Apple Podcasts link — Resonate will look up the show’s feed.' : 'That looks like a feed URL.'} Press Enter or{' '}
          <button className="btn btn-ghost dsc-hint-btn" onClick={() => void addByUrl()}>Add by URL</button> to subscribe.
        </div>
      ) : q ? (
        <SearchResults q={q} />
      ) : (
        <>
          {s.cat === 'Popular' && <SuggestedRow sug={sug} />}
          <BrowseGrid key={`${country}|${source}|${s.cat}`} skip={s.cat === 'Popular' && sug.state === 'ok' ? sug.results : []} />
        </>
      )}
    </div>
  );
}

function ErrorRow({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="dsc-error">
      <i className="ph ph-wifi-slash ico-18" />{message}
      <button className="btn btn-secondary btn-12" onClick={retry}>Try again</button>
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="section-head">
      <span className="section-label">{title}</span>
      {sub && <span className="section-sub">{sub}</span>}
    </div>
  );
}

function SuggestedRow({ sug }: { sug: ReturnType<typeof useSuggestions> }) {
  if (sug.state === 'ok' && !sug.results.length) return null;
  return (
    <section aria-label="Suggested for you" className="dsc-section">
      <SectionHead title="Suggested for you" sub={sug.state === 'ok' ? sug.sources.join(' · ') : undefined} />
      {sug.state === 'loading' && <Empty icon="ph ph-circle-notch spin" text="Finding suggestions…" />}
      {sug.state === 'error' && <ErrorRow message={sug.message} retry={sug.retry} />}
      {sug.state === 'ok' && <div className="result-grid">{sug.results.map((r) => <DirectoryCard key={r.id} r={r} />)}</div>}
    </section>
  );
}

/** The chart for the region (or gpodder.net's top list), minus shows already suggested above it. */
function BrowseGrid({ skip }: { skip: DirectoryResult[] }) {
  const s = useStore(useShallow((s) => ({ cat: s.cat, directory: s.directory })));
  const { country, source } = s.directory;
  const [load, setLoad] = useState<Load<DirectoryResult[]>>({ state: 'loading' });
  const [retry, setRetry] = useState(0);
  const genre = s.cat === 'Popular' ? undefined : s.cat;
  // fyyd and Podcast Index have no charts; browsing shows Apple's for them.
  const fromGpodder = source === 'gpodder';
  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    browse({ country, source, genre })
      .then((data) => { if (live) setLoad({ state: 'ok', data }); })
      .catch((err: Error) => { if (live) setLoad({ state: 'error', message: err.message }); });
    return () => { live = false; };
    // The grid is remounted (see its key) when the region, source or category changes, so only a retry reruns this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);
  const shown = load.state === 'ok' ? load.data.filter((r) => !skip.some((x) => normalizeFeedUrl(x.feedUrl) === normalizeFeedUrl(r.feedUrl))) : [];
  // Everything in the chart is already suggested above.
  if (load.state === 'ok' && load.data.length && !shown.length) return null;
  const title = fromGpodder ? `Most subscribed on gpodder.net${genre ? ` · ${genre}` : ''}` : `Top ${genre ? `${genre} ` : ''}podcasts · ${countryName(country)}`;
  return (
    <section aria-label={title} className="dsc-section">
      <SectionHead title={title} sub={fromGpodder ? undefined : 'Apple Podcasts chart'} />
      {load.state === 'loading' && <Empty icon="ph ph-circle-notch spin" text="Loading popular shows…" />}
      {load.state === 'error' && <ErrorRow message={`Couldn’t reach ${fromGpodder ? 'gpodder.net' : 'Apple Podcasts'} (${load.message}).`} retry={() => setRetry((n) => n + 1)} />}
      {load.state === 'ok' && (load.data.length
        ? <div className="result-grid">{shown.map((r) => <DirectoryCard key={r.id} r={r} />)}</div>
        : <Empty icon="ph ph-magnifying-glass" text="Nothing in this category yet." />)}
    </section>
  );
}

function SearchResults({ q }: { q: string }) {
  const s = useStore(useShallow((s) => ({ cat: s.cat, directory: s.directory })));
  const { country, source } = s.directory;
  const [load, setLoad] = useState<Load<SearchOutcome>>({ state: 'loading' });
  const [retry, setRetry] = useState(0);
  const genre = s.cat === 'Popular' ? undefined : s.cat;
  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    const t = setTimeout(() => {
      searchDirectories(q, { country, source, genre })
        .then((data) => { if (live) setLoad({ state: 'ok', data }); })
        .catch((err: Error) => { if (live) setLoad({ state: 'error', message: err.message }); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [q, country, source, genre, retry]);

  if (load.state === 'loading') return <Empty icon="ph ph-circle-notch spin" text={`Searching for “${q}”…`} />;
  if (load.state === 'error') return <ErrorRow message={`Search failed (${load.message}).`} retry={() => setRetry((n) => n + 1)} />;
  const { results, episodes, answered, failed } = load.data;
  const names = (xs: Source[]) => xs.map((x) => SOURCES[x].label).join(', ');
  const down = failed.map((f) => f.source);
  if (!answered.length) return <ErrorRow message={`Couldn’t reach ${names(down)} (${failed[0]?.message ?? 'no answer'}).`} retry={() => setRetry((n) => n + 1)} />;
  return (
    <>
      <section aria-label="Shows" className="dsc-section">
        <SectionHead title="Shows" sub={`${results.length} from ${names(answered)}${down.length ? ` · ${names(down)} didn’t answer` : ''}`} />
        {results.length
          ? <div className="result-grid">{results.map((r) => <DirectoryCard key={r.id} r={r} showSources={source === 'all'} />)}</div>
          : <Empty icon="ph ph-magnifying-glass" text="No podcasts match. Try another search, or paste a feed URL." />}
      </section>
      {episodes.length > 0 && (
        <section aria-label="Episodes" className="dsc-section">
          <SectionHead title="Episodes" sub="Apple Podcasts" />
          <div className="result-grid">{episodes.map((r) => <DirectoryCard key={r.id} r={r} />)}</div>
        </section>
      )}
    </>
  );
}
