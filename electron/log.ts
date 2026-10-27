import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

export interface Logger {
  info(...parts: unknown[]): void;
  warn(...parts: unknown[]): void;
  error(...parts: unknown[]): void;
  /** The file being written. */
  readonly file: string;
}

const text = (part: unknown): string => {
  if (part instanceof Error) return part.stack ?? `${part.name}: ${part.message}`;
  if (typeof part === 'string') return part;
  try { return JSON.stringify(part) ?? String(part); } catch { return String(part); }
};

/**
 * A plain log file in `dir`, rotated when it reaches `maxBytes` (main.log becomes main.1.log, that main.2.log, and
 * the oldest of `keep` is dropped), so it can't grow without bound. Written synchronously: it's few lines, and a line
 * about a crash has to reach the disk before the process goes.
 */
export function createLogger(dir: string, { maxBytes = 1_000_000, keep = 3, now = () => new Date() } = {}): Logger {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'main.log');
  const numbered = (n: number) => path.join(dir, `main.${n}.log`);

  function rotate() {
    rmSync(numbered(keep - 1), { force: true });
    for (let n = keep - 2; n >= 1; n--) { try { renameSync(numbered(n), numbered(n + 1)); } catch { /* not there yet */ } }
    try { renameSync(file, numbered(1)); } catch { /* nothing to move */ }
  }

  const write = (level: string, parts: unknown[]) => {
    try {
      let size = 0;
      try { size = statSync(file).size; } catch { /* a new file */ }
      if (size >= maxBytes) rotate();
      appendFileSync(file, `${now().toISOString()} [${level}] ${parts.map(text).join(' ')}\n`);
    } catch { /* logging must never be the thing that fails */ }
  };

  return { file, info: (...p) => write('info', p), warn: (...p) => write('warn', p), error: (...p) => write('error', p) };
}
