import { protocol } from 'electron';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fetchFollowing, rewrite } from './http';
import type { DownloadRoots } from './paths';

// ---------- media protocol: local files and proxied streams, with Range support ----------

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

async function serveFile(file: string, range: string | null): Promise<Response> {
  const { size } = await fs.stat(file);
  const type = MIME[path.extname(file).slice(1).toLowerCase()] ?? 'audio/mpeg';
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  const start = m && m[1] ? +m[1] : 0;
  const end = m && m[2] ? Math.min(+m[2], size - 1) : size - 1;
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  const headers = { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
  return m
    ? new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}` } })
    : new Response(body, { status: 200, headers });
}

async function serveRemote(url: string, range: string | null): Promise<Response> {
  const res = await fetchFollowing(url, { headers: range ? { Range: range } : {} }, rewrite);
  const headers = new Headers({ 'Access-Control-Allow-Origin': '*' });
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

/** Registers resonate-media://, the page's way to play a downloaded file or an episode that is only streamed. */
export function registerMediaProtocol(roots: DownloadRoots) {
  protocol.handle('resonate-media', async (req) => {
    const u = new URL(req.url);
    const target = decodeURIComponent(u.pathname.slice(1));
    const range = req.headers.get('range');
    try {
      if (u.hostname === 'file') {
        const file = await roots.resolve(target);
        return file ? await serveFile(file, range) : new Response('Not one of your download folders', { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      if (u.hostname === 'remote' && /^https?:\/\//.test(target)) return await serveRemote(target, range);
      return new Response('Not found', { status: 404 });
    } catch (err) {
      return new Response(String(err), { status: 502 });
    }
  });
}
