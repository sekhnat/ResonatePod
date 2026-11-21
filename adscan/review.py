"""Hand review of every skip segment, one judgement per distinct piece of audio.

Usage:
  python3 -I review.py TEXT_DB group                 # cluster segments in `final` by transcript text -> review_groups
  python3 -I review.py TEXT_DB show FROM TO          # print groups FROM..TO (by size) for judging
  python3 -I review.py TEXT_DB apply                 # apply verdicts.json to `final`

The same promo appears in hundreds of episodes and whisper writes near-identical text for identical audio, so segments
whose 3-word shingles overlap by JACCARD or more are one group, judged once. Verdicts live in verdicts.json as
{"<group key text>": verdict} where verdict is "ok", "drop" (not skippable: becomes content), or a category name
("promo", "selfpromo", "sponsor", "bumper", "intro", "outro", "recap") to relabel. A verdict applies to every segment
whose text matches its key at JACCARD, so it survives re-running the pipeline. Segments with no speech are grouped
per category and show.
"""
import json, os, re, sqlite3, sys
from collections import Counter, defaultdict

JACCARD = 0.5
HERE = os.path.dirname(os.path.abspath(__file__))
VERDICTS = os.path.join(HERE, 'verdicts.json')


def norm_words(t): return re.sub(r"[^a-z0-9' ]", ' ', t.lower()).split()


def shingles(t):
    w = norm_words(t)
    return {' '.join(w[i:i + 3]) for i in range(max(1, len(w) - 2))} if w else set()


def seg_texts(db):
    lines = {}
    out = []
    for rid, ep, a, b, c, show in db.execute(
            "SELECT f.rowid, f.ep, f.start, f.end, f.category, t.show FROM final f JOIN ep_text t USING (ep) "
            "WHERE f.category NOT IN ('music', 'content')"):
        if ep not in lines: lines[ep] = json.loads(db.execute('SELECT segments FROM ep_text WHERE ep=?', (ep,)).fetchone()[0])
        L = lines[ep]
        inside = [t for s, e, t in L if a <= (s + e) / 2 < b]
        before = [t for s, e, t in L if (s + e) / 2 < a][-1:]
        after = [t for s, e, t in L if (s + e) / 2 >= b][:1]
        out.append((rid, ep, a, b, c, show, ' '.join(inside), ' '.join(before), ' '.join(after)))
    return out


class Index:
    """Greedy clustering: each text joins the first group whose key shares >= JACCARD of shingles."""
    def __init__(self): self.keys, self.sh, self.inv = [], [], defaultdict(set)
    def find(self, s):
        if not s: return None
        cand = Counter(g for x in s for g in self.inv.get(x, ()))
        for g, _ in cand.most_common(20):
            if len(s & self.sh[g]) / len(s | self.sh[g]) >= JACCARD: return g
        return None
    def add(self, key, s):
        g = len(self.keys); self.keys.append(key); self.sh.append(s)
        for x in s: self.inv[x].add(g)
        return g


def group(db):
    rows = seg_texts(db)
    idx = Index(); members = defaultdict(list)
    for r in sorted(rows, key=lambda r: -len(r[6])):   # longest first: it becomes the group's key
        rid, ep, a, b, c, show, text, bef, aft = r
        if len(norm_words(text)) < 3:
            members[('nospeech', c, show)].append(r); continue
        s = shingles(text); g = idx.find(s)
        if g is None: g = idx.add(text, s)
        members[g].append(r)
    db.executescript('DROP TABLE IF EXISTS review_groups; CREATE TABLE review_groups (gid INTEGER, rank INTEGER, n INTEGER, '
                     'cats TEXT, shows TEXT, key TEXT, rep TEXT); DROP TABLE IF EXISTS review_members;'
                     'CREATE TABLE review_members (seg_rowid INTEGER PRIMARY KEY, gid INTEGER);')
    order = sorted(members, key=lambda g: (-len(members[g]), str(g)))
    for rank, g in enumerate(order, 1):
        ms = members[g]
        key = idx.keys[g] if isinstance(g, int) else f'(no speech) {g[1]} in {g[2]}'
        rep = max(ms, key=lambda r: len(r[6]))
        db.execute('INSERT INTO review_groups VALUES (?,?,?,?,?,?,?)', (rank, rank, len(ms), json.dumps(Counter(r[4] for r in ms)),
                   json.dumps(Counter(r[5] for r in ms).most_common(3)), key, json.dumps(rep)))
        db.executemany('INSERT INTO review_members VALUES (?,?)', [(r[0], rank) for r in ms])
    db.commit()
    print(f'{len(rows):,} segments -> {len(order):,} groups ({sum(1 for g in order if len(members[g]) == 1):,} singletons)')


def show(db, lo, hi):
    v = load_verdicts()
    for gid, n, cats, shows, key, rep in db.execute('SELECT gid, n, cats, shows, key, rep FROM review_groups WHERE rank BETWEEN ? AND ? ORDER BY rank', (lo, hi)):
        rid, ep, a, b, c, sh, text, bef, aft = json.loads(rep)
        cats = ','.join(f'{k}{"" if m == 1 else m}' for k, m in json.loads(cats).items())
        shows = '/'.join(s[:14] for s, _ in json.loads(shows))
        t = text if len(text) <= 260 else text[:170] + ' … ' + text[-80:]
        mark = ' [judged]' if key in v else ''
        print(f'G{gid} n={n} {cats} {shows} {b-a:.0f}s{mark}\n  <{bef[-60:]}> {t} <{aft[:60]}>')


def load_verdicts():
    try: return json.load(open(VERDICTS))
    except FileNotFoundError: return {}


def judge(db, spec):
    """spec: JSON {"<gid>": verdict}; stored under the group's key text."""
    v = load_verdicts()
    for gid, verdict in json.loads(spec).items():
        key = db.execute('SELECT key FROM review_groups WHERE gid = ?', (int(gid),)).fetchone()[0]
        v[key] = verdict
    json.dump(v, open(VERDICTS, 'w'), ensure_ascii=False, indent=0)
    print(f'{len(v)} verdicts saved')


def apply(db):
    v = load_verdicts()
    idx = Index(); verdict_of = []
    for key, verdict in v.items():
        if key.startswith('(no speech)'): continue
        idx.add(key, shingles(key)); verdict_of.append(verdict)
    nospeech = {k: x for k, x in v.items() if k.startswith('(no speech)')}
    changed = Counter()
    for rid, ep, a, b, c, show, text, bef, aft in seg_texts(db):
        if len(norm_words(text)) < 3: verdict = nospeech.get(f'(no speech) {c} in {show}')
        else:
            g = idx.find(shingles(text)); verdict = verdict_of[g] if g is not None else None
        if not verdict or verdict == 'ok': continue
        if isinstance(verdict, dict):   # {"cat": ..., "from": phrase, "until": phrase}: trim to the lines named
            L = json.loads(db.execute('SELECT segments FROM ep_text WHERE ep=?', (ep,)).fetchone()[0])
            inside = [(s, e, t) for s, e, t in L if a <= (s + e) / 2 < b]
            na, nb = a, b
            if verdict.get('from'):
                hit = next((s for s, e, t in inside if verdict['from'].lower() in t.lower()), None)
                if hit is not None: na = hit
            if verdict.get('until'):
                hit = next((e for s, e, t in reversed(inside) if verdict['until'].lower() in t.lower()), None)
                if hit is not None: nb = hit
            if (na, nb) != (a, b) and nb > na:
                db.execute('UPDATE final SET start = ?, end = ?, source = source || ? WHERE rowid = ?', (na, nb, '+review:trim', rid)); changed[('trim', '')] += 1
            new = verdict.get('cat', c)
        else:
            new = 'content' if verdict == 'drop' else verdict
        if new != c:
            db.execute('UPDATE final SET category = ?, source = source || ? WHERE rowid = ?', (new, '+review:' + c, rid)); changed[(c, new)] += 1
    db.execute("DELETE FROM final WHERE category = 'content'")
    db.commit()
    print(f'{sum(changed.values())} segments changed: ' + ', '.join(f'{a}->{b} {n}' for (a, b), n in changed.most_common()))


if __name__ == '__main__':
    db = sqlite3.connect(sys.argv[1]); cmd = sys.argv[2]
    if cmd == 'group': group(db)
    elif cmd == 'show': show(db, int(sys.argv[3]), int(sys.argv[4]))
    elif cmd == 'apply': apply(db)
    elif cmd == 'judge': judge(db, sys.argv[3])


# ---- confidence: which groups need a human ----
def confident(c, src, text):
    """True when the segment's own words back its category, so a hand check adds little."""
    import label as L, label_full as LF
    if src.startswith('episode:'): return True                     # whole-episode flags: reviewed by hand already
    if len(norm_words(text)) < 3: return c in ('intro', 'outro')    # speechless: fine as a title card, doubtful as an ad
    rule, _ = L.label(text)
    credits = len(LF.CREDITS.findall(text)) + len(LF.CAST.findall(text))
    if c in ('intro', 'outro'):
        return credits >= 2 or rule in ('intro', 'outro') or 'theme' in src
    if 'bridge' in src: return False
    both = 'fp' in src and 'text' in src
    if c == 'sponsor': return bool(LF.STRONG.search(text)) and (both or rule == 'sponsor')
    if c in ('promo', 'selfpromo', 'bumper'):
        return rule == c and (both or bool(LF.STRONG.search(text)) or bool(re.search(r'wherever you|patreon\.com|apple podcasts|spotify', text, re.I)))
    return rule == c


def triage(db):
    sys.path.insert(0, HERE)
    src = dict(db.execute('SELECT rowid, source FROM final'))
    unsure = Counter(); total = Counter()
    rows = seg_texts(db); gid = dict(db.execute('SELECT seg_rowid, gid FROM review_members'))
    per = defaultdict(list)
    for rid, ep, a, b, c, show, text, bef, aft in rows: per[gid[rid]].append(confident(c, src[rid], text))
    cats = {g: json.loads(x) for g, x in db.execute('SELECT gid, cats FROM review_groups')}
    db.execute('DROP TABLE IF EXISTS review_unsure'); db.execute('CREATE TABLE review_unsure (gid INTEGER PRIMARY KEY, n INTEGER, why TEXT)')
    for g, flags in per.items():
        mixed = len(cats[g]) > 1
        share = sum(flags) / len(flags)
        if mixed or share < 0.5:
            db.execute('INSERT INTO review_unsure VALUES (?,?,?)', (g, len(flags), 'mixed' if mixed else f'{share:.0%} confident'))
    db.commit()
    n, segs = db.execute('SELECT count(*), sum(n) FROM review_unsure').fetchone()
    print(f'{n} of {len(per)} groups need judging ({segs} of {len(rows)} segments)')


if __name__ == '__main__' and sys.argv[2] == 'triage':
    triage(db)


def show_unsure(db, lo, hi):
    ids = [g for (g,) in db.execute('SELECT gid FROM review_unsure ORDER BY gid')][lo - 1:hi]
    for i, g in enumerate(ids, lo):
        print(f'#{i}', end=' '); show(db, g, g)


if __name__ == '__main__' and sys.argv[2] == 'unsure':
    show_unsure(db, int(sys.argv[3]), int(sys.argv[4]))


def unjudged(db):
    v = load_verdicts(); idx = Index()
    for k in v:
        if not k.startswith('(no speech)'): idx.add(k, shingles(k))
    return [g for g, key in db.execute('SELECT g.gid, g.key FROM review_unsure u JOIN review_groups g USING (gid) ORDER BY g.gid')
            if key not in v and (key.startswith('(no speech)') or idx.find(shingles(key)) is None)]


if __name__ == '__main__' and sys.argv[2] == 'unjudged':
    ids = unjudged(db); print(f'{len(ids)} unjudged groups')
    for g in ids[int(sys.argv[3]) if len(sys.argv) > 3 else 0:][:int(sys.argv[4]) if len(sys.argv) > 4 else 10**6]: show(db, g, g)
