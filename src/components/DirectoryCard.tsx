import { useEffect, useState, type CSSProperties } from 'react';
import { art, dateLabel, hueFor, mono } from '../data';
import { useStore } from '../store';
import {
  COUNTRIES, SOURCES, countryName, normalizeFeedUrl, suggestions, type DirectoryResult, type Source, type SourceChoice, type Suggestions,
} from '../lib/directory';
import { Art } from './ui';

const n = (x: number) => x.toLocaleString('en-US');

/** The show a directory result points at, if already subscribed. */
export function useSubscribedId() {
  const shows = useStore((s) => s.shows);
  const byUrl = new Map(shows.map((x) => [normalizeFeedUrl(x.feedUrl), x.id]));
  return (feedUrl: string) => byUrl.get(normalizeFeedUrl(feedUrl));
}

export function DirectoryCard({ r, showSources }: { r: DirectoryResult; showSources?: boolean }) {
  const s = useStore();
  const subscribedId = useSubscribedId()(r.feedUrl);
  const [busy, setBusy] = useState(false);
  const meta = [r.genre !== 'Podcast' && r.genre !== 'Episode' ? r.genre : '', r.subscribers ? `${n(r.subscribers)} subscribers` : r.episodeCount ? `${n(r.episodeCount)} episodes` : '']
    .filter(Boolean).join(' · ') || r.author;
  const act = async () => {
    if (r.episode) {
      // Episode results open their show (subscribing first when needed).
      const id = subscribedId ?? (setBusy(true), await s.addFeed(r.feedUrl));
      setBusy(false);
      if (id) s.openShow(id);
      return;
    }
    if (subscribedId) { s.unsubscribe(subscribedId); return; }
    setBusy(true);
    await s.addFeed(r.feedUrl);
    setBusy(false);
  };
  const on = !!subscribedId && !r.episode;
  const label = r.episode ? 'Open show' : on ? 'Subscribed' : 'Subscribe';
  return (
    <div className="card" data-testid="directory-card" style={{ flexDirection: 'row', gap: 'var(--space-4)', padding: 'var(--space-4)', alignItems: 'flex-start' }}>
      <Art bg={art(hueFor(r.title))} mono={mono(r.title)} img={r.artworkUrl} size={64} font={18} weight={500} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="card-title clamp-2" style={{ fontSize: 14 }}>{r.title}</span>
        {r.episode ? (
          <span className="clamp-2" style={{ fontSize: 11.5, color: 'var(--color-neutral-300)', lineHeight: 1.4 }}>
            <i className="ph ph-microphone" style={{ marginRight: 4 }} />{r.episode.title}{r.episode.date ? ` · ${dateLabel(r.episode.date)}` : ''}
          </span>
        ) : (
          <span className="clamp-2" style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', lineHeight: 1.4 }}>{r.blurb || r.author}</span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
          <span className="card-meta" style={{ margin: 0, minWidth: 0, display: 'flex', gap: 4, alignItems: 'center', overflow: 'hidden' }}>
            {showSources && r.sources.map((src) => <SourceTag key={src} source={src} />)}
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</span>
          </span>
          <button className="btn btn-primary" disabled={busy} onClick={() => void act()} aria-label={`${label}: ${r.title}`}
            style={{ fontSize: 11.5, padding: '3px 10px', minHeight: 0, flex: 'none', color: on ? 'var(--color-neutral-400)' : 'var(--color-accent)', borderColor: on ? 'var(--color-divider)' : 'var(--color-accent)' }}>
            {busy ? <i className="ph ph-circle-notch spin" /> : label}
          </button>
        </div>
      </div>
    </div>
  );
}

function SourceTag({ source }: { source: Source }) {
  return (
    <span title={`Found on ${SOURCES[source].label}`} style={{ flex: 'none', fontSize: 9.5, letterSpacing: '0.04em', padding: '1px 5px', borderRadius: 4, background: 'var(--color-neutral-800)', color: 'var(--color-neutral-300)' }}>
      {SOURCES[source].short}
    </span>
  );
}

export const resultGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 'var(--space-4)' };

const selectStyle: CSSProperties = { width: 'auto', fontSize: 12.5, minHeight: 36, paddingRight: 6, cursor: 'pointer' };

export function CountrySelect({ style }: { style?: CSSProperties }) {
  const country = useStore((s) => s.directory.country);
  const setDirectory = useStore((s) => s.setDirectory);
  const options = COUNTRIES.map((cc) => ({ cc, name: countryName(cc) })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select className="input" aria-label="Region" title="Region for charts and search" value={country} style={{ ...selectStyle, ...style }}
      onChange={(e) => setDirectory({ country: e.target.value })}>
      {options.map((o) => <option key={o.cc} value={o.cc}>{o.name}</option>)}
    </select>
  );
}

export function SourceSelect({ style }: { style?: CSSProperties }) {
  const { source, podcastIndex } = useStore((s) => s.directory);
  const setDirectory = useStore((s) => s.setDirectory);
  const options: [SourceChoice, string][] = [
    ['all', 'All directories'],
    ...(['apple', 'gpodder', 'fyyd', 'podcastindex'] as Source[]).filter((x) => x !== 'podcastindex' || podcastIndex).map((x) => [x, SOURCES[x].label] as [SourceChoice, string]),
  ];
  return (
    <select className="input" aria-label="Directory" title="Which directory to search" value={source} style={{ ...selectStyle, ...style }}
      onChange={(e) => setDirectory({ source: e.target.value as SourceChoice })}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

type SuggestionState = { state: 'loading' } | { state: 'error'; message: string } | ({ state: 'ok' } & Suggestions);

// Kept for the session so revisiting Discover doesn't refetch.
const cache = new Map<string, Suggestions>();

/** AntennaPod-style suggestions for the current region, minus shows already followed. */
export function useSuggestions(limit = 12): SuggestionState & { retry(): void } {
  const country = useStore((s) => s.directory.country);
  const syncServer = useStore((s) => s.sync.server);
  const gpodderSuggestions = useStore((s) => s.gpodderSuggestions);
  // Shows followed before this screen opened are left out; ones subscribed from the row stay, marked Subscribed.
  const [followed] = useState(() => new Set(useStore.getState().shows.map((x) => normalizeFeedUrl(x.feedUrl))));
  const key = `${country}|${syncServer}`;
  const [st, setSt] = useState<SuggestionState>(() => (cache.has(key) ? { state: 'ok', ...cache.get(key)! } : { state: 'loading' }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const hit = cache.get(key);
    if (hit) { setSt({ state: 'ok', ...hit }); return; }
    let live = true;
    setSt({ state: 'loading' });
    // Fetch a few extra so following some still leaves a full row.
    suggestions({ country, subscribed: useStore.getState().shows, personal: syncServer ? gpodderSuggestions : undefined, limit: limit + 12 })
      .then((r) => { cache.set(key, r); if (live) setSt({ state: 'ok', ...r }); })
      .catch((err: Error) => { if (live) setSt({ state: 'error', message: err.message }); });
    return () => { live = false; };
  }, [key, attempt]);
  const retry = () => { cache.delete(key); setAttempt((a) => a + 1); };
  if (st.state !== 'ok') return { ...st, retry };
  return { ...st, results: st.results.filter((r) => !followed.has(normalizeFeedUrl(r.feedUrl))).slice(0, limit), retry };
}
