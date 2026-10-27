// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readJsonFile, serialised, updateJsonFile, writeFileAtomic, writeFileAtomicSync } from './files';

let dir: string;
let file: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'res-files-')); file = path.join(dir, 'state.json'); });

describe('writing a file', () => {
  it('replaces it whole, leaving no temporary file, and keeps the mode asked for', async () => {
    await writeFileAtomic(file, '{"a":1}', 0o600);
    await writeFileAtomic(file, '{"a":2}', 0o600);
    expect(readFileSync(file, 'utf8')).toBe('{"a":2}');
    expect(readdirSync(dir)).toEqual(['state.json']);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    writeFileAtomicSync(file, '{"a":3}');
    expect(readFileSync(file, 'utf8')).toBe('{"a":3}');
    expect(readdirSync(dir)).toEqual(['state.json']);
  });

  it('uses a temporary file of its own for each write, so overlapping writes do not mix', async () => {
    const writes = Array.from({ length: 30 }, (_, i) => writeFileAtomic(file, JSON.stringify({ i, pad: 'x'.repeat(50_000) })));
    await Promise.all(writes);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.pad).toHaveLength(50_000); // one whole write, not an interleaving
    expect(readdirSync(dir)).toEqual(['state.json']);
  });

  it('cleans up after a write that fails', async () => {
    await expect(writeFileAtomic(path.join(dir, 'missing', 'state.json'), 'x')).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('changing a file', () => {
  it('loses none of a hundred changes made at once', async () => {
    await Promise.all(Array.from({ length: 100 }, () => updateJsonFile(file, { n: 0 }, (cur) => ({ n: cur.n + 1 }))));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ n: 100 });
    expect(readdirSync(dir)).toEqual(['state.json']);
  });

  it('does not let one failed change hold up the next', async () => {
    const failing = updateJsonFile(file, { n: 0 }, () => { throw new Error('nope'); });
    await expect(failing).rejects.toThrow('nope');
    await updateJsonFile(file, { n: 0 }, (cur) => ({ n: cur.n + 1 }));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ n: 1 });
  });

  it('runs jobs for one file in order, and different files side by side', async () => {
    const order: string[] = [];
    const slow = serialised('a', async () => { await new Promise((ok) => setTimeout(ok, 30)); order.push('a1'); });
    const next = serialised('a', async () => { order.push('a2'); });
    const other = serialised('b', async () => { order.push('b'); });
    await Promise.all([slow, next, other]);
    expect(order).toEqual(['b', 'a1', 'a2']);
  });
});

describe('reading a file', () => {
  it('gives the fallback for a file that is not there', async () => {
    expect(await readJsonFile(file, { none: true })).toEqual({ none: true });
  });

  it('keeps a file it cannot read, and does not let the next write destroy it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(file, '{"secret": "half writ');
    expect(await readJsonFile(file, { fresh: true })).toEqual({ fresh: true });
    const damaged = readdirSync(dir).filter((f) => f.startsWith('state.json.damaged-'));
    expect(damaged).toHaveLength(1);
    expect(readFileSync(path.join(dir, damaged[0]), 'utf8')).toBe('{"secret": "half writ');
    expect(existsSync(file)).toBe(false);
    await updateJsonFile(file, { fresh: true }, (cur) => ({ ...cur, more: 1 }));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ fresh: true, more: 1 });
    expect(readdirSync(dir).filter((f) => f.startsWith('state.json.damaged-'))).toHaveLength(1);
    warn.mockRestore();
  });
});
