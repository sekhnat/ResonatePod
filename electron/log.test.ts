// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from './log';

let dir: string;
const at = new Date('2026-10-28T12:00:00.123Z');
beforeEach(() => { dir = path.join(mkdtempSync(path.join(tmpdir(), 'res-log-')), 'logs'); });

describe('the log file', () => {
  it('is made, with a line for each message: time, level, then what was said', () => {
    const log = createLogger(dir, { now: () => at });
    log.info('started', 'twice');
    log.warn({ shows: 3 });
    log.error(new Error('boom'));
    const lines = readFileSync(log.file, 'utf8').trim().split('\n');
    expect(lines[0]).toBe('2026-10-28T12:00:00.123Z [info] started twice');
    expect(lines[1]).toBe('2026-10-28T12:00:00.123Z [warn] {"shows":3}');
    expect(lines[2]).toMatch(/^2026-10-28T12:00:00\.123Z \[error\] Error: boom\n?/);
    expect(readFileSync(log.file, 'utf8')).toContain('at '); // the stack came with it
  });

  it('rotates when it is full, and keeps only as many old files as asked', () => {
    const log = createLogger(dir, { maxBytes: 200, keep: 3, now: () => at });
    for (let i = 0; i < 40; i++) log.info(`message number ${i} to fill the file`);
    expect(readdirSync(dir).sort()).toEqual(['main.1.log', 'main.2.log', 'main.log']);
    const newest = readFileSync(log.file, 'utf8');
    const older = readFileSync(path.join(dir, 'main.1.log'), 'utf8');
    expect(newest).toContain('message number 39');
    expect(older).not.toContain('message number 39');
    expect(readFileSync(path.join(dir, 'main.2.log'), 'utf8')).not.toContain('message number 0 ');
    expect(Math.max(...readdirSync(dir).map((f) => readFileSync(path.join(dir, f)).length))).toBeLessThan(400);
  });

  it('copes with values that can not be written as JSON, and never throws', () => {
    const log = createLogger(dir, { now: () => at });
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => log.warn(loop, 10n, undefined, Symbol('s'))).not.toThrow();
    expect(readFileSync(log.file, 'utf8')).toContain('[warn]');
  });

  it('carries on when the folder has gone', () => {
    const log = createLogger(dir);
    expect(() => log.info('first')).not.toThrow();
  });
});
