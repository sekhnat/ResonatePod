"""Move each segment edge in `final` to the best nearby pause in the audio (a long pause beats a closer short one).

Usage: python3 -I snap.py FINGERPRINT_DB TEXT_DB

Edges come from whisper line timestamps (or fingerprint frames), which can be a second or two off. For each edge,
WINDOW seconds either side are decoded and measured in 20 ms frames; a pause is a run of at least MIN_PAUSE of frames
within QUIET dB of the window's quietest level (and below CEIL dBFS). The edge moves to the middle of the best-scoring
pause (see pause_near), or stays where it was when there is none (speech over a music bed). Edges at 0 and at the end stay put.
Adds start_raw / end_raw / snapped to `final` (idempotent: always snaps from the raw edges).
"""
import sqlite3, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np

WINDOW, RATE, FRAME = 2.5, 8000, 160      # seconds each side; 8 kHz; 20 ms frames
QUIET, CEIL, MIN_PAUSE = 6.0, -30.0, 8    # dB above the window floor; absolute ceiling; frames (160 ms)
LAMBDA = 0.2                              # score lost per second of distance from the original edge


def pause_near(path, t):
    a = max(0.0, t - WINDOW)
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{a:.3f}', '-t', f'{2 * WINDOW:.3f}', '-i', path, '-vn',
                          '-ac', '1', '-ar', str(RATE), '-f', 's16le', '-'], capture_output=True).stdout
    x = np.frombuffer(raw, '<i2').astype(np.float32) / 32768
    n = len(x) // FRAME
    if n < MIN_PAUSE * 2: return None
    db = 20 * np.log10(np.sqrt((x[:n * FRAME].reshape(n, FRAME) ** 2).mean(1)) + 1e-6)
    quiet = (db <= min(CEIL, np.percentile(db, 5) + QUIET)).astype(np.int8)
    d = np.diff(np.r_[0, quiet, 0]); starts, ends = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
    # Prefer a long pause (a sentence break) over the nearest short one (a breath between words): scored on
    # snapeval, 200 random edges against whisper DTW word onsets, this cut through fluent speech 4.5% of the time,
    # against 5.1% for the nearest pause and 6.2% for the unsnapped edge.
    best, score = None, None
    for s, e in zip(starts, ends):
        if e - s < MIN_PAUSE: continue
        c = a + (s + e) / 2 * FRAME / RATE
        if abs(c - t) > WINDOW: continue
        sc = min((e - s) * FRAME / RATE, 1.0) - LAMBDA * abs(c - t)
        if score is None or sc > score: best, score = c, sc
    return best


def main():
    fp = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True); db = sqlite3.connect(sys.argv[2])
    cols = {r[1] for r in db.execute('PRAGMA table_info(final)')}
    if 'start_raw' not in cols:
        db.executescript('ALTER TABLE final ADD COLUMN start_raw REAL; ALTER TABLE final ADD COLUMN end_raw REAL;'
                         'ALTER TABLE final ADD COLUMN snapped INTEGER; UPDATE final SET start_raw = start, end_raw = end;')
    db.execute('UPDATE final SET start_raw = start WHERE start_raw IS NULL'); db.execute('UPDATE final SET end_raw = end WHERE end_raw IS NULL')
    path = dict(fp.execute('SELECT id, path FROM episodes')); dur = dict(db.execute('SELECT ep, duration FROM ep_text'))
    rows = db.execute("SELECT rowid, ep, start_raw, end_raw FROM final WHERE category != 'content' ORDER BY ep, start_raw").fetchall()
    jobs = {}
    for rid, ep, s, e in rows:
        if s > 0.5: jobs[(ep, s)] = None
        if e < dur[ep] - 0.5: jobs[(ep, e)] = None
    t0 = time.time()
    with ThreadPoolExecutor(8) as pool:
        for k, v in zip(jobs, pool.map(lambda k: pause_near(path[k[0]], k[1]), jobs)): jobs[k] = v
    moved, shifts, out = 0, [], []
    prev_end = {}; seen = set()
    for rid, ep, s, e in rows:
        ns = jobs.get((ep, s)) or s; ne = jobs.get((ep, e)) or e
        ns = max(ns, prev_end.get(ep, 0.0)) if ns != s else ns    # never back over the previous segment
        if ne - ns < 1.0: ns, ne = s, e                           # a snap that collapses the segment is ignored
        prev_end[ep] = ne
        flag = (ns != s) + 2 * (ne != e)
        for old, new in ((s, ns), (e, ne)):
            if new != old and (ep, old) not in seen: moved += 1; shifts.append(new - old)
            seen.add((ep, old))
        out.append((ns, ne, flag, rid))
    db.executemany('UPDATE final SET start = ?, end = ?, snapped = ? WHERE rowid = ?', out); db.commit()
    sh = np.abs(np.array(shifts)) if shifts else np.zeros(1)
    print(f'{len(jobs):,} edges measured in {time.time()-t0:.0f}s; {moved:,} moved ({100*moved/max(1,len(jobs)):.0f}%), '
          f'{len(jobs)-moved:,} had no pause nearby; shift median {np.median(sh):.2f}s, p90 {np.percentile(sh,90):.2f}s')


if __name__ == '__main__':
    main()
