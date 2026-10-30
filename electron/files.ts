import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';

let tmpCounter = 0;
const tmpName = (file: string) => `${file}.tmp-${process.pid}-${++tmpCounter}`;

/** Writes through a temporary file of its own name and a rename, so a crash leaves the old file or the new one, never half of one. */
export async function writeFileAtomic(file: string, data: string | Uint8Array, mode?: number): Promise<void> {
  const tmp = tmpName(file);
  try {
    await fs.writeFile(tmp, data, { mode });
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export function writeFileAtomicSync(file: string, data: string, mode?: number): void {
  const tmp = tmpName(file);
  try {
    writeFileSync(tmp, data, { mode });
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

const queues = new Map<string, Promise<unknown>>();

/** Runs `job` after everything already queued for `file`, one at a time; a job that fails doesn't hold up the next. */
export function serialised<T>(file: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(file) ?? Promise.resolve()).then(job, job);
  queues.set(file, run.catch(() => {}));
  return run;
}

/**
 * A JSON file's contents, or `fallback` when there is none. A file that exists but can't be read as JSON is kept,
 * renamed, not left to be overwritten by the next write, which would destroy what might still be recovered.
 */
export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  let text: string;
  try { text = await fs.readFile(file, 'utf8'); } catch { return fallback; }
  try {
    return JSON.parse(text) as T;
  } catch {
    const aside = `${file}.damaged-${Date.now()}`;
    console.warn(`${file} could not be read; kept as ${aside}`);
    await fs.rename(file, aside).catch(() => {});
    return fallback;
  }
}

/** Changes a JSON file: reads it, applies `change` and writes it back atomically, with other changes to it waiting their turn. */
export function updateJsonFile<T>(file: string, fallback: T, change: (current: T) => T, mode?: number): Promise<void> {
  return serialised(file, async () => {
    const next = change(await readJsonFile(file, fallback));
    await writeFileAtomic(file, JSON.stringify(next), mode);
  });
}
