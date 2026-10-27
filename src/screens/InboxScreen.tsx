import { INBOX_SORT, sortFor, useStore } from '../store';
import { agoLabel, applyFilter, applySort, inboxKeys, rowsFor } from '../model';
import { Art, GhostIcon, PageHeader, RowMeta, RowPlay, Seg, SortSelect } from '../components/ui';
import { Empty, titleColor } from './ShowScreen';

const FILTERS = ['All', 'Unplayed', 'Downloaded'] as const;

export function InboxScreen() {
  const s = useStore();
  const rows = applySort(applyFilter(rowsFor(s, inboxKeys(s)), s.filter), sortFor(s, INBOX_SORT));
  const nextMin = Math.max(1, 60 - Math.floor((Date.now() - s.lastChecked) / 60000));
  const sub = s.refreshing ? 'Checking feeds…' : s.lastChecked ? `Feeds checked ${agoLabel(s.lastChecked)} · next check in ${nextMin} min` : 'Feeds not checked yet';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader title="New episodes" sub={sub}>
        <SortSelect value={sortFor(s, INBOX_SORT)} onPick={(v) => s.setSort(INBOX_SORT, v)} />
        <Seg options={FILTERS} value={s.filter} onPick={(filter) => s.set({ filter })} />
        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => { s.markAllPlayed(); s.toast('Marked all new episodes as played'); }}>Mark all played</button>
      </PageHeader>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((e) => (
          <div key={e.key} className="h-row" onDoubleClick={() => s.play(e.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '9px 10px', margin: '0 -10px', borderRadius: 'var(--radius-md)', background: e.isCur ? 'color-mix(in srgb,var(--color-accent-900) 70%,transparent)' : 'transparent' }}>
            <button onClick={() => s.openShow(e.showId)} title={`Open ${e.showTitle}`} style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}>
              <Art bg={e.art} mono={e.mono} img={e.imageUrl} size={40} font={12} />
            </button>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: titleColor(e), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
              <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}><RowMeta e={e} prefix={`${e.showTitle} · `} /></span>
            </div>
            <i className={e.status === 'downloading' ? `${e.stIcon} spin` : e.stIcon} title={e.stLabel} style={{ fontSize: 16, color: e.stColor }} />
            <GhostIcon icon={s.queue.includes(e.key) ? 'ph-fill ph-queue' : 'ph ph-queue'} title={s.queue.includes(e.key) ? 'In queue' : 'Add to queue'} onClick={() => s.addToQueue(e.key)} />
            <RowPlay isCur={e.isCur} isPlaying={e.isPlaying} onClick={() => s.play(e.key)} />
          </div>
        ))}
        {!rows.length && <Empty icon="ph ph-tray" text={s.filter === 'All' ? 'No new episodes. Refresh to check your feeds.' : `No ${s.filter.toLowerCase()} episodes.`} />}
      </div>
    </div>
  );
}
