import { useStore, epInfo } from '../store';
import { art, mono } from '../data';
import { dlSummary } from '../model';
import { Art, GhostIcon, PageHeader, sectionLabel } from '../components/ui';
import { Empty } from './ShowScreen';

export function DownloadsScreen() {
  const s = useStore();
  const par = parseInt(s.sv.par, 10);
  const done = s.dlDone.map((d) => ({ d, info: epInfo(s, d.key) })).filter((x) => x.info);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', maxWidth: 820 }}>
      <PageHeader title="Downloads" sub={dlSummary(s)}>
        <span className="tag tag-neutral" style={{ gap: 5 }}><i className="ph ph-wifi-high" />Unmetered · limit 4 MB/s</span>
        <button className="btn btn-secondary" onClick={s.toggleDlPause} style={{ fontSize: 12 }}>
          <i className={s.dlPaused ? 'ph ph-play' : 'ph ph-pause'} style={{ fontSize: 14 }} />{s.dlPaused ? 'Resume all' : 'Pause all'}
        </button>
      </PageHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={sectionLabel}>Active</div>
        {s.dl.map((d, i) => {
          const e = epInfo(s, d.key);
          if (!e) return null;
          const queued = s.dlPaused || i >= par;
          const status = queued ? `${s.dlPaused ? 'Paused' : 'Queued'} · ${d.mb} MB` : `${(d.mb * d.p).toFixed(1)} / ${d.mb} MB · 1.8 MB/s`;
          return (
            <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
              <Art bg={art(e.show.hue)} mono={mono(e.show.title)} size={40} font={12} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{status}</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: 'var(--color-neutral-800)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round(d.p * 100)}%`, background: 'var(--color-accent)', transition: 'width 1s linear' }} />
                </div>
              </div>
              <GhostIcon icon="ph ph-x" title="Cancel download" iconSize={15} onClick={() => s.cancelDownload(d.key)} />
            </div>
          );
        })}
        {!s.dl.length && <Empty icon="ph ph-check-circle" text="Nothing downloading right now." />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={sectionLabel}>Completed</div>
        <table className="table">
          <thead><tr><th>Episode</th><th>Show</th><th>Size</th><th>Finished</th><th /></tr></thead>
          <tbody>
            {done.map(({ d, info }) => (
              <tr key={d.key + d.when}>
                <td style={{ fontWeight: 500 }}>{info!.title}</td>
                <td style={{ color: 'var(--color-neutral-400)' }}>{info!.show.title}</td>
                <td style={{ color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{info!.sizeMb} MB</td>
                <td style={{ color: 'var(--color-neutral-400)' }}>{d.when}</td>
                <td style={{ textAlign: 'right' }}>
                  <button title="Show in Files" aria-label="Show in Files" onClick={() => s.toast(`Opened ${s.folder}/${info!.show.title}/ in Dolphin`)}
                    className="h-text" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-neutral-400)' }}>
                    <i className="ph ph-folder-open" style={{ fontSize: 15 }} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
