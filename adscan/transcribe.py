"""Transcribe the repeated spans match.py found, with whisper.cpp, once per distinct piece of audio.

Usage: python3 -I transcribe.py DB_PATH WORK_DIR [--dry-run] [--batch N]

Spans that verified as the same audio (a match covering >= 80% of both) share one transcript:
the longest is transcribed and the rest point at it. Transcripts live in `span_text`, keyed by
(episode, start, end) rather than by span row, so re-running match.py doesn't throw them away;
anything already transcribed is skipped. WORK_DIR holds temporary WAVs and is emptied per batch.
"""
import argparse, json, os, sqlite3, subprocess, sys, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

SAME = 0.8          # a match must cover this share of both spans for them to count as the same audio
MAX_SECONDS = 600   # transcribe at most this much of one span (long "shared" spans are content anyway)
MODEL = os.path.expanduser('~/Documents/Projects/WhisperExperiments/whisper.cpp/models/ggml-large-v3-turbo.bin')
WHISPER = 'whisper-cli'   # called directly: the `whisper` wrapper mistakes -mc for a model flag
FLAGS = ['-l', 'en', '-np', '-oj', '-mc', '0']  # -mc 0: no carried-over context, as in transcribe_full.py


def gpu_busy():
    """The PS5 emulator holds the GPU; wait for it instead of competing (same as transcribe_full.py)."""
    return subprocess.run(['pgrep', '-x', 'kyty_emulator'], capture_output=True).returncode == 0


def plan(db):
    spans = db.execute('SELECT rowid, ep, start, end FROM spans').fetchall()
    by_ep = defaultdict(list)
    for rid, ep, s, e in spans: by_ep[ep].append((s, e, rid))
    length = {rid: e - s for rid, _, s, e in spans}

    def owner(ep, s, e):
        best, ov = None, 0
        for ss, ee, rid in by_ep.get(ep, ()):
            o = min(e, ee) - max(s, ss)
            if o > ov: best, ov = rid, o
        return best

    same = defaultdict(set)
    for a, sa, ea, b, sb, eb in db.execute('SELECT a, a_start, a_end, b, b_start, b_end FROM matches'):
        ra, rb = owner(a, sa, ea), owner(b, sb, eb)
        if ra and rb and (ea - sa) >= SAME * length[ra] and (eb - sb) >= SAME * length[rb]:
            same[ra].add(rb); same[rb].add(ra)
    source = {}
    for rid in sorted(length, key=lambda r: -length[r]):
        if rid in source: continue
        source[rid] = rid
        for other in same[rid]: source.setdefault(other, rid)
    info = {rid: (ep, s, e) for rid, ep, s, e in spans}
    return info, source


def cut(path, start, end, dst):
    dur = min(end - start, MAX_SECONDS)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.3f}', '-t', f'{dur:.3f}', '-i', path,
                    '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', dst], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('db'); ap.add_argument('work'); ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--batch', type=int, default=150)
    a = ap.parse_args()
    db = sqlite3.connect(a.db)
    db.executescript("""
      CREATE TABLE IF NOT EXISTS span_text (
        ep INTEGER NOT NULL, start REAL NOT NULL, end REAL NOT NULL,
        text TEXT NOT NULL, segments TEXT NOT NULL,   -- JSON [[from_s, to_s, text], ...] relative to start
        model TEXT, done_at INTEGER,
        PRIMARY KEY (ep, start, end));
      CREATE TABLE IF NOT EXISTS span_source (span_rowid INTEGER PRIMARY KEY, ep INTEGER, start REAL, end REAL);
    """)
    info, source = plan(db)
    db.execute('DELETE FROM span_source')
    db.executemany('INSERT INTO span_source VALUES (?,?,?,?)', [(rid, *info[src]) for rid, src in source.items()])
    db.commit()
    have = {(ep, s, e) for ep, s, e in db.execute('SELECT ep, start, end FROM span_text')}
    todo = sorted({info[src] for src in source.values()} - have)
    secs = sum(min(e - s, MAX_SECONDS) for _, s, e in todo)
    print(f'{len(info):,} spans -> {len(set(source.values())):,} distinct; {len(todo):,} to transcribe, '
          f'{secs/3600:.1f} h of audio', flush=True)
    if a.dry_run: return

    paths = dict(db.execute('SELECT id, path FROM episodes'))
    os.makedirs(a.work, exist_ok=True); t0 = time.time(); done = 0
    for i in range(0, len(todo), a.batch):
        batch = todo[i:i + a.batch]
        wavs = [os.path.join(a.work, f'{n:05}.wav') for n in range(len(batch))]
        with ThreadPoolExecutor(8) as pool:
            list(pool.map(lambda x: cut(paths[x[0][0]], x[0][1], x[0][2], x[1]), zip(batch, wavs)))
        while gpu_busy():
            print(f'  emulator running, paused ({time.strftime("%H:%M")})', flush=True); time.sleep(300)
        args = ['nice', '-n', '10', WHISPER, '-m', MODEL] + FLAGS
        for w in wavs: args += ['-f', w]
        subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        rows = []
        for (ep, s, e), w in zip(batch, wavs):
            try:
                d = json.load(open(w + '.json', encoding='utf-8', errors='replace'))
            except FileNotFoundError:
                continue
            segs = [[x['offsets']['from'] / 1000, x['offsets']['to'] / 1000, x['text'].strip()] for x in d.get('transcription', [])]
            rows.append((ep, s, e, ' '.join(t for _, _, t in segs if t).strip(), json.dumps(segs),
                         os.path.basename(d.get('model', {}).get('type', '') or 'large-v3-turbo'), int(time.time())))
        db.executemany('INSERT OR REPLACE INTO span_text VALUES (?,?,?,?,?,?,?)', rows); db.commit()
        for f in os.listdir(a.work): os.remove(os.path.join(a.work, f))
        done += len(batch)
        print(f'  {done:,}/{len(todo):,} spans, {time.time()-t0:.0f}s', flush=True)
    print(f'DONE in {time.time()-t0:.0f}s', flush=True)


if __name__ == '__main__':
    main()
