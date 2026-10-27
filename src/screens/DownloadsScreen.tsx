import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, epInfo, getEp, downloadsBlocked } from '../store';
import { art, dateLabel, mono } from '../data';
import { dlSummary, fmtSpeed } from '../model';
import { platform } from '../platform';
import { Art, GhostIcon, PageHeader } from '../components/ui';
import { Empty } from './ShowScreen';

const MB = 1048576;

export function DownloadsScreen() {
  const s = useStore(useShallow((s) => ({
    dl: s.dl, dlDone: s.dlDone, dlPaused: s.dlPaused, metered: s.metered, tg: s.tg, shows: s.shows, eps: s.eps,
    cancelDownload: s.cancelDownload, deleteFile: s.deleteFile, startDownload: s.startDownload, toggleDlPause: s.toggleDlPause,
  })));
  // Ticks the "Retrying in …" countdown.
  const [now, setNow] = useState(Date.now());
  const counting = s.dl.some((d) => d.retryAt);
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [counting]);
  const blocked = downloadsBlocked(s);
  const meteredPause = !s.dlPaused && blocked;
  const done = s.dlDone.map((d) => ({ d, info: epInfo(s, d.key), file: getEp(s, d.key).file })).filter((x) => x.info);
  const net = s.metered === true ? (s.tg.metered ? 'Metered connection · downloads paused' : 'Metered connection') : s.metered === false ? 'Unmetered connection' : 'Connection type unknown';
  const time = (ms: number) => `${dateLabel(ms)}, ${new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className="page wide">
      <PageHeader title="Downloads" sub={dlSummary(s)}>
        <span className="tag tag-neutral dl-net"><i className={s.metered ? 'ph ph-cell-signal-high' : 'ph ph-wifi-high'} />{net}</span>
        <button className="btn btn-secondary btn-12" onClick={s.toggleDlPause}>
          <i className={`${s.dlPaused ? 'ph ph-play' : 'ph ph-pause'} ico-14`} />{s.dlPaused ? 'Resume all' : 'Pause all'}
        </button>
      </PageHeader>
      {!platform.isDesktop && <Empty icon="ph ph-info" text="Downloads are available in the desktop app. In the browser, episodes stream." />}
      <div className="dl-group">
        <div className="section-label">Active</div>
        {s.dl.map((d) => {
          const e = epInfo(s, d.key);
          if (!e) return null;
          const failed = !!d.error;
          const waiting = !failed && !!d.retryAt;
          const running = !failed && !waiting && !blocked && !!d.active;
          const size = d.total ? `${Math.round(d.total / MB)} MB` : 'size unknown';
          const status = failed
            ? `Failed · ${d.error}`
            : waiting
              ? `Retrying in ${Math.max(1, Math.ceil((d.retryAt! - now) / 1000))} s`
              : !running
                ? `${s.dlPaused ? 'Paused' : meteredPause ? 'Waiting for unmetered connection' : 'Queued'} · ${size}`
                : `${(d.received / MB).toFixed(1)} / ${d.total ? `${Math.round(d.total / MB)} MB` : '?'}${d.speed ? ` · ${fmtSpeed(d.speed)}` : ''}`;
          const pct = d.total ? Math.min(100, (d.received / d.total) * 100) : 0;
          return (
            <div key={d.key} className="dl-card">
              <Art bg={art(e.show.hue)} mono={mono(e.show.title)} img={e.ep.imageUrl ?? e.show.imageUrl} size={40} font={12} />
              <div className="dl-body">
                <div className="dl-line">
                  <span className="dl-title">{e.title}</span>
                  <span className={`dl-status${failed ? ' failed' : ''}`} title={status}>{status}</span>
                </div>
                <div className="dl-bar">
                  <div className={`dl-fill${failed ? ' failed' : ''}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              {(failed || waiting) && <GhostIcon icon="ph ph-arrow-clockwise" title="Retry now" iconSize={15} onClick={() => s.startDownload(d.key)} />}
              <GhostIcon icon="ph ph-x" title={failed ? 'Remove' : 'Cancel download'} iconSize={15} onClick={() => s.cancelDownload(d.key)} />
            </div>
          );
        })}
        {!s.dl.length && <Empty icon="ph ph-check-circle" text="Nothing downloading right now." />}
      </div>
      {done.length > 0 && (
        <div className="dl-group">
          <div className="section-label">Completed</div>
          <table className="table">
            <thead><tr><th>Episode</th><th>Show</th><th>Size</th><th>Finished</th><th /></tr></thead>
            <tbody>
              {done.map(({ d, info, file }) => (
                <tr key={d.key}>
                  <td className={`td-title${file ? '' : ' gone'}`}>{info!.title}</td>
                  <td className="td-dim">{info!.show.title}</td>
                  <td className="td-dim td-num">{file ? `${Math.round((getEp(s, d.key).fileBytes ?? 0) / MB)} MB` : 'Deleted'}</td>
                  <td className="td-dim">{time(d.when)}</td>
                  <td className="td-actions">
                    {file && (
                      <>
                        <button title="Show in Files" aria-label="Show in Files" onClick={() => platform.showInFolder(file)} className="h-text td-btn">
                          <i className="ph ph-folder-open ico-15" />
                        </button>
                        <button title="Delete file" aria-label="Delete file" onClick={() => void s.deleteFile(d.key)} className="h-text td-btn">
                          <i className="ph ph-trash ico-15" />
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
