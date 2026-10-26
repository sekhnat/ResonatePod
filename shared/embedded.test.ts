import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readEmbeddedChapters, type ReadAt } from './embedded';

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const safe32 = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
const bytes = (s: string) => [...Buffer.from(s, 'latin1')];

function frame(id: string, data: number[], version: number) {
  return [...bytes(id), ...(version === 4 ? safe32(data.length) : be32(data.length)), 0, 0, ...data];
}
function text(enc: number, s: string) {
  if (enc === 1) return [1, 0xff, 0xfe, ...Buffer.from(s, 'utf16le')];
  return [enc, ...Buffer.from(s, enc === 3 ? 'utf8' : 'latin1')];
}
function id3(version: number, chapters: [string, number, number][]) {
  const body = chapters.flatMap(([title, ms, enc], i) =>
    frame('CHAP', [...bytes(`ch${i}`), 0, ...be32(ms), ...be32(ms + 1000), ...be32(0xffffffff), ...be32(0xffffffff), ...frame('TIT2', text(enc, title), version)], version));
  const tag = [...frame('TSSE', text(0, 'Lavf'), version), ...body, ...new Array(64).fill(0)];
  return new Uint8Array([...bytes('ID3'), version, 0, 0, ...safe32(tag.length), ...tag, ...new Array(2000).fill(0xff)]);
}
function atom(type: string, body: number[]) { return [...be32(body.length + 8), ...bytes(type), ...body]; }

/** Serves a buffer and records every range asked for. */
function reader(buf: Uint8Array) {
  const asked: [number, number][] = [];
  const readAt: ReadAt = async (o, n) => { asked.push([o, n]); return buf.subarray(o, o + n); };
  return { readAt, asked };
}

describe('embedded chapters', () => {
  it.each([3, 4])('reads ID3v2.%i CHAP frames in every text encoding', async (v) => {
    const { readAt } = reader(id3(v, [['Intro', 0, 0], ['Café talk', 61500, 3], ['日本語', 120000, 1]]));
    expect(await readEmbeddedChapters(readAt, 0)).toEqual([
      { t: 'Intro', at: 0 }, { t: 'Café talk', at: 61.5 }, { t: '日本語', at: 120 },
    ]);
  });

  it('returns null for a tag without chapters or a non-media file', async () => {
    expect(await readEmbeddedChapters(reader(id3(3, [])).readAt, 0)).toBeNull();
    expect(await readEmbeddedChapters(reader(new Uint8Array(Buffer.from('<html>not audio</html>'))).readAt, 0)).toBeNull();
  });

  it('reads Nero chpl from an MP4 whose moov comes after mdat, without reading mdat', async () => {
    const title = (s: string) => [Buffer.byteLength(s), ...Buffer.from(s)];
    const chpl = atom('chpl', [1, 0, 0, 0, 0, 0, 0, 0, 2,
      ...be32(0), ...be32(0), ...title('Start'),
      ...be32(0), ...be32(90 * 1e7), ...title('Ninety')]);
    const mdatLen = 5_000_000;
    const head = [...atom('ftyp', bytes('M4A mp42isom')), ...be32(mdatLen + 8), ...bytes('mdat')];
    const moov = atom('moov', [...atom('mvhd', new Array(100).fill(0)), ...atom('udta', chpl)]);
    const buf = new Uint8Array(head.length + mdatLen + moov.length);
    buf.set(head);
    buf.set(moov, head.length + mdatLen);
    const { readAt, asked } = reader(buf);
    expect(await readEmbeddedChapters(readAt, buf.length)).toEqual([{ t: 'Start', at: 0 }, { t: 'Ninety', at: 90 }]);
    expect(Math.max(...asked.map(([, n]) => n))).toBeLessThan(1000);
  });

  it.each(['mp3', 'm4a'])('reads the chapters ffmpeg writes into an .%s file', async (ext) => {
    const buf = new Uint8Array(readFileSync(`test/fixtures/chapters.${ext}`));
    expect(await readEmbeddedChapters(reader(buf).readAt, buf.length)).toEqual([{ t: 'Cold open', at: 0 }, { t: 'Listener mail', at: 2 }]);
  });
});
