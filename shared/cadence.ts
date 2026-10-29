import type { Episode } from './types';

/** Rough release cadence from the gaps between recent episodes. */
export function cadence(episodes: Pick<Episode, 'pubDate'>[]): string {
  const ds = episodes.map((e) => e.pubDate).filter(Boolean).slice(0, 7);
  if (ds.length < 3) return 'Occasional';
  const gaps = ds.slice(1).map((d, i) => (ds[i] - d) / 86400000).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median <= 1.5) return 'Daily';
  if (median <= 9) return 'Weekly';
  if (median <= 18) return 'Fortnightly';
  if (median <= 40) return 'Monthly';
  return 'Occasional';
}
