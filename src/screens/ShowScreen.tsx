import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { art, epKey, mono, parseKey } from '../data';
import { findShow, getEp, sortFor, useStore } from '../store';
import { useNotes } from '../notes';
import { applyFilter, applySort, episodeRow, orderable, ruleLabel, unplayedFor, type EpisodeRow } from '../model';
import { Art, GhostIcon, RowMeta, RowPlay, RowProgress, Seg, SortSelect, StatusIcon } from '../components/ui';
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
    <div className="show-page">
      <div className="show-hero">
        <Art bg={art(sh.hue)} mono={mono(sh.title)} img={sh.imageUrl} size={148} font={44} weight={500} radius="var(--radius-lg)" className="show-cover" />
        <div className="show-info">
          <span className="card-kicker">{sh.cat} · {sh.freq}</span>
          <h1 className="show-title">{sh.title}</h1>
          <span className="show-author">
            {sh.author}
            {sh.link && <>{sh.author && ' · '}<a className="show-link" href={sh.link} target="_blank" rel="noreferrer">Website</a></>}
          </span>
          <div className="show-actions">
            <button className="btn btn-primary" disabled={!sh.eps.length} onClick={() => s.play(epKey(sh.id, sh.eps[0].guid))}>
              <i className="ph-fill ph-play ico-13" />Play latest
            </button>
            <button className="btn btn-secondary" title="Unsubscribe…" onClick={() => s.set({ dialog: 'unsubscribe' })}>
              <i className="ph ph-check ico-14" />Subscribed
            </button>
            <span className="tag tag-neutral show-rule"><i className="ph ph-download-simple" />{s.rule}</span>
            <button className="btn btn-icon btn-secondary show-cfg" onClick={() => s.set({ cfgOpen: true })} title="Show settings" aria-label="Show settings">
              <i className="ph ph-sliders-horizontal ico-15" />
            </button>
          </div>
        </div>
      </div>
      <p className="show-desc">{sh.desc}</p>
      <div className="list">
        <div className="show-list-head">
          <span className="show-count">{sh.eps.length} episodes · {s.unplayed} unplayed</span>
          <div className="show-list-controls">
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
    <div className={`h-row ep-row bleed tall${e.isCur ? ' cur' : ''}`} onDoubleClick={() => a.play(e.key)}>
      <StatusIcon e={e} wide />
      <div className="ep-body">
        <div className="ep-title-line">
          {e.isNew && <span className="ep-new-dot" />}
          <span className={`ep-title clip link ${titleClass(e)}${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} title={open ? 'Hide show notes' : 'Show notes'}>{e.title}</span>
        </div>
        <span className="ep-meta"><RowMeta e={e} /></span>
        {open && <p className="ep-notes">{notes === null ? 'Loading…' : notes || 'No show notes for this episode.'}</p>}
      </div>
      <div className="row-actions">
        <GhostIcon icon={e.played ? 'ph ph-arrow-u-up-left' : 'ph ph-checks'} title={e.played ? 'Mark unplayed' : 'Mark played'} onClick={() => a.markPlayed(e.key, !e.played)} />
        <GhostIcon icon="ph ph-queue" title="Add to queue" onClick={() => a.addToQueue(e.key)} />
      </div>
      <RowProgress e={e} />
      <GhostIcon icon={dlIcon} title={dlLabel} onClick={onDl} />
      <RowPlay isCur={e.isCur} isPlaying={e.isPlaying} onClick={() => a.play(e.key)} />
    </div>
  );
});

/** The class that colours an episode's title: dimmed once played, highlighted while it is the current one. */
export const titleClass = (e: EpisodeRow) => (e.played ? 'played' : e.isCur ? 'cur' : '');

export function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="empty">
      <i className={`${icon} ico-18`} />{text}
    </div>
  );
}
