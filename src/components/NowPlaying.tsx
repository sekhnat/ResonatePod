import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { art, fmt, lastAtOrBefore, mono, type EpisodeInfo } from '../data';
import { currentChapter, epInfo, sleepLabel, trimOn, useStore } from '../store';
import { useChapters, useCurrent } from '../current';
import { usePlayhead } from '../playhead';
import { attachVideo, detachVideo } from '../audio/engine';
import { Art, GhostIcon } from './ui';

/** What the transcript shows for the playing episode: three lines around the current one, or all of an untimed one. */
function useTranscript(cur: EpisodeInfo | null) {
  const meta = useStore((s) => (cur ? s.meta[cur.key] : undefined));
  const tr = meta?.transcript ?? null;
  const timed = meta?.transcriptTimed !== false;
  // The line playback is at: a number that changes every few seconds, so this redraws then rather than on every update.
  const ti = usePlayhead((p) => (tr && timed ? lastAtOrBefore(tr, p, (l) => l.at) : 0));
  const loading = !!cur?.ep.transcriptUrl && meta?.transcript === undefined;
  let lines: { who: string; text: string; at: number; current: boolean }[] = [];
  if (tr && !timed) {
    lines = tr.map((l) => ({ ...l, current: true }));
  } else if (tr) {
    const from = Math.max(0, Math.min(ti - 1, tr.length - 3));
    lines = tr.slice(from, from + 3).map((l) => ({ ...l, current: l === tr[ti] }));
  }
  return { lines, timed, hasTranscript: !!tr, loading };
}

function Chapters({ big }: { big?: boolean }) {
  const cur = useCurrent();
  const ch = useChapters();
  const ci = usePlayhead((p) => currentChapter(ch, p)); // the chapter number, so the list redraws when the chapter changes
  const seek = useStore((s) => s.seek);
  if (!cur) return null;
  return (
    <div className={`chapters${big ? ' big' : ''}`}>
      <div className="chapters-head">
        <span className="section-label">Chapters</span>
        <span className="chapters-count">{ci + 1} of {ch.length}</span>
      </div>
      {ch.map((c, i) => (
        <button key={`${c.at}-${c.t}`} className={`h-n900 chapter${i === ci ? ' cur' : i < ci ? ' past' : ''}`} onClick={() => seek(c.at + 0.01)}>
          <span className="chapter-time">{fmt(c.at)}</span>
          <span className="chapter-title">{c.t}</span>
          {i === ci && <i className="ph-fill ph-speaker-high chapter-now" />}
        </button>
      ))}
    </div>
  );
}

function Transcript({ big }: { big?: boolean }) {
  const cur = useCurrent();
  const { lines: all, hasTranscript, loading, timed } = useTranscript(cur);
  const { seek, set } = useStore(useShallow((s) => ({ seek: s.seek, set: s.set })));
  if (!cur) return null;
  // Untimed (HTML or plain-text) transcripts can't follow playback: the panel shows
  // the opening paragraphs, the full view all of them.
  const lines = timed ? all : big ? all : all.slice(0, 3);
  const label = hasTranscript ? (timed ? (big ? 'From feed · follows playback' : 'From feed') : 'From feed · not synced to playback') : loading ? 'Loading…' : 'Not available';
  return (
    <div className={`transcript${big ? ' big' : ''}`}>
      <div className="transcript-head">
        <span className="section-label">Transcript</span>
        <span className="transcript-label">{label}</span>
      </div>
      {lines.map((l, i) => (
        <p key={`${l.at}-${i}`} className={`tline${big ? ' big' : ''}${timed ? ' timed' : ''}${l.current ? ' cur' : ''}`} onClick={timed ? () => seek(l.at) : undefined} title={timed ? `Jump to ${fmt(l.at)}` : undefined}>
          {l.who && <span className="tline-who">{l.who}</span>}{l.text}
        </p>
      ))}
      {!timed && !big && all.length > 3 && (
        <button className="btn btn-ghost transcript-more" onClick={() => set({ npFull: true })}>Read the full transcript</button>
      )}
      {!hasTranscript && !loading && <p className="transcript-none">This episode’s feed doesn’t include a transcript.</p>}
    </div>
  );
}

/** Shows the playing episode's picture by borrowing the engine's media element. */
function VideoView({ glow }: { glow?: boolean }) {
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
    <div ref={ref} className={`video-view${glow ? ' glow' : ''}`} onDoubleClick={fullscreen} title="Double-click for full screen" />
  );
}

export function NowPlayingPanel() {
  const cur = useCurrent();
  const s = useStore(useShallow((s) => ({ video: s.video, npFull: s.npFull, set: s.set, openShow: s.openShow })));
  if (!cur) return null;
  const img = cur.ep.imageUrl ?? cur.show.imageUrl;
  return (
    <aside aria-label="Now playing" className="np-panel">
      <div className="np-head">
        <span className="card-kicker">Now playing</span>
        <div className="np-head-actions">
          <GhostIcon icon="ph ph-arrows-out-simple" title="Expand" size={28} iconSize={14} color="var(--color-text)" onClick={() => s.set({ npFull: true })} />
          <GhostIcon icon="ph ph-x" title="Close" size={28} iconSize={14} color="var(--color-text)" onClick={() => s.set({ npOpen: false })} />
        </div>
      </div>
      {s.video && !s.npFull ? <VideoView /> : (
        <button className="np-cover-btn" onClick={() => s.openShow(cur.show.id)} title={`Open ${cur.show.title}`}>
          <Art bg={art(cur.show.hue)} mono={mono(cur.show.title)} img={img} size="100%" font={72} weight={500} radius="var(--radius-lg)" className="np-cover" style={{ height: 'auto' }} />
        </button>
      )}
      <div className="np-meta">
        <span className="np-title">{cur.title}</span>
        <span className="np-sub">{cur.show.title} · {cur.date}</span>
      </div>
      <Chapters />
      <Transcript />
    </aside>
  );
}

export function NowPlayingFull() {
  const cur = useCurrent();
  const s = useStore(useShallow((s) => {
    const info = epInfo(s, s.cur);
    return { video: s.video, speed: s.speed, saved: s.trimSaved + s.trimPending, sleep: s.sleep, trim: !!info && trimOn(s, info.show.id), set: s.set };
  }));
  if (!cur) return null;
  const img = cur.ep.imageUrl ?? cur.show.imageUrl;
  const { trim } = s;
  return (
    <div role="dialog" aria-label="Now playing" className="np-full">
      <div className="np-full-left">
        <div className="np-head">
          <span className="card-kicker">Now playing</span>
          <button className="btn btn-secondary np-collapse" onClick={() => s.set({ npFull: false })}>
            <i className="ph ph-arrows-in-simple np-collapse-icon" />Collapse
          </button>
        </div>
        {s.video ? <VideoView glow /> : (
          <Art bg={art(cur.show.hue)} mono={mono(cur.show.title)} img={img} size="100%" font={120} weight={500} radius="var(--radius-lg)" className="np-cover big" style={{ height: 'auto' }} />
        )}
        <div className="np-full-meta">
          <span className="np-full-title">{cur.title}</span>
          <span className="np-full-sub">{cur.show.title} · {cur.date}</span>
        </div>
        <div className="np-full-tags">
          <span className="tag tag-accent">{s.speed}× speed</span>
          <span className="tag tag-neutral">{trim ? `Silence trim on · saved ${fmt(s.saved)}` : 'Silence trim off'}</span>
          <span className="tag tag-neutral">Sleep: {sleepLabel(s.sleep).toLowerCase()}</span>
        </div>
      </div>
      <div className="np-full-right">
        <Chapters big />
        <Transcript big />
      </div>
    </div>
  );
}
