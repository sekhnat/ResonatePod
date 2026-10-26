import { art, mono } from '../data';
import { useStore } from '../store';
import { unplayedFor } from '../model';
import { PageHeader } from '../components/ui';

export function ShowsScreen() {
  const s = useStore();
  const onDisk = Object.values(s.eps).filter((e) => e.downloaded).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader title="Shows" sub={`${s.shows.length} subscriptions · ${onDisk} episodes on disk`}>
        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => document.getElementById('opml-input')?.click()}>
          <i className="ph ph-file-arrow-up" style={{ fontSize: 14 }} />Import OPML
        </button>
        <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => s.go('discover')}>
          <i className="ph ph-plus" style={{ fontSize: 14 }} />Add show
        </button>
      </PageHeader>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 'var(--space-8) var(--space-6)' }}>
        {s.shows.map((x) => {
          const n = unplayedFor(s, x.id);
          return (
            <button key={x.id} onClick={() => s.openShow(x.id)}
              style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 0, border: 'none', background: 'none', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              <div className="h-ring" style={{ aspectRatio: '1', width: '100%', borderRadius: 'var(--radius-md)', background: art(x.hue), display: 'grid', placeItems: 'center', fontSize: 36, fontWeight: 500, color: 'var(--color-neutral-100)', position: 'relative' }}>
                {mono(x.title)}
                {n > 0 && <span className="tag tag-accent" style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, padding: '2px 7px' }}>{n} new</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{x.title}</span>
                <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{x.author}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
