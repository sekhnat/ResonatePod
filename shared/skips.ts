/**
 * Skip segments: stretches of a downloaded episode (ads, promos, credits ...) that playback jumps over. They come from
 * a segments file made outside the app (see README) and belong to the exact file they were measured on: with dynamic
 * ad insertion another download of the same episode has different audio, so a set is used only while the episode's
 * file is still the one it names. Nothing here touches audio; playback seeks.
 */

export const SKIP_CATEGORIES = ['sponsor', 'promo', 'selfpromo', 'bumper', 'intro', 'outro', 'recap'] as const;
export type SkipCategory = (typeof SKIP_CATEGORIES)[number];

/** Skipped without asking unless the person changes it: the ones that are advertising. */
export const DEFAULT_AUTO_SKIP: SkipCategory[] = ['sponsor', 'promo', 'selfpromo', 'bumper'];

export const SKIP_LABELS: Record<SkipCategory, string> = {
  sponsor: 'Sponsor', promo: 'Promotion', selfpromo: 'Self-promotion', bumper: 'Break bumper',
  intro: 'Intro', outro: 'Credits', recap: 'Recap',
};
export const SKIP_HINTS: Record<SkipCategory, string> = {
  sponsor: 'Paid ads read in or inserted into the episode',
  promo: 'Trailers and ads for other shows, books and games',
  selfpromo: 'The show’s own Patreon, merch and “rate and review” asks',
  bumper: '“We’ll be right back” and the like',
  intro: 'Title cards, theme songs, content warnings',
  outro: 'End credits',
  recap: '“Previously on…”',
};

export interface SkipSegment {
  /** Seconds into the file. */
  start: number;
  end: number;
  cat: SkipCategory;
}

/** An episode's segments and the file they were measured on. */
export interface SkipSet {
  file: string;
  /** The file's size when the segments were added, when it was known: a different size means a different file. */
  bytes?: number;
  segs: SkipSegment[];
}

const MAX_SEGMENTS = 200;
const MIN_LENGTH = 1;

const isCat = (v: unknown): v is SkipCategory => typeof v === 'string' && (SKIP_CATEGORIES as readonly string[]).includes(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * An episode's segments from untrusted input: anything malformed is dropped, the rest sorted, overlaps of one
 * category joined, and the count capped. Segments of different categories may touch but not overlap; where they do,
 * the later one starts when the earlier ends.
 */
export function cleanSegments(raw: unknown): SkipSegment[] {
  if (!Array.isArray(raw)) return [];
  const segs: SkipSegment[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const { start, end } = r as Record<string, unknown>;
    const cat = (r as Record<string, unknown>).cat ?? (r as Record<string, unknown>).category;
    if (!isTime(start) || !isTime(end) || !isCat(cat) || end - start < MIN_LENGTH) continue;
    segs.push({ start, end, cat });
  }
  segs.sort((a, b) => a.start - b.start || a.end - b.end);
  const out: SkipSegment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      if (s.cat === last.cat) { last.end = Math.max(last.end, s.end); continue; }
      if (s.end - last.end < MIN_LENGTH) continue;
      out.push({ ...s, start: last.end });
      continue;
    }
    out.push({ ...s });
  }
  return out.slice(0, MAX_SEGMENTS);
}

/** Whether `v` is a segment set as stored (for checking backups). */
export function isSkipSet(v: unknown): v is SkipSet {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return typeof s.file === 'string' && (s.bytes === undefined || isTime(s.bytes)) && Array.isArray(s.segs)
    && s.segs.every((x) => !!x && typeof x === 'object' && isTime((x as SkipSegment).start) && isTime((x as SkipSegment).end) && isCat((x as SkipSegment).cat));
}

/**
 * A segments file: `{ "<file path>": { "segments": [{ "start": s, "end": s, "category": "sponsor" }, ...] }, ... }`.
 * Returns each path's cleaned segments (paths without any are left out); throws when it isn't such a file at all.
 */
export function parseSkipFile(text: string): Map<string, SkipSegment[]> {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error('it isn’t JSON'); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('it isn’t a segments file');
  const out = new Map<string, SkipSegment[]>();
  for (const [path, entry] of Object.entries(json as Record<string, unknown>)) {
    if (!path.startsWith('/') || !entry || typeof entry !== 'object') continue;
    const segs = cleanSegments((entry as Record<string, unknown>).segments);
    if (segs.length) out.set(path, segs);
  }
  return out;
}

/** How far into a segment playback may already be and still count as having just reached it (timeupdate is ~4 Hz). */
const ENTER_WINDOW = 1;
/** Not worth a jump: the segment is all but over. */
const TAIL = 0.5;
/** A bigger step between two positions is a seek, not playback (timeupdate moves ~0.5 s at 2x). */
const MAX_STEP = 3;

/**
 * The segment to jump over now, if any: one of an `enabled` category that playback has just entered, moving forward
 * from `prev` (null right after the episode loaded) to `now`. A seek isn't playback, so seeking into a segment doesn't
 * count as entering it and a person who goes back to listen isn't thrown forward again; nor is one in `allowed`
 * (undone). After jumping, the caller passes the jump's target as `prev`, so a segment that starts there follows.
 */
export function skipAt(segs: readonly SkipSegment[], enabled: ReadonlySet<SkipCategory>, prev: number | null, now: number,
  allowed: ReadonlySet<SkipSegment> = new Set()): SkipSegment | null {
  for (const s of segs) {
    if (s.start > now) break;
    if (now >= s.end - TAIL || !enabled.has(s.cat) || allowed.has(s)) continue;
    const entered = prev === null ? now - s.start < ENTER_WINDOW : prev < s.start + ENTER_WINDOW && prev <= now && now - prev < MAX_STEP;
    if (entered) return s;
  }
  return null;
}

/** The segment playback is in, if any. */
export function activeSegment(segs: readonly SkipSegment[], now: number): SkipSegment | null {
  for (const s of segs) {
    if (s.start > now) break;
    if (now < s.end) return s;
  }
  return null;
}
