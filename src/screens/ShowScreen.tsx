import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { art, epKey, mono, parseKey } from '../data';
import { findShow, getEp, sortFor, useStore } from '../store';
import { useNotes } from '../notes';
import { applyFilter, applySort, episodeRow, orderable, ruleLabel, unplayedFor, type EpisodeRow } from '../model';
import { Art, GhostIcon, RowMeta, RowPlay, RowProgress, Seg, SortSelect } from '../components/ui';
import { VirtualList } from '../components/VirtualList';

const FILTERS = ['All', 'Unplayed', 'Downloaded'] as const;

/** The page for the show that's open. Keyed by show, so what belongs to one show (an open row) can't carry over to the next. */
export function ShowScreen() {
  const showId = useStore((s) => s.showId);
  return <ShowPage key={showId} id={showId} />;
}

function ShowPage({ id }: { id: string }) {
  const s = useStore(useShallow((s) => ({
    sh: findShow(s, id), eps: s.eps, cur: s.cur, filter: s.filter, sort: sortFor(s, id), unplayed: unplayedFor(s, id), rule: ruleLabel(s, id),
    play: s.play, set: s.set, setSort: s.setSort,
  })));
  const { sh } = s;
  // The order of the list depends on the episodes, their played state, the playing one, the filter and the sort,
  // and on nothing else (not downloads, not the playback position), so it is built only when one of those changes.
  const { eps, cur, filter, sort } = s;
  const keys = useMemo(() => {
    if (!sh) return [];
    const items = sh.eps.map((e) => orderable(sh, e, getEp({ eps }, epKey(sh.id, e.guid)), cur));
    return applySort(applyFilter(items, filter), sort).map((r) => r.key);
  }, [sh, eps, cur, filter, sort]);
  if (!sh) return null;

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
            <span className="tag tag-neutral" style={{ gap: 5, whiteSpace: 'nowrap' }}><i className="ph ph-download-simple" />{s.rule}</span>
            <button className="btn btn-icon btn-secondary" onClick={() => s.set({ cfgOpen: true })} title="Show settings" aria-label="Show settings" style={{ width: 34, height: 34 }}>
              <i className="ph ph-sliders-horizontal" style={{ fontSize: 15 }} />
            </button>
          </div>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--color-neutral-300)', maxWidth: 620, textWrap: 'pretty' } as React.CSSProperties}>{sh.desc}</p>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 'var(--space-3)' }}>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{sh.eps.length} episodes · {s.unplayed} unplayed</span>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <SortSelect value={s.sort} onPick={(v) => s.setSort(sh.id, v)} />
            <Seg options={FILTERS} value={s.filter} onPick={(filter) => s.set({ filter })} />
          </div>
        </div>
        <VirtualList count={keys.length} estimate={62} itemKey={(i) => keys[i]}>
          {(i) => <ShowEpisodeRow id={keys[i]} />}
        </VirtualList>
        {!sh.eps.length && <Empty icon="ph ph-rss" text="This feed has no episodes yet. They'll appear after the next refresh." />}
        {!!sh.eps.length && !keys.length && <Empty icon="ph ph-funnel" text={`No ${s.filter.toLowerCase()} episodes in this show.`} />}
      </div>
    </div>
  );
}

/** One episode. It picks its own row out of the store, so a download's progress or a played flag redraws just this row. */
const ShowEpisodeRow = memo(function ShowEpisodeRow({ id }: { id: string }) {
  const e = useStore(useShallow((s) => episodeRow(s, id)));
  const a = useStore(useShallow((s) => ({ play: s.play, cancelDownload: s.cancelDownload, deleteFile: s.deleteFile, startDownload: s.startDownload, markPlayed: s.markPlayed, addToQueue: s.addToQueue })));
  const [open, setOpen] = useState(false);
  const [showId, guid] = parseKey(id);
  const notes = useNotes(showId, guid, open); // read from the database when the row is opened, not kept for every episode
  if (!e) return null;
  const dlIcon = e.downloading ? 'ph ph-x' : e.downloaded ? 'ph ph-trash' : 'ph ph-download-simple';
  const dlLabel = e.downloading ? 'Cancel download' : e.downloaded ? 'Delete file' : 'Download';
  const onDl = () => (e.downloading ? a.cancelDownload(e.key) : e.downloaded ? a.deleteFile(e.key) : a.startDownload(e.key));
  return (
    <div className="h-row" onDoubleClick={() => a.play(e.key)}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '10px 10px', margin: '0 -10px', borderRadius: 'var(--radius-md)', background: e.isCur ? 'color-mix(in srgb,var(--color-accent-900) 70%,transparent)' : 'transparent' }}>
      <i className={e.status === 'downloading' ? `${e.stIcon} spin` : e.stIcon} title={e.stLabel} style={{ fontSize: 18, width: 20, color: e.stColor }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {e.isNew && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent)', flex: 'none' }} />}
          <span onClick={() => setOpen((o) => !o)} title={open ? 'Hide show notes' : 'Show notes'} style={{ fontSize: 14, fontWeight: 500, color: titleColor(e), whiteSpace: open ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>{e.title}</span>
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}><RowMeta e={e} /></span>
        {open && <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.55, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', maxHeight: 260, overflow: 'auto' }}>{notes === null ? 'Loading…' : notes || 'No show notes for this episode.'}</p>}
      </div>
      <div className="row-actions" style={{ display: 'flex' }}>
        <GhostIcon icon={e.played ? 'ph ph-arrow-u-up-left' : 'ph ph-checks'} title={e.played ? 'Mark unplayed' : 'Mark played'} onClick={() => a.markPlayed(e.key, !e.played)} />
        <GhostIcon icon="ph ph-queue" title="Add to queue" onClick={() => a.addToQueue(e.key)} />
      </div>
      <RowProgress e={e} />
      <GhostIcon icon={dlIcon} title={dlLabel} onClick={onDl} />
      <RowPlay isCur={e.isCur} isPlaying={e.isPlaying} onClick={() => a.play(e.key)} />
    </div>
  );
});

export const titleColor = (e: EpisodeRow) => (e.played ? 'var(--color-neutral-500)' : e.isCur ? 'var(--color-accent-200)' : 'var(--color-text)');

export function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0', fontSize: 13, color: 'var(--color-neutral-500)' }}>
      <i className={icon} style={{ fontSize: 18 }} />{text}
    </div>
  );
}
