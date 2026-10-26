import { art, epKey, mono } from '../data';
import { useStore } from '../store';
import { applyFilter, ruleLabel, rowsFor, unplayedFor, type EpisodeRow } from '../model';
import { GhostIcon, RowPlay, Seg } from '../components/ui';

const FILTERS = ['All', 'Unplayed', 'Downloaded'] as const;

export function ShowScreen() {
  const s = useStore();
  const sh = s.shows.find((x) => x.id === s.showId);
  if (!sh) return null;
  const rows = applyFilter(rowsFor(s, sh.eps.map((_, i) => epKey(sh.id, i))), s.filter);
  const unplayed = unplayedFor(s, sh.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', maxWidth: 760 }}>
      <div style={{ display: 'flex', gap: 'var(--space-8)', alignItems: 'flex-end' }}>
        <div style={{ width: 148, height: 148, flex: 'none', borderRadius: 'var(--radius-lg)', background: art(sh.hue), display: 'grid', placeItems: 'center', fontSize: 44, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--color-neutral-100)', boxShadow: 'var(--shadow-md)' }}>{mono(sh.title)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
          <span className="card-kicker">{sh.cat} · {sh.freq}</span>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{sh.title}</h1>
          <span style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>{sh.author}</span>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={!sh.eps.length} onClick={() => s.play(epKey(sh.id, 0))}>
              <i className="ph-fill ph-play" style={{ fontSize: 13 }} />Play latest
            </button>
            <button className="btn btn-secondary" title="Unsubscribe…" onClick={() => s.set({ dialog: 'unsubscribe' })}>
              <i className="ph ph-check" style={{ fontSize: 14 }} />Subscribed
            </button>
            <span className="tag tag-neutral" style={{ gap: 5 }}><i className="ph ph-download-simple" />{ruleLabel(s, sh.id)}</span>
            <button className="btn btn-icon btn-secondary" onClick={() => s.set({ cfgOpen: true })} title="Show settings" aria-label="Show settings" style={{ width: 34, height: 34 }}>
              <i className="ph ph-sliders-horizontal" style={{ fontSize: 15 }} />
            </button>
          </div>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--color-neutral-300)', maxWidth: 620, textWrap: 'pretty' } as React.CSSProperties}>{sh.desc}</p>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 'var(--space-3)' }}>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{sh.eps.length} episodes · {unplayed} unplayed</span>
          <Seg options={FILTERS} value={s.filter} onPick={(filter) => s.set({ filter })} />
        </div>
        {rows.map((e) => <ShowEpisodeRow key={e.key} e={e} />)}
        {!sh.eps.length && <Empty icon="ph ph-rss" text="No episodes yet. They'll appear after the next feed refresh." />}
        {!!sh.eps.length && !rows.length && <Empty icon="ph ph-funnel" text={`No ${s.filter.toLowerCase()} episodes in this show.`} />}
      </div>
    </div>
  );
}

function ShowEpisodeRow({ e }: { e: EpisodeRow }) {
  const s = useStore();
  const dlIcon = e.downloading ? 'ph ph-x' : e.downloaded ? 'ph ph-trash' : 'ph ph-download-simple';
  const dlLabel = e.downloading ? 'Cancel download' : e.downloaded ? 'Delete file' : 'Download';
  const onDl = () => (e.downloading ? s.cancelDownload(e.key) : e.downloaded ? s.deleteFile(e.key) : s.startDownload(e.key));
  return (
    <div className="h-row" onDoubleClick={() => s.play(e.key)}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '10px 10px', margin: '0 -10px', borderRadius: 'var(--radius-md)', background: e.isCur ? 'color-mix(in srgb,var(--color-accent-900) 70%,transparent)' : 'transparent' }}>
      <i className={e.status === 'downloading' ? `${e.stIcon} spin` : e.stIcon} title={e.stLabel} style={{ fontSize: 18, width: 20, color: e.stColor }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {e.isNew && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent)', flex: 'none' }} />}
          <span style={{ fontSize: 14, fontWeight: 500, color: titleColor(e), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{e.meta}</span>
      </div>
      <div className="row-actions" style={{ display: 'flex' }}>
        <GhostIcon icon={e.played ? 'ph ph-arrow-u-up-left' : 'ph ph-checks'} title={e.played ? 'Mark unplayed' : 'Mark played'} onClick={() => s.markPlayed(e.key, !e.played)} />
        <GhostIcon icon="ph ph-queue" title="Add to queue" onClick={() => s.addToQueue(e.key)} />
      </div>
      {e.progress > 0 && e.progress < 1 && (
        <div style={{ width: 64, height: 3, borderRadius: 2, background: 'var(--color-neutral-800)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.round(e.progress * 100)}%`, background: 'var(--color-accent-500)' }} />
        </div>
      )}
      <GhostIcon icon={dlIcon} title={dlLabel} onClick={onDl} />
      <RowPlay isCur={e.isCur} isPlaying={e.isPlaying} onClick={() => s.play(e.key)} />
    </div>
  );
}

export const titleColor = (e: EpisodeRow) => (e.played ? 'var(--color-neutral-500)' : e.isCur ? 'var(--color-accent-200)' : 'var(--color-text)');

export function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0', fontSize: 13, color: 'var(--color-neutral-500)' }}>
      <i className={icon} style={{ fontSize: 18 }} />{text}
    </div>
  );
}
