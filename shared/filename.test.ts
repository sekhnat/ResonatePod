import { describe, expect, it } from 'vitest';
import { fileDate, fileStem, safeName, shortHash } from './filename';

describe('file names', () => {
  it('cleans free text into one safe path segment', () => {
    expect(safeName('Kernel: Panic/Hour')).toBe('Kernel Panic Hour');
    expect(safeName('  a   b  ')).toBe('a b');
    expect(safeName('x'.repeat(200))).toHaveLength(120);
    for (const dots of ['', ' ', '.', '..', '...', ' .. ', '/']) expect(safeName(dots)).toBe('untitled');
    expect(safeName('.hidden..show')).toBe('.hidden..show');
  });

  it('dates files in UTC, and calls an unusable date "undated"', () => {
    expect(fileDate(Date.UTC(2026, 9, 19, 23, 59))).toBe('2026-10-19');
    for (const bad of [0, NaN, Infinity, 8.64e15 + 1]) expect(fileDate(bad)).toBe('undated');
  });

  it('hashes to six stable hex digits', () => {
    expect(shortHash('kp:ep:42')).toMatch(/^[0-9a-f]{6}$/);
    expect(shortHash('kp:ep:42')).toBe(shortHash('kp:ep:42'));
    expect(shortHash('kp:ep:42')).not.toBe(shortHash('kp:ep:43'));
  });

  it('tags the stem only when asked', () => {
    const day = Date.UTC(2026, 9, 19);
    expect(fileStem(day, 'Wayland?')).toBe('2026-10-19 - Wayland');
    expect(fileStem(day, 'Wayland?', 'a1b2c3')).toBe('2026-10-19 - Wayland [a1b2c3]');
    expect(fileStem(day, 'Wayland?', '../../x')).toBe('2026-10-19 - Wayland [x]');
    expect(fileStem(day, 'Wayland?', '../..')).toBe('2026-10-19 - Wayland');
  });
});
