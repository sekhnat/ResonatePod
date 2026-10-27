/**
 * The preferences that have a few fixed choices, and a show's own choices that override them. Earlier versions kept them as
 * the labels the settings screen showed ("1.2×", "Latest 3", "15 / 30 s") and parsed those wherever they were used; they are
 * numbers and names now, and the labels are made where they are shown. The upgrade functions read both forms, so a library
 * saved by any version comes out the same.
 */

export interface Settings {
  /** Episodes kept per show by the automatic download rule. */
  keep: number | 'all';
  /** Downloads at the same time. */
  par: number;
  /** Default playback speed. */
  speed: number;
  /** When played episodes are deleted from disk. */
  del: 'never' | 'day' | 'week';
  /** Seconds the skip buttons move. */
  skip: { back: number; fwd: number };
}

/** What a show sets for itself. A field that is absent follows the setting above, or the global toggle. */
export interface Override {
  dl?: number | 'all' | 'off';
  speed?: number;
  trim?: boolean;
  /** Seconds skipped from the start of every episode. */
  intro?: number;
}

export const DEFAULT_SETTINGS: Settings = { keep: 3, par: 2, speed: 1.2, del: 'week', skip: { back: 15, fwd: 30 } };

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** "1.2×" → 1.2 (undefined for anything that isn't a speed). */
function speedOf(v: unknown): number | undefined {
  if (isPositive(v)) return v;
  if (typeof v !== 'string') return undefined;
  const n = parseFloat(v.replace('×', ''));
  return isPositive(n) ? n : undefined;
}

/** "3" → 3, "All" → "all". */
function keepOf(v: unknown): number | 'all' | undefined {
  if (v === 'all' || v === 'All') return 'all';
  if (isCount(v)) return v;
  return typeof v === 'string' && /^\d+$/.test(v) && isCount(+v) ? +v : undefined;
}

const DEL: Record<string, Settings['del']> = { never: 'never', Never: 'never', day: 'day', '1 day': 'day', week: 'week', '1 week': 'week' };

function skipOf(v: unknown): Settings['skip'] | undefined {
  if (v && typeof v === 'object') {
    const { back, fwd } = v as Record<string, unknown>;
    return isPositive(back) && isPositive(fwd) ? { back, fwd } : undefined;
  }
  const m = typeof v === 'string' ? /^(\d+)\s*\/\s*(\d+)/.exec(v) : null; // "15 / 30 s"
  return m && +m[1] > 0 && +m[2] > 0 ? { back: +m[1], fwd: +m[2] } : undefined;
}

/** The preferences from whatever was saved: labels, numbers, or nothing usable (each field then falls back to its default). */
export function upgradeSettings(saved: unknown): Settings {
  const v = asRecord(saved);
  const par = typeof v.par === 'string' ? +v.par : v.par;
  return {
    keep: keepOf(v.keep) ?? DEFAULT_SETTINGS.keep,
    par: isCount(par) ? par : DEFAULT_SETTINGS.par,
    speed: speedOf(v.speed) ?? DEFAULT_SETTINGS.speed,
    del: (typeof v.del === 'string' ? DEL[v.del] : undefined) ?? DEFAULT_SETTINGS.del,
    skip: skipOf(v.skip) ?? { ...DEFAULT_SETTINGS.skip },
  };
}

function upgradeOverride(saved: unknown): Override {
  const v = asRecord(saved);
  const out: Override = {};
  // dl: "Global" (absent), "Latest 3", "All", "Off"
  const dl = typeof v.dl === 'string' ? /^Latest (\d+)$/.exec(v.dl) : null;
  if (v.dl === 'all' || v.dl === 'All') out.dl = 'all';
  else if (v.dl === 'off' || v.dl === 'Off') out.dl = 'off';
  else if (isCount(v.dl)) out.dl = v.dl;
  else if (dl && isCount(+dl[1])) out.dl = +dl[1];
  // speed: "Global" (absent) or "1.5×"
  const speed = speedOf(v.speed);
  if (speed !== undefined) out.speed = speed;
  // trim: "Global" (absent), "On", "Off"
  if (typeof v.trim === 'boolean') out.trim = v.trim;
  else if (v.trim === 'On') out.trim = true;
  else if (v.trim === 'Off') out.trim = false;
  // intro: "Off" (absent) or "30 s"
  const intro = typeof v.intro === 'string' ? parseInt(v.intro, 10) : v.intro;
  if (isPositive(intro)) out.intro = intro;
  return out;
}

/** The per-show overrides from whatever was saved. A show whose every choice was "Global" has no entry. */
export function upgradeOverrides(saved: unknown): Record<string, Override> {
  const out: Record<string, Override> = {};
  for (const [id, o] of Object.entries(asRecord(saved))) {
    const up = upgradeOverride(o);
    if (Object.keys(up).length) out[id] = up;
  }
  return out;
}
