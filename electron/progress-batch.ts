import type { DownloadEvent, DownloadMessage, DownloadProgress } from '../shared/types';

/**
 * Sits between the download manager and the window. Each running download reports progress several times a second, and
 * every report would be its own message and its own store update in the page. This holds the latest report of each
 * download and sends them together once every `ms`. Any other event goes out at once, after the progress that came
 * before it, so a download never appears to finish before its last progress or to move after it errored.
 */
export function batchProgress(send: (e: DownloadMessage) => void, ms = 250): (e: DownloadEvent) => void {
  const latest = new Map<string, DownloadProgress>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!latest.size) return;
    const items = [...latest.values()];
    latest.clear();
    send({ type: 'progressBatch', items });
  };

  return (e) => {
    if (e.type === 'progress') {
      const { type: _type, ...p } = e;
      latest.set(p.key, p);
      timer ??= setTimeout(flush, ms);
      return;
    }
    flush();
    send(e);
  };
}
