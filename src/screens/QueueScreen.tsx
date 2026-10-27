import { memo, useMemo, useRef, useState, type DragEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { epInfo, useStore } from '../store';
import { episodeRow } from '../model';
import { Art, GhostIcon, PageHeader, RowMeta, RowPlay } from '../components/ui';
import { Empty, titleColor } from './ShowScreen';

export function QueueScreen() {
  const s = useStore(useShallow((s) => ({
    queue: s.queue, n: s.queue.filter((k) => epInfo(s, k)).length, total: s.queue.reduce((a, k) => a + (epInfo(s, k)?.durMin ?? 0), 0),
    clearQueue: s.clearQueue, moveQueue: s.moveQueue,
  })));
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  const { moveQueue } = s;
  // Stable between renders, so that only the rows whose drag state changed redraw while dragging.
  const handlers = useMemo<DragHandlers>(() => ({
    start: (i, ev) => { dragging.current = i; setDrag(i); ev.dataTransfer.effectAllowed = 'move'; },
    over: (i, ev) => { ev.preventDefault(); setOver(i); },
    leave: (i) => setOver((o) => (o === i ? null : o)),
    drop: (i, ev) => { ev.preventDefault(); const from = dragging.current; if (from !== null && from !== i) moveQueue(from, i); dragging.current = null; setDrag(null); setOver(null); },
    end: () => { dragging.current = null; setDrag(null); setOver(null); },
  }), [moveQueue]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader title="Queue" sub={`${s.n} episode${s.n === 1 ? '' : 's'} · ${Math.floor(s.total / 60)} h ${s.total % 60} min at 1×`}>
        <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={s.n <= 1} onClick={s.clearQueue}>Clear queue</button>
      </PageHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {s.queue.map((key, i) => <QueueRow key={key} id={key} index={i} dragging={drag === i} over={over === i && drag !== i} on={handlers} />)}
        {!s.n && <Empty icon="ph ph-queue" text="Your queue is empty. Add episodes from New episodes or a show page." />}
      </div>
    </div>
  );
}

interface DragHandlers {
  start(i: number, ev: DragEvent): void;
  over(i: number, ev: DragEvent): void;
  leave(i: number): void;
  drop(i: number, ev: DragEvent): void;
  end(): void;
}

const QueueRow = memo(function QueueRow({ id, index: i, dragging, over, on }: { id: string; index: number; dragging: boolean; over: boolean; on: DragHandlers }) {
  const e = useStore(useShallow((s) => episodeRow(s, id)));
  // "Play next" goes after the episode that's playing, if that is the head of the queue.
  const nextSlot = useStore((s) => (s.queue[0] === s.cur ? 1 : 0));
  const a = useStore(useShallow((s) => ({ play: s.play, moveQueue: s.moveQueue, removeFromQueue: s.removeFromQueue })));
  if (!e) return null;
  return (
    <div draggable
      onDragStart={(ev) => on.start(i, ev)} onDragOver={(ev) => on.over(i, ev)} onDragLeave={() => on.leave(i)} onDrop={(ev) => on.drop(i, ev)} onDragEnd={on.end}
      onDoubleClick={() => a.play(e.key)}
      className={`h-row${dragging ? ' dragging' : ''}${over ? ' drag-over' : ''}`}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '9px 10px', borderRadius: 'var(--radius-md)', background: e.isCur ? 'color-mix(in srgb,var(--color-accent-900) 70%,transparent)' : 'transparent' }}>
      <i className="ph ph-dots-six-vertical" title="Drag to reorder" style={{ fontSize: 16, color: 'var(--color-neutral-600)', cursor: 'grab' }} />
      <span style={{ width: 18, fontSize: 12, color: 'var(--color-neutral-500)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
      <Art bg={e.art} mono={e.mono} img={e.imageUrl} size={40} font={12} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: titleColor(e) }}>{e.title}</span>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}><RowMeta e={e} prefix={`${e.showTitle} · `} /></span>
      </div>
      <div className="row-actions" style={{ display: 'flex' }}>
        {i > 0 && <GhostIcon icon="ph ph-arrow-line-up" title="Play next" onClick={() => a.moveQueue(i, nextSlot)} />}
        <GhostIcon icon="ph ph-x" title="Remove from queue" onClick={() => a.removeFromQueue(e.key)} />
      </div>
      <i className={e.status === 'downloading' ? `${e.stIcon} spin` : e.stIcon} title={e.stLabel} style={{ fontSize: 16, color: e.stColor }} />
      <RowPlay isCur={e.isCur} isPlaying={e.isPlaying} onClick={() => a.play(e.key)} />
    </div>
  );
});
