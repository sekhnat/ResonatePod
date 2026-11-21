"""Transcribe every episode end to end with whisper.cpp, keeping segment timestamps.

Usage: python3 -I transcribe_full.py FINGERPRINT_DB OUT_DB WORK_DIR [--limit N]

Episodes come from the fingerprint database (duplicates and unreadable files skipped) and are done
round-robin across shows, so a partial run already covers every show. Results go to OUT_DB table
`ep_text` (ep, segments JSON of [from_s, to_s, text], text, ...); episodes already there are skipped,
so the run can be stopped and restarted at any time. Pauses while the PS5 emulator holds the GPU.
Decoding the next batch overlaps with whisper on the current one.
"""
import argparse, json, os, sqlite3, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

MODEL = os.path.expanduser('~/Documents/Projects/WhisperExperiments/whisper.cpp/models/ggml-large-v3-turbo.bin')
WHISPER = 'whisper-cli'   # called directly: the `whisper` wrapper mistakes -mc for a model flag
BATCH_EPS, BATCH_SECS = 8, 4 * 3600
FLAGS = ['-l', 'en', '-np', '-oj', '-mc', '0']  # -mc 0: no carried-over context, so a loop over music can't spread


def order(fp):
    """Round-robin over shows (shortest first within a show doesn't matter; id order keeps it stable)."""
    rows = fp.execute("""SELECT id, show, path, duration FROM episodes
                         WHERE fp IS NOT NULL AND id NOT IN (SELECT ep FROM duplicates) ORDER BY id""").fetchall()
    per = {}
    for r in rows: per.setdefault(r[1], []).append(r)
    out, i = [], 0
    while any(per.values()):
        for show in sorted(per):
            if per[show]: out.append(per[show].pop(0))
    return out


def decode(path, dst):
    subprocess.run(['nice', '-n', '10', 'ffmpeg', '-v', 'error', '-y', '-i', path, '-vn', '-ar', '16000', '-ac', '1',
                    '-c:a', 'pcm_s16le', dst], check=True)


def gpu_busy():
    return subprocess.run(['pgrep', '-x', 'kyty_emulator'], capture_output=True).returncode == 0


def prepare(batch, work):
    wavs = {}
    def one(ep):
        dst = os.path.join(work, f'{ep[0]}.wav')
        try: decode(ep[2], dst); return ep[0], dst
        except Exception as e: return ep[0], f'ERR decode: {e}'
    with ThreadPoolExecutor(3) as pool:
        for k, v in pool.map(one, batch): wavs[k] = v
    return wavs


def run_whisper(wavs):
    ok = {k: v for k, v in wavs.items() if not v.startswith('ERR')}
    args = ['nice', '-n', '10', WHISPER, '-m', MODEL] + FLAGS
    for v in ok.values(): args += ['-f', v]
    r = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    return r.returncode, r.stderr[-300:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('fp'); ap.add_argument('out'); ap.add_argument('work'); ap.add_argument('--limit', type=int)
    a = ap.parse_args()
    fp = sqlite3.connect(f'file:{a.fp}?mode=ro', uri=True)
    db = sqlite3.connect(a.out)
    db.executescript("""
      CREATE TABLE IF NOT EXISTS ep_text (ep INTEGER PRIMARY KEY, show TEXT, duration REAL, text TEXT, segments TEXT,
                                          model TEXT, took REAL, done_at INTEGER);
      CREATE TABLE IF NOT EXISTS ep_fail (ep INTEGER PRIMARY KEY, error TEXT, at INTEGER);
    """)
    done = {r[0] for r in db.execute('SELECT ep FROM ep_text')}
    todo = [e for e in order(fp) if e[0] not in done]
    if a.limit: todo = todo[:a.limit]
    total = sum(e[3] for e in todo)
    print(f'{len(todo):,} episodes to do, {total/3600:.0f} h of audio ({len(done):,} already done)', flush=True)
    os.makedirs(a.work, exist_ok=True)
    for f in os.listdir(a.work): os.remove(os.path.join(a.work, f))

    batches, cur, secs = [], [], 0
    for e in todo:
        if cur and (len(cur) >= BATCH_EPS or secs + e[3] > BATCH_SECS): batches.append(cur); cur, secs = [], 0
        cur.append(e); secs += e[3]
    if cur: batches.append(cur)

    t0 = time.time(); audio_done = 0; n_done = 0
    pool = ThreadPoolExecutor(1)
    nxt = pool.submit(prepare, batches[0], a.work) if batches else None
    for bi, batch in enumerate(batches):
        wavs = nxt.result()
        if bi + 1 < len(batches):  # decode the next batch while whisper works on this one
            # (separate dir names per episode id, so no clash with files of the current batch)
            nxt = pool.submit(prepare, batches[bi + 1], a.work)
        while gpu_busy():
            print(f'  emulator running, paused ({time.strftime("%H:%M")})', flush=True); time.sleep(300)
        tb = time.time()
        rc, err = run_whisper(wavs)
        took = (time.time() - tb) / max(1, len(batch))
        rows, fails = [], []
        for ep, show, path, dur in batch:
            w = wavs[ep]
            if w.startswith('ERR'): fails.append((ep, w, int(time.time()))); continue
            try:
                d = json.load(open(w + '.json', encoding='utf-8', errors='replace'))
            except Exception:
                fails.append((ep, f'no whisper output (rc={rc}) {err}', int(time.time()))); continue
            segs = [[round(x['offsets']['from'] / 1000, 2), round(x['offsets']['to'] / 1000, 2), x['text'].strip()]
                    for x in d.get('transcription', []) if x['text'].strip()]
            rows.append((ep, show, dur, ' '.join(s[2] for s in segs), json.dumps(segs, ensure_ascii=False),
                         'large-v3-turbo', took, int(time.time())))
        db.executemany('INSERT OR REPLACE INTO ep_text VALUES (?,?,?,?,?,?,?,?)', rows)
        db.executemany('INSERT OR REPLACE INTO ep_fail VALUES (?,?,?)', fails); db.commit()
        for ep, *_ in batch:
            for suf in ('.wav', '.wav.json'):
                try: os.remove(os.path.join(a.work, f'{ep}{suf}'))
                except FileNotFoundError: pass
        n_done += len(batch); audio_done += sum(e[3] for e in batch)
        el = time.time() - t0; rate = audio_done / el
        print(f'  {n_done:,}/{len(todo):,} eps  {audio_done/3600:.0f}/{total/3600:.0f} h  {rate:.0f}x realtime  '
              f'elapsed {el/3600:.1f} h  eta {(total-audio_done)/rate/3600:.1f} h  fails {len(fails)}', flush=True)
    print(f'DONE in {(time.time()-t0)/3600:.1f} h', flush=True)


if __name__ == '__main__':
    main()
