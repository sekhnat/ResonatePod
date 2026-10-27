import { useState } from 'react';
import { art, epKey, mono } from '../data';
import { epInfo, sortFor, useStore } from '../store';
import { applyFilter, applySort, ruleLabel, rowsFor, unplayedFor, type EpisodeRow } from '../model';
import { Art, GhostIcon, RowMeta, RowPlay, Seg, SortSelect, useRowProgress } from '../components/ui';

const FILTERS = ['All', 'Unplayed', 'Downloaded'] as const;

export function ShowScreen() {
  const s = useStore();
  const [limit, setLimit] = useState(50);
  const sh = s.shows.find((x) => x.id === s.showId);
  if (!sh) return null;
  const all = applySort(applyFilter(rowsFor(s, sh.eps.map((e) => epKey(sh.id, e.guid))), s.filter), sortFor(s, sh.id));
  const rows = all.slice(0, limit);
  const unplayed = unplayedFor(s, sh.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-8)', alignItems: 'flex-end' }}>
        <Art bg={art(sh.hue)} mono={mono(sh.title)} img={sh.imageUrl} size={148} font={44} weight={500} radius="var(--radius-lg)" style={{ letterSpacing: '-0.02em', boxShadow: 'var(--shadow-md)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
          <span className="card-kicker">{sh.cat} · {sh.freq}</span>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{sh.title}</h1>
          <span style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>
            {sh.author}
            {sh.link && <>{sh.author && ' · '}<a href={sh.link} target="_blank" rel="noreferrer" style={{ color: 'var(--color-neutral-400)' }}>Website</a></>}
          </span>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginTop: 4 }}>
            <button className="btn btn-primary" disabled={!sh.eps.length} onClick={() => s.play(epKey(sh.id, sh.eps[0].guid))}>
              <i className="ph-fill ph-play" style={{ fontSize: 13 }} />Play latest
            </button>
            <button className="btn btn-secondary" title="Unsubscribe…" onClick={() => s.set({ dialog: 'unsubscribe' })}>
              <i className="ph ph-check" style={{ fontSize: 14 }} />Subscribed
            </button>
            <span className="tag tag-neutral" style={{ gap: 5, whiteSpace: 'nowrap' }}><i className="ph ph-download-simple" />{ruleLabel(s, sh.id)}</span>
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
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <SortSelect value={sortFor(s, sh.id)} onPick={(v) => s.setSort(sh.id, v)} />
            <Seg options={FILTERS} value={s.filter} onPick={(filter) => s.set({ filter })} />
          </div>
        </div>
        {rows.map((e) => <ShowEpisodeRow key={e.key} e={e} />)}
        {all.length > limit && (
          <button className="btn btn-secondary" style={{ alignSelf: 'center', fontSize: 12, marginTop: 'var(--space-4)' }} onClick={() => setLimit((l) => l + 100)}>
            Show more ({all.length - limit} more)
          </button>
        )}
        {!sh.eps.length && <Empty icon="ph ph-rss" text="This feed has no episodes yet. They'll appear after the next refresh." />}
        {!!sh.eps.length && !rows.length && <Empty icon="ph ph-funnel" text={`No ${s.filter.toLowerCase()} episodes in this show.`} />}
      </div>
    </div>
  );
}

function ShowEpisodeRow({ e }: { e: EpisodeRow }) {
  const s = useStore();
  const progress = useRowProgress(e);
  const [open, setOpen] = useState(false);
  const notes = open ? epInfo(s, e.key)?.ep.description : '';
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
          <span onClick={() => setOpen((o) => !o)} title={open ? 'Hide show notes' : 'Show notes'} style={{ fontSize: 14, fontWeight: 500, color: titleColor(e), whiteSpace: open ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>{e.title}</span>
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}><RowMeta e={e} /></span>
        {open && <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.55, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', maxHeight: 260, overflow: 'auto' }}>{notes || 'No show notes for this episode.'}</p>}
      </div>
      <div className="row-actions" style={{ display: 'flex' }}>
        <GhostIcon icon={e.played ? 'ph ph-arrow-u-up-left' : 'ph ph-checks'} title={e.played ? 'Mark unplayed' : 'Mark played'} onClick={() => s.markPlayed(e.key, !e.played)} />
        <GhostIcon icon="ph ph-queue" title="Add to queue" onClick={() => s.addToQueue(e.key)} />
      </div>
      {progress > 0 && progress < 1 && (
        <div style={{ width: 64, height: 3, borderRadius: 2, background: 'var(--color-neutral-800)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'var(--color-accent-500)' }} />
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
