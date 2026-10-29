import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { expandHome } from './downloads';
import { readJsonFile, writeFileAtomic, serialised } from './files';

/** `p` with symlinks resolved as far as it exists; a path that isn't there yet keeps its remaining tail. */
async function realPath(p: string): Promise<string> {
  const tail: string[] = [];
  for (let cur = path.resolve(p); ; ) {
    try {
      return path.join(await fs.realpath(cur), ...tail.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** Whether `target` is `root` or lives under it, once `..` and symlinks are taken into account. */
export async function isWithin(root: string, target: string): Promise<boolean> {
  const rel = path.relative(await realPath(root), await realPath(target));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** The download roots recorded in a saved library: its folder setting, and where its downloaded files sit. */
export function rootsFromLibrary(json: string | null): string[] {
  let state: { folder?: unknown; eps?: Record<string, { file?: unknown }> } | undefined;
  try { state = json ? JSON.parse(json).state : undefined; } catch { return []; }
  const out = new Set<string>();
  if (typeof state?.folder === 'string') out.add(path.resolve(expandHome(state.folder)));
  // Files are <root>/<Show>/<name>; folders the user left behind when changing the setting still hold some.
  for (const e of Object.values(state?.eps ?? {})) {
    if (typeof e?.file !== 'string' || !path.isAbsolute(e.file)) continue;
    const root = path.dirname(path.dirname(e.file));
    if (root !== path.dirname(root) && root !== homedir()) out.add(root);
  }
  return [...out];
}

/**
 * The folders the renderer may read, delete and download into. The only ways to grow the list are the
 * native folder dialog and the one-time adoption of what an older library already used, so a compromised
 * renderer can't point the file bridge at the rest of the disk.
 */
export class DownloadRoots {
  private roots: string[] = [];
  /** Settles when the list has been read; resolve() and add() wait for it, so the app can start before the read ends. */
  private ready: Promise<void> = Promise.resolve();

  constructor(private file: string, private fallback: string) {}

  list() { return [...this.roots]; }

  /** Reads the saved list; without one, starts from the default folder plus whatever `adopt` finds. */
  load(adopt: () => Promise<string[]>): Promise<void> {
    const loading = this.read(adopt);
    this.ready = loading.catch(() => {}); // a failed read leaves the list empty, which allows nothing
    return loading;
  }

  private async read(adopt: () => Promise<string[]>) {
    const saved = (await readJsonFile<{ downloadRoots?: unknown }>(this.file, {})).downloadRoots; // an unreadable file is kept aside
    if (Array.isArray(saved) && saved.every((r) => typeof r === 'string')) { this.roots = saved; return; }
    this.roots = [...new Set([path.resolve(expandHome(this.fallback)), ...(await adopt())])];
    await this.save();
  }

  async add(folder: string) {
    await this.ready;
    const abs = path.resolve(expandHome(folder));
    if (this.roots.includes(abs)) return;
    this.roots.push(abs);
    await this.save();
  }

  /** The absolute, normalised path to use when `p` is inside a root; null otherwise. Callers must use what it returns. */
  async resolve(p: unknown): Promise<string | null> {
    if (typeof p !== 'string' || !p) return null;
    await this.ready;
    const abs = path.resolve(expandHome(p));
    for (const root of this.roots) if (await isWithin(root, abs)) return abs;
    return null;
  }

  private async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const text = JSON.stringify({ downloadRoots: this.roots });
    await serialised(this.file, () => writeFileAtomic(this.file, text));
  }
}
