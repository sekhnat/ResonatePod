import type { Chapter } from './types';

/** Reads `len` bytes at `offset`; may return fewer at the end of the file. */
export type ReadAt = (offset: number, len: number) => Promise<Uint8Array>;

const MAX_TAG = 4 * 1024 * 1024;
const MAX_ATOM_HOPS = 64;

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const syncsafe = (b: Uint8Array, o: number) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

/**
 * Chapters stored inside the media file: ID3v2 `CHAP` frames (MP3) or the Nero
 * `chpl` atom (MP4/M4A). Returns null when the file has none.
 */
export async function readEmbeddedChapters(readAt: ReadAt, size: number): Promise<Chapter[] | null> {
  const head = await readAt(0, 10);
  if (head.length >= 10 && ascii(head, 0, 3) === 'ID3') return readId3(readAt, head);
  if (head.length >= 8 && ascii(head, 4, 4) === 'ftyp') return readMp4(readAt, size);
  return null;
}

// ---------- ID3v2 ----------

function decodeText(b: Uint8Array): string {
  const enc = b[0];
  const body = b.subarray(1);
  let s: string;
  if (enc === 1 || enc === 2) {
    let le = enc === 1;
    let start = 0;
    if (enc === 1 && body.length >= 2) {
      if (body[0] === 0xff && body[1] === 0xfe) { le = true; start = 2; } else if (body[0] === 0xfe && body[1] === 0xff) { le = false; start = 2; }
    }
    s = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(body.subarray(start, start + ((body.length - start) & ~1)));
  } else {
    s = new TextDecoder(enc === 3 ? 'utf-8' : 'latin1').decode(body);
  }
  return s.replace(/\0[\s\S]*$/, '').trim();
}

interface Frame { id: string; data: Uint8Array }

function frames(b: Uint8Array, from: number, to: number, version: number): Frame[] {
  const out: Frame[] = [];
  let o = from;
  while (o + 10 <= to) {
    const id = ascii(b, o, 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = version >= 4 ? syncsafe(b, o + 4) : u32(b, o + 4);
    if (len <= 0 || o + 10 + len > to) break;
    out.push({ id, data: b.subarray(o + 10, o + 10 + len) });
    o += 10 + len;
  }
  return out;
}

async function readId3(readAt: ReadAt, head: Uint8Array): Promise<Chapter[] | null> {
  const version = head[3];
  const flags = head[5];
  if (version < 3 || version > 4 || flags & 0x80) return null; // v2.2 has no CHAP; unsynchronised tags are rare
  const size = syncsafe(head, 6);
  if (size > MAX_TAG) return null;
  const tag = await readAt(10, size);
  let start = 0;
  if (flags & 0x40) start = version >= 4 ? syncsafe(tag, 0) : u32(tag, 0) + 4; // extended header
  const chapters: Chapter[] = [];
  for (const f of frames(tag, start, tag.length, version)) {
    if (f.id !== 'CHAP') continue;
    const nul = f.data.indexOf(0);
    if (nul < 0 || nul + 17 > f.data.length) continue;
    const at = u32(f.data, nul + 1) / 1000;
    const title = frames(f.data, nul + 17, f.data.length, version).find((s) => s.id === 'TIT2');
    chapters.push({ t: (title && decodeText(title.data)) || 'Chapter', at });
  }
  return chapters.length ? chapters.sort((a, b) => a.at - b.at) : null;
}

// ---------- MP4 ----------

/** Finds a child atom by walking headers only; returns [bodyOffset, bodyLength]. */
async function findAtom(readAt: ReadAt, from: number, to: number, type: string): Promise<[number, number] | null> {
  let o = from;
  for (let hops = 0; o + 8 <= to && hops < MAX_ATOM_HOPS; hops++) {
    const h = await readAt(o, 16);
    if (h.length < 8) return null;
    let len = u32(h, 0);
    let hdr = 8;
    if (len === 1) { if (h.length < 16) return null; len = u32(h, 8) * 2 ** 32 + u32(h, 12); hdr = 16; }
    else if (len === 0) len = to - o;
    if (len < hdr) return null;
    if (ascii(h, 4, 4) === type) return [o + hdr, len - hdr];
    o += len;
  }
  return null;
}

async function readMp4(readAt: ReadAt, size: number): Promise<Chapter[] | null> {
  const moov = await findAtom(readAt, 0, size, 'moov');
  if (!moov) return null;
  const udta = await findAtom(readAt, moov[0], moov[0] + moov[1], 'udta');
  if (!udta) return null;
  const chpl = await findAtom(readAt, udta[0], udta[0] + udta[1], 'chpl');
  if (!chpl || chpl[1] > MAX_TAG) return null;
  const b = await readAt(chpl[0], chpl[1]);
  // version(1) flags(3), then v1 has a 4-byte reserved field; count is 1 byte (Nero) after that.
  let o = b[0] === 1 ? 8 : 4;
  const count = b[o++];
  const chapters: Chapter[] = [];
  for (let i = 0; i < count && o + 9 <= b.length; i++) {
    const at = (u32(b, o) * 2 ** 32 + u32(b, o + 4)) / 1e7;
    const n = b[o + 8];
    const t = new TextDecoder('utf-8').decode(b.subarray(o + 9, o + 9 + n)).trim();
    chapters.push({ t: t || 'Chapter', at });
    o += 9 + n;
  }
  return chapters.length ? chapters.sort((a, b2) => a.at - b2.at) : null;
}
