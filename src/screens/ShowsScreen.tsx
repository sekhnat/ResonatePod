import { art, mono } from '../data';
import { useStore } from '../store';
import { unplayedFor } from '../model';
import { Art, PageHeader } from '../components/ui';
import { importOpmlFile } from '../lib/library-io';

export function ShowsScreen() {
  const s = useStore();
  const onDisk = Object.values(s.eps).filter((e) => e.file).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader title="Shows" sub={`${s.shows.length} subscriptions · ${onDisk} episodes on disk`}>
        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => void importOpmlFile()}>
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
              <Art bg={art(x.hue)} mono={mono(x.title)} img={x.imageUrl} size="100%" font={36} weight={500} radius="var(--radius-md)" style={{ aspectRatio: '1', height: 'auto' }}>
                <span className="h-ring" style={{ position: 'absolute', inset: 0, borderRadius: 'inherit' }} />
                {n > 0 && <span className="tag tag-accent" style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, padding: '2px 7px' }}>{n} new</span>}
              </Art>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
                <span className="clamp-2" style={{ fontSize: 13, fontWeight: 500 }}>{x.title}</span>
                <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.author}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
