"""Write export/segments.json: every episode file's skippable segments, for the app to import.

Usage: python3 -I export.py FINGERPRINT_DB TEXT_DB OUT_JSON

{ "<file path>": { "duration": s, "kind": "announcement" | "crosspromo" | ..., "segments": [
    { "start": s, "end": s, "category": "sponsor" | "promo" | "selfpromo" | "bumper" | "intro" | "outro" | "recap",
      "source": "fp+text" | "episode:announcement" | ... } ] } }
Times are the snapped edges (snap.py). Music and content are left out; `kind` is set for short episodes only.
"""
import html, json, sqlite3, sys
from collections import defaultdict


def main():
    fp = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True); db = sqlite3.connect(sys.argv[2])
    path = dict(fp.execute('SELECT id, path FROM episodes')); dur = dict(db.execute('SELECT ep, duration FROM ep_text'))
    kind = dict(db.execute('SELECT ep, kind FROM episode_kind'))
    segs = defaultdict(list)
    for ep, a, b, c, src in db.execute("SELECT ep, start, end, category, source FROM final WHERE category NOT IN ('music', 'content') ORDER BY ep, start"):
        segs[ep].append({'start': round(a, 2), 'end': round(b, 2), 'category': c, 'source': src})
    out = {}
    for ep in sorted(set(segs) | set(kind)):
        entry = {'duration': dur[ep], 'segments': segs.get(ep, [])}
        if ep in kind: entry['kind'] = kind[ep]
        out[path[ep]] = entry
    with open(sys.argv[3], 'w', encoding='utf-8') as f: json.dump(out, f, ensure_ascii=False)
    n = sum(len(v['segments']) for v in out.values())
    print(f'{len(out):,} episodes, {n:,} segments -> {sys.argv[3]}')


if __name__ == '__main__':
    main()
