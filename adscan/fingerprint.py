"""Fingerprint every downloaded episode with Chromaprint (fpcalc) into a SQLite database.

Usage: python3 -I fingerprint.py PODCASTS_DIR DB_PATH [LIBRARY_DB] [--workers N]

Goes show by show (one folder at a time), printing a line per show. Resumable: a file
whose size and mtime match what's stored is skipped. Partial downloads (*.part) are ignored.
LIBRARY_DB (a copy of Resonate's library.db) is optional and links files to episode keys.
"""
import argparse, array, json, os, sqlite3, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCHEMA = """
CREATE TABLE IF NOT EXISTS episodes (
  id        INTEGER PRIMARY KEY,
  show      TEXT NOT NULL,            -- folder name under the podcasts dir
  path      TEXT NOT NULL UNIQUE,
  ep_key    TEXT,                     -- Resonate's "show-id:guid", when known
  size      INTEGER NOT NULL,
  mtime     REAL NOT NULL,
  duration  REAL,                     -- seconds, as fpcalc decoded it
  frames    INTEGER,                  -- number of 32-bit sub-fingerprints
  fp        BLOB,                     -- little-endian uint32[frames]; one per ~0.1238 s
  error     TEXT,
  done_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS episodes_show ON episodes (show);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

# Chromaprint's default algorithm: 11025 Hz, 4096-sample frames, 1/3 overlap -> 4096/3/11025 s per item.
ITEM_SECONDS = 4096 / 3 / 11025


def fingerprint(path):
    try:
        out = subprocess.run(['fpcalc', '-raw', '-length', '0', '-json', path],
                             capture_output=True, text=True, timeout=600)
        if out.returncode != 0 and not out.stdout.strip():
            return None, None, (out.stderr.strip() or f'fpcalc exited {out.returncode}')[:500]
        d = json.loads(out.stdout)
        fp = array.array('I', (x & 0xFFFFFFFF for x in d['fingerprint']))
        if sys.byteorder != 'little': fp.byteswap()
        return float(d['duration']), fp, None
    except Exception as e:  # timeout, bad JSON, ...
        return None, None, f'{type(e).__name__}: {e}'[:500]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root'); ap.add_argument('db'); ap.add_argument('library', nargs='?')
    ap.add_argument('--workers', type=int, default=8)
    a = ap.parse_args()

    keys = {}
    if a.library:
        lib = sqlite3.connect(f'file:{a.library}?mode=ro', uri=True)
        keys = {f: k for k, f in lib.execute('SELECT key, file FROM ep_state WHERE file IS NOT NULL')}
        lib.close()

    db = sqlite3.connect(a.db)
    db.executescript(SCHEMA)
    db.execute("INSERT OR REPLACE INTO meta VALUES ('item_seconds', ?)", (repr(ITEM_SECONDS),))
    db.execute("INSERT OR REPLACE INTO meta VALUES ('fpcalc', ?)",
               (subprocess.run(['fpcalc', '-version'], capture_output=True, text=True).stdout.strip(),))
    db.commit()
    known = {p: (s, m) for p, s, m in db.execute('SELECT path, size, mtime FROM episodes WHERE error IS NULL')}

    shows = sorted(d for d in os.listdir(a.root) if os.path.isdir(os.path.join(a.root, d)) and not d.startswith('.'))
    t_all = time.time(); total = done = skipped = failed = 0
    with ThreadPoolExecutor(a.workers) as pool:
        for i, show in enumerate(shows, 1):
            folder = os.path.join(a.root, show)
            files = sorted(f for f in os.listdir(folder) if f.lower().endswith(('.mp3', '.m4a', '.mp4', '.ogg', '.opus', '.aac')))
            todo = []
            for f in files:
                p = os.path.join(folder, f); st = os.stat(p)
                if known.get(p) == (st.st_size, st.st_mtime): skipped += 1; continue
                todo.append((p, st))
            t0 = time.time(); errs = 0; secs = 0.0
            futs = {pool.submit(fingerprint, p): (p, st) for p, st in todo}
            for fut in as_completed(futs):
                p, st = futs[fut]
                dur, fp, err = fut.result()
                if err: errs += 1
                else: secs += dur
                db.execute('INSERT OR REPLACE INTO episodes (show, path, ep_key, size, mtime, duration, frames, fp, error, done_at) '
                           'VALUES (?,?,?,?,?,?,?,?,?,?)',
                           (show, p, keys.get(p), st.st_size, st.st_mtime, dur, len(fp) if fp else None,
                            fp.tobytes() if fp else None, err, int(time.time())))
            db.commit()
            total += len(files); done += len(todo) - errs; failed += errs
            print(f'[{i:2}/{len(shows)}] {show[:55]:55} {len(files):4} files, {len(todo):4} new, '
                  f'{errs} failed, {secs/3600:6.1f} h audio in {time.time()-t0:5.1f}s', flush=True)
    print(f'DONE {total} files: {done} fingerprinted, {skipped} already done, {failed} failed, '
          f'{time.time()-t_all:.0f}s total', flush=True)


if __name__ == '__main__':
    main()
