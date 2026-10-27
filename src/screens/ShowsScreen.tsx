import { useShallow } from 'zustand/react/shallow';
import { art, mono } from '../data';
import { useStore } from '../store';
import { unplayedFor } from '../model';
import { Art, PageHeader } from '../components/ui';
import { importOpmlFile } from '../lib/library-io';

export function ShowsScreen() {
  const s = useStore(useShallow((s) => ({ shows: s.shows, eps: s.eps, go: s.go, openShow: s.openShow })));
  const onDisk = Object.values(s.eps).filter((e) => e.file).length;
  return (
    <div className="page">
      <PageHeader title="Shows" sub={`${s.shows.length} subscriptions · ${onDisk} episodes on disk`}>
        <button className="btn btn-secondary btn-12" onClick={() => void importOpmlFile()}>
          <i className="ph ph-file-arrow-up ico-14" />Import OPML
        </button>
        <button className="btn btn-primary btn-12" onClick={() => s.go('discover')}>
          <i className="ph ph-plus ico-14" />Add show
        </button>
      </PageHeader>
      <div className="shows-grid">
        {s.shows.map((x) => {
          const n = unplayedFor(s, x.id);
          return (
            <button key={x.id} className="show-tile" onClick={() => s.openShow(x.id)}>
              <Art bg={art(x.hue)} mono={mono(x.title)} img={x.imageUrl} size="100%" font={36} weight={500} radius="var(--radius-md)" className="tile-art" style={{ height: 'auto' }}>
                <span className="h-ring tile-ring" />
                {n > 0 && <span className="tag tag-accent tile-new">{n} new</span>}
              </Art>
              <div className="tile-text">
                <span className="clamp-2 tile-title">{x.title}</span>
                <span className="tile-author">{x.author}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
