import { memo, useMemo, useRef, useState, type DragEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { epInfo, useStore } from '../store';
import { episodeRow } from '../model';
import { Art, GhostIcon, PageHeader, RowMeta, RowPlay, StatusIcon } from '../components/ui';
import { Empty, titleClass } from './ShowScreen';

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
    <div className="page">
      <PageHeader title="Queue" sub={`${s.n} episode${s.n === 1 ? '' : 's'} · ${Math.floor(s.total / 60)} h ${s.total % 60} min at 1×`}>
        <button className="btn btn-secondary btn-12" disabled={s.n <= 1} onClick={s.clearQueue}>Clear queue</button>
      </PageHeader>
      <div className="list tight">
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
      className={`h-row ep-row${e.isCur ? ' cur' : ''}${dragging ? ' dragging' : ''}${over ? ' drag-over' : ''}`}>
      <i className="ph ph-dots-six-vertical q-handle" title="Drag to reorder" />
      <span className="q-index">{i + 1}</span>
      <Art bg={e.art} mono={e.mono} img={e.imageUrl} size={40} font={12} />
      <div className="ep-body">
        <span className={`ep-title ${titleClass(e)}`}>{e.title}</span>
        <span className="ep-meta"><RowMeta e={e} prefix={`${e.showTitle} · `} /></span>
      </div>
      <div className="row-actions">
        {i > 0 && <GhostIcon icon="ph ph-arrow-line-up" title="Play next" onClick={() => a.moveQueue(i, nextSlot)} />}
        <GhostIcon icon="ph ph-x" title="Remove from queue" onClick={() => a.removeFromQueue(e.key)} />
      </div>
      <StatusIcon e={e} />
      <RowPlay isCur={e.isCur} isPlaying={e.isPlaying} onClick={() => a.play(e.key)} />
    </div>
  );
});
