import { art, chaptersFor, fmt, mono, transcriptFor } from '../data';
import { currentChapter, epInfo, sleepLabel, trimOn, useStore } from '../store';
import { GhostIcon, sectionLabel } from './ui';

function useNowPlaying() {
  const s = useStore();
  const cur = epInfo(s, s.cur);
  if (!cur) return null;
  const ch = chaptersFor(cur);
  const ci = currentChapter(ch, s.pos);
  const tr = transcriptFor(cur);
  let lines: { who: string; text: string; at: number; current: boolean }[] = [];
  if (tr) {
    const ti = Math.max(0, tr.reduce((a, l, i) => (l.at <= s.pos ? i : a), 0));
    const from = Math.max(0, Math.min(ti - 1, tr.length - 3));
    lines = tr.slice(from, from + 3).map((l) => ({ ...l, current: l === tr[ti] }));
  }
  return { s, cur, ch, ci, lines, hasTranscript: !!tr };
}

function Chapters({ big }: { big?: boolean }) {
  const np = useNowPlaying();
  if (!np) return null;
  const { s, ch, ci } = np;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: big ? 8 : 6 }}>
        <span style={sectionLabel}>Chapters</span>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{ci + 1} of {ch.length}</span>
      </div>
      {ch.map((c, i) => (
        <button key={c.t} className="h-n900" onClick={() => s.seek(c.at + 0.01)}
          style={{ display: 'flex', gap: big ? 14 : 10, alignItems: 'center', padding: big ? '9px 10px' : '6px 8px', margin: big ? '0 -10px' : '0 -8px', border: 'none', borderRadius: big ? 'var(--radius-md)' : 6, background: i === ci ? 'color-mix(in srgb,var(--color-accent-800) 60%,transparent)' : 'transparent', color: i === ci ? 'var(--color-accent-100)' : i < ci ? 'var(--color-neutral-500)' : 'var(--color-neutral-200)', fontSize: big ? 14 : 12.5, textAlign: 'left', cursor: 'pointer' }}>
          <span style={{ width: big ? 52 : 40, fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-500)', fontSize: big ? 12.5 : 11.5 }}>{fmt(c.at)}</span>
          <span style={{ flex: 1 }}>{c.t}</span>
          {i === ci && <i className="ph-fill ph-speaker-high" style={{ color: 'var(--color-accent)', fontSize: big ? 14 : 13 }} />}
        </button>
      ))}
    </div>
  );
}

function Transcript({ big }: { big?: boolean }) {
  const np = useNowPlaying();
  if (!np) return null;
  const { s, lines, hasTranscript } = np;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: big ? 12 : 8, maxWidth: big ? 620 : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={sectionLabel}>Transcript</span>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{hasTranscript ? (big ? 'From feed · follows playback' : 'From feed') : 'Not available'}</span>
      </div>
      {lines.map((l) => (
        <p key={l.at} onClick={() => s.seek(l.at)} title={`Jump to ${fmt(l.at)}`}
          style={{ margin: 0, fontSize: big ? 17 : 13, lineHeight: big ? 1.55 : 1.5, color: l.current ? 'var(--color-text)' : 'var(--color-neutral-500)', textWrap: 'pretty', cursor: 'pointer', transition: 'color .3s' } as React.CSSProperties}>
          <span style={{ fontSize: big ? 12 : 11, color: 'var(--color-neutral-500)', marginRight: big ? 8 : 6 }}>{l.who}</span>{l.text}
        </p>
      ))}
      {!hasTranscript && <p style={{ margin: 0, fontSize: big ? 14 : 12.5, color: 'var(--color-neutral-500)' }}>This episode’s feed doesn’t include a transcript.</p>}
    </div>
  );
}

export function NowPlayingPanel() {
  const np = useNowPlaying();
  if (!np) return null;
  const { s, cur } = np;
  return (
    <aside aria-label="Now playing" style={{ width: 340, flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', padding: 'var(--space-6)', overflow: 'auto', background: 'linear-gradient(180deg,color-mix(in srgb,var(--color-accent-900) 70%,var(--color-bg)),var(--color-bg) 60%)', boxShadow: '-1px 0 0 var(--color-neutral-900)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="card-kicker">Now playing</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <GhostIcon icon="ph ph-arrows-out-simple" title="Expand" size={28} iconSize={14} color="var(--color-text)" onClick={() => s.set({ npFull: true })} />
          <GhostIcon icon="ph ph-x" title="Close" size={28} iconSize={14} color="var(--color-text)" onClick={() => s.set({ npOpen: false })} />
        </div>
      </div>
      <button onClick={() => s.openShow(cur.show.id)} title={`Open ${cur.show.title}`}
        style={{ width: '100%', aspectRatio: '1', flex: 'none', border: 'none', padding: 0, cursor: 'pointer', borderRadius: 'var(--radius-lg)', background: art(cur.show.hue), display: 'grid', placeItems: 'center', fontSize: 72, fontWeight: 500, letterSpacing: '-0.03em', color: 'var(--color-neutral-100)', boxShadow: 'var(--shadow-md)' }}>
        {mono(cur.show.title)}
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.25 }}>{cur.title}</span>
        <span style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{cur.show.title} · {cur.date}</span>
      </div>
      <Chapters />
      <Transcript />
    </aside>
  );
}

export function NowPlayingFull() {
  const np = useNowPlaying();
  if (!np) return null;
  const { s, cur } = np;
  const trim = trimOn(s, cur.show.id);
  return (
    <div role="dialog" aria-label="Now playing" style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'grid', gridTemplateColumns: 'minmax(0,420px) minmax(0,1fr)', gap: 56, padding: '44px 56px', overflow: 'auto', background: 'radial-gradient(120% 90% at 15% 20%,color-mix(in srgb,var(--color-accent-900) 85%,var(--color-bg)),var(--color-bg) 70%)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="card-kicker">Now playing</span>
          <button className="btn btn-secondary" onClick={() => s.set({ npFull: false })} style={{ fontSize: 12, padding: '4px 10px', minHeight: 0 }}>
            <i className="ph ph-arrows-in-simple" style={{ fontSize: 13 }} />Collapse
          </button>
        </div>
        <div style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--radius-lg)', background: art(cur.show.hue), display: 'grid', placeItems: 'center', fontSize: 120, fontWeight: 500, letterSpacing: '-0.04em', color: 'var(--color-neutral-100)', boxShadow: 'var(--shadow-md),0 0 80px color-mix(in srgb,var(--color-accent) 18%,transparent)' }}>{mono(cur.show.title)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{cur.title}</span>
          <span style={{ fontSize: 14, color: 'var(--color-neutral-400)' }}>{cur.show.title} · {cur.date}</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span className="tag tag-accent">{s.speed}× speed</span>
          <span className="tag tag-neutral">{trim ? `Silence trim on · saved ${fmt(s.trimSaved)}` : 'Silence trim off'}</span>
          <span className="tag tag-neutral">Sleep: {sleepLabel(s.sleep).toLowerCase()}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', minWidth: 0, paddingTop: 34 }}>
        <Chapters big />
        <Transcript big />
      </div>
    </div>
  );
}
