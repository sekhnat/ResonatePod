import { useStore, epInfo, getEp, downloadsBlocked } from '../store';
import { art, dateLabel, mono } from '../data';
import { dlSummary, fmtSpeed } from '../model';
import { platform } from '../platform';
import { Art, GhostIcon, PageHeader, sectionLabel } from '../components/ui';
import { Empty } from './ShowScreen';

const MB = 1048576;

export function DownloadsScreen() {
  const s = useStore();
  const par = parseInt(s.sv.par, 10);
  const blocked = downloadsBlocked(s);
  const meteredPause = !s.dlPaused && blocked;
  const done = s.dlDone.map((d) => ({ d, info: epInfo(s, d.key), file: getEp(s, d.key).file })).filter((x) => x.info);
  const net = s.metered === true ? (s.tg.metered ? 'Metered connection · downloads paused' : 'Metered connection') : s.metered === false ? 'Unmetered connection' : 'Connection type unknown';
  const time = (ms: number) => `${dateLabel(ms)}, ${new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', maxWidth: 820 }}>
      <PageHeader title="Downloads" sub={dlSummary(s)}>
        <span className="tag tag-neutral" style={{ gap: 5 }}><i className={s.metered ? 'ph ph-cell-signal-high' : 'ph ph-wifi-high'} />{net}</span>
        <button className="btn btn-secondary" onClick={s.toggleDlPause} style={{ fontSize: 12 }}>
          <i className={s.dlPaused ? 'ph ph-play' : 'ph ph-pause'} style={{ fontSize: 14 }} />{s.dlPaused ? 'Resume all' : 'Pause all'}
        </button>
      </PageHeader>
      {!platform.isDesktop && <Empty icon="ph ph-info" text="Downloads are available in the desktop app. In the browser, episodes stream." />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={sectionLabel}>Active</div>
        {s.dl.map((d, i) => {
          const e = epInfo(s, d.key);
          if (!e) return null;
          const queued = blocked || i >= par;
          const size = d.total ? `${Math.round(d.total / MB)} MB` : 'size unknown';
          const status = queued
            ? `${s.dlPaused ? 'Paused' : meteredPause ? 'Waiting for unmetered connection' : 'Queued'} · ${size}`
            : `${(d.received / MB).toFixed(1)} / ${d.total ? `${Math.round(d.total / MB)} MB` : '?'}${d.speed ? ` · ${fmtSpeed(d.speed)}` : ''}`;
          const pct = d.total ? Math.min(100, (d.received / d.total) * 100) : 0;
          return (
            <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
              <Art bg={art(e.show.hue)} mono={mono(e.show.title)} img={e.ep.imageUrl ?? e.show.imageUrl} size={40} font={12} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{status}</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: 'var(--color-neutral-800)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-accent)', transition: 'width .3s linear' }} />
                </div>
              </div>
              <GhostIcon icon="ph ph-x" title="Cancel download" iconSize={15} onClick={() => s.cancelDownload(d.key)} />
            </div>
          );
        })}
        {!s.dl.length && <Empty icon="ph ph-check-circle" text="Nothing downloading right now." />}
      </div>
      {done.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={sectionLabel}>Completed</div>
          <table className="table">
            <thead><tr><th>Episode</th><th>Show</th><th>Size</th><th>Finished</th><th /></tr></thead>
            <tbody>
              {done.map(({ d, info, file }) => (
                <tr key={d.key}>
                  <td style={{ fontWeight: 500, color: file ? undefined : 'var(--color-neutral-500)' }}>{info!.title}</td>
                  <td style={{ color: 'var(--color-neutral-400)' }}>{info!.show.title}</td>
                  <td style={{ color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums' }}>{file ? `${Math.round((getEp(s, d.key).fileBytes ?? 0) / MB)} MB` : 'Deleted'}</td>
                  <td style={{ color: 'var(--color-neutral-400)' }}>{time(d.when)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {file && (
                      <>
                        <button title="Show in Files" aria-label="Show in Files" onClick={() => platform.showInFolder(file)}
                          className="h-text" style={{ border: 'none', background: 'none', padding: '0 4px', cursor: 'pointer', color: 'var(--color-neutral-400)' }}>
                          <i className="ph ph-folder-open" style={{ fontSize: 15 }} />
                        </button>
                        <button title="Delete file" aria-label="Delete file" onClick={() => void s.deleteFile(d.key)}
                          className="h-text" style={{ border: 'none', background: 'none', padding: '0 4px', cursor: 'pointer', color: 'var(--color-neutral-400)' }}>
                          <i className="ph ph-trash" style={{ fontSize: 15 }} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
