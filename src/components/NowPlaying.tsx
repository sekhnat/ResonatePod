import { useEffect, useRef, type CSSProperties } from 'react';
import { art, fmt, mono } from '../data';
import { chaptersOf, currentChapter, epInfo, sleepLabel, trimOn, useStore } from '../store';
import { attachVideo, detachVideo } from '../audio/engine';
import { Art, GhostIcon, sectionLabel } from './ui';

function useNowPlaying() {
  const s = useStore();
  const cur = epInfo(s, s.cur);
  if (!cur) return null;
  const ch = chaptersOf(s, cur);
  const ci = currentChapter(ch, s.pos);
  const meta = s.meta[cur.key];
  const tr = meta?.transcript ?? null;
  const timed = meta?.transcriptTimed !== false;
  const loading = !!cur.ep.transcriptUrl && meta?.transcript === undefined;
  let lines: { who: string; text: string; at: number; current: boolean }[] = [];
  if (tr && !timed) {
    lines = tr.map((l) => ({ ...l, current: true }));
  } else if (tr) {
    const ti = Math.max(0, tr.reduce((a, l, i) => (l.at <= s.pos ? i : a), 0));
    const from = Math.max(0, Math.min(ti - 1, tr.length - 3));
    lines = tr.slice(from, from + 3).map((l) => ({ ...l, current: l === tr[ti] }));
  }
  return { s, cur, ch, ci, lines, timed, hasTranscript: !!tr, loading, img: cur.ep.imageUrl ?? cur.show.imageUrl };
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
        <button key={`${c.at}-${c.t}`} className="h-n900" onClick={() => s.seek(c.at + 0.01)}
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
  const { s, hasTranscript, loading, timed } = np;
  // Untimed (HTML or plain-text) transcripts can't follow playback: the panel shows
  // the opening paragraphs, the full view all of them.
  const lines = timed ? np.lines : big ? np.lines : np.lines.slice(0, 3);
  const label = hasTranscript ? (timed ? (big ? 'From feed · follows playback' : 'From feed') : 'From feed · not synced to playback') : loading ? 'Loading…' : 'Not available';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: big ? 12 : 8, maxWidth: big ? 620 : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={sectionLabel}>Transcript</span>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', textAlign: 'right' }}>{label}</span>
      </div>
      {lines.map((l, i) => (
        <p key={`${l.at}-${i}`} onClick={timed ? () => s.seek(l.at) : undefined} title={timed ? `Jump to ${fmt(l.at)}` : undefined}
          style={{ margin: 0, fontSize: big ? 17 : 13, lineHeight: big ? 1.55 : 1.5, color: l.current ? 'var(--color-text)' : 'var(--color-neutral-500)', textWrap: 'pretty', cursor: timed ? 'pointer' : 'auto', transition: 'color .3s' } as CSSProperties}>
          {l.who && <span style={{ fontSize: big ? 12 : 11, color: 'var(--color-neutral-500)', marginRight: big ? 8 : 6 }}>{l.who}</span>}{l.text}
        </p>
      ))}
      {!timed && !big && np.lines.length > 3 && (
        <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 12, padding: '2px 0' }} onClick={() => s.set({ npFull: true })}>Read the full transcript</button>
      )}
      {!hasTranscript && !loading && <p style={{ margin: 0, fontSize: big ? 14 : 12.5, color: 'var(--color-neutral-500)' }}>This episode’s feed doesn’t include a transcript.</p>}
    </div>
  );
}

/** Shows the playing episode's picture by borrowing the engine's media element. */
function VideoView({ style }: { style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    attachVideo(el);
    return () => detachVideo(el);
  }, []);
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen();
  };
  return (
    <div ref={ref} onDoubleClick={fullscreen} title="Double-click for full screen"
      style={{ width: '100%', aspectRatio: '16 / 9', flex: 'none', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: '#000', boxShadow: 'var(--shadow-md)', ...style }} />
  );
}

export function NowPlayingPanel() {
  const np = useNowPlaying();
  if (!np) return null;
  const { s, cur, img } = np;
  return (
    <aside aria-label="Now playing" style={{ width: 340, flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', padding: 'var(--space-6)', overflow: 'auto', background: 'linear-gradient(180deg,color-mix(in srgb,var(--color-accent-900) 70%,var(--color-bg)),var(--color-bg) 60%)', boxShadow: '-1px 0 0 var(--color-neutral-900)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="card-kicker">Now playing</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <GhostIcon icon="ph ph-arrows-out-simple" title="Expand" size={28} iconSize={14} color="var(--color-text)" onClick={() => s.set({ npFull: true })} />
          <GhostIcon icon="ph ph-x" title="Close" size={28} iconSize={14} color="var(--color-text)" onClick={() => s.set({ npOpen: false })} />
        </div>
      </div>
      {s.video && !s.npFull ? <VideoView /> : (
        <button onClick={() => s.openShow(cur.show.id)} title={`Open ${cur.show.title}`} style={{ width: '100%', flex: 'none', border: 'none', padding: 0, background: 'none', cursor: 'pointer' }}>
          <Art bg={art(cur.show.hue)} mono={mono(cur.show.title)} img={img} size="100%" font={72} weight={500} radius="var(--radius-lg)" style={{ aspectRatio: '1', height: 'auto', letterSpacing: '-0.03em', boxShadow: 'var(--shadow-md)' }} />
        </button>
      )}
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
  const { s, cur, img } = np;
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
        {s.video ? <VideoView style={{ boxShadow: 'var(--shadow-md),0 0 80px color-mix(in srgb,var(--color-accent) 18%,transparent)' }} /> : (
          <Art bg={art(cur.show.hue)} mono={mono(cur.show.title)} img={img} size="100%" font={120} weight={500} radius="var(--radius-lg)" style={{ aspectRatio: '1', height: 'auto', letterSpacing: '-0.04em', boxShadow: 'var(--shadow-md),0 0 80px color-mix(in srgb,var(--color-accent) 18%,transparent)' }} />
        )}
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
