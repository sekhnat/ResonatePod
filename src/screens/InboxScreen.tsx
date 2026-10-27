import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { INBOX_SORT, epInfo, getEp, sortFor, useStore } from '../store';
import { agoLabel, applyFilter, applySort, episodeRow, inboxKeys, orderable } from '../model';
import { Art, GhostIcon, PageHeader, RowMeta, RowPlay, Seg, SortSelect, StatusIcon } from '../components/ui';
import { VirtualList } from '../components/VirtualList';
import { Empty, titleClass } from './ShowScreen';

const FILTERS = ['All', 'Unplayed', 'Downloaded'] as const;

export function InboxScreen() {
  const s = useStore(useShallow((s) => ({
    shows: s.shows, eps: s.eps, cur: s.cur, filter: s.filter, sort: sortFor(s, INBOX_SORT), lastChecked: s.lastChecked, refreshing: s.refreshing,
    setSort: s.setSort, set: s.set, markAllPlayed: s.markAllPlayed, toast: s.toast,
  })));
  // The order depends on the episodes, their state, the playing one, the filter and the sort; not on downloads or playback.
  const keys = useMemo(() => {
    const lib = { shows: s.shows, eps: s.eps };
    const items = inboxKeys(lib).flatMap((key) => { const info = epInfo(lib, key); return info ? [orderable(info.show, info.ep, getEp(lib, key), s.cur)] : []; });
    return applySort(applyFilter(items, s.filter), s.sort).map((r) => r.key);
  }, [s.shows, s.eps, s.cur, s.filter, s.sort]);
  const nextMin = Math.max(1, 60 - Math.floor((Date.now() - s.lastChecked) / 60000));
  const sub = s.refreshing ? 'Checking feeds…' : s.lastChecked ? `Feeds checked ${agoLabel(s.lastChecked)} · next check in ${nextMin} min` : 'Feeds not checked yet';

  return (
    <div className="page">
      <PageHeader title="New episodes" sub={sub}>
        <SortSelect value={s.sort} onPick={(v) => s.setSort(INBOX_SORT, v)} />
        <Seg options={FILTERS} value={s.filter} onPick={(filter) => s.set({ filter })} />
        <button className="btn btn-secondary btn-12" onClick={() => { s.markAllPlayed(); s.toast('Marked all new episodes as played'); }}>Mark all played</button>
      </PageHeader>
      <div className="list">
        <VirtualList count={keys.length} estimate={59} itemKey={(i) => keys[i]}>
          {(i) => <InboxRow id={keys[i]} />}
        </VirtualList>
        {!keys.length && <Empty icon="ph ph-tray" text={s.filter === 'All' ? 'No new episodes. Refresh to check your feeds.' : `No ${s.filter.toLowerCase()} episodes.`} />}
      </div>
    </div>
  );
}

/** One new episode, picking its own row out of the store so progress and played flags redraw just this row. */
const InboxRow = memo(function InboxRow({ id }: { id: string }) {
  const e = useStore(useShallow((s) => episodeRow(s, id)));
  const inQueue = useStore((s) => s.queue.includes(id));
  const a = useStore(useShallow((s) => ({ play: s.play, openShow: s.openShow, addToQueue: s.addToQueue })));
  if (!e) return null;
  return (
    <div className={`h-row ep-row bleed${e.isCur ? ' cur' : ''}`} onDoubleClick={() => a.play(e.key)}>
      <button className="ep-art-btn" onClick={() => a.openShow(e.showId)} title={`Open ${e.showTitle}`}>
        <Art bg={e.art} mono={e.mono} img={e.imageUrl} size={40} font={12} />
      </button>
      <div className="ep-body">
        <span className={`ep-title clip ${titleClass(e)}`}>{e.title}</span>
        <span className="ep-meta"><RowMeta e={e} prefix={`${e.showTitle} · `} /></span>
      </div>
      <StatusIcon e={e} />
      <GhostIcon icon={inQueue ? 'ph-fill ph-queue' : 'ph ph-queue'} title={inQueue ? 'In queue' : 'Add to queue'} onClick={() => a.addToQueue(e.key)} />
      <RowPlay isCur={e.isCur} isPlaying={e.isPlaying} onClick={() => a.play(e.key)} />
    </div>
  );
});
