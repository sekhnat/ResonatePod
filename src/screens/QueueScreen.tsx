import { useState } from 'react';
import { useStore } from '../store';
import { rowsFor } from '../model';
import { Art, GhostIcon, PageHeader, RowPlay } from '../components/ui';
import { Empty, titleColor } from './ShowScreen';

export function QueueScreen() {
  const s = useStore();
  const rows = rowsFor(s, s.queue);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const total = rows.reduce((a, r) => a + r.durMin, 0);
  const n = rows.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 760 }}>
      <PageHeader title="Queue" sub={`${n} episode${n === 1 ? '' : 's'} · ${Math.floor(total / 60)} h ${total % 60} min at 1×`}>
        <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={n <= 1} onClick={s.clearQueue}>Clear queue</button>
      </PageHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((e, i) => (
          <div key={e.key} draggable
            onDragStart={(ev) => { setDrag(i); ev.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(ev) => { ev.preventDefault(); setOver(i); }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(ev) => { ev.preventDefault(); if (drag !== null && drag !== i) s.moveQueue(drag, i); setDrag(null); setOver(null); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onDoubleClick={() => s.play(e.key)}
            className={`h-row${drag === i ? ' dragging' : ''}${over === i && drag !== i ? ' drag-over' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '9px 10px', borderRadius: 'var(--radius-md)', background: e.isCur ? 'color-mix(in srgb,var(--color-accent-900) 70%,transparent)' : 'transparent' }}>
            <i className="ph ph-dots-six-vertical" title="Drag to reorder" style={{ fontSize: 16, color: 'var(--color-neutral-600)', cursor: 'grab' }} />
            <span style={{ width: 18, fontSize: 12, color: 'var(--color-neutral-500)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
            <Art bg={e.art} mono={e.mono} size={40} font={12} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: titleColor(e) }}>{e.title}</span>
              <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{e.showTitle} · {e.meta}</span>
            </div>
            <div className="row-actions" style={{ display: 'flex' }}>
              {i > 0 && <GhostIcon icon="ph ph-arrow-line-up" title="Play next" onClick={() => s.moveQueue(i, s.queue[0] === s.cur ? 1 : 0)} />}
              <GhostIcon icon="ph ph-x" title="Remove from queue" onClick={() => s.removeFromQueue(e.key)} />
            </div>
            <i className={e.status === 'downloading' ? `${e.stIcon} spin` : e.stIcon} title={e.stLabel} style={{ fontSize: 16, color: e.stColor }} />
            <RowPlay isCur={e.isCur} isPlaying={e.isPlaying} onClick={() => s.play(e.key)} />
          </div>
        ))}
        {!n && <Empty icon="ph ph-queue" text="Your queue is empty. Add episodes from New episodes or a show page." />}
      </div>
    </div>
  );
}
