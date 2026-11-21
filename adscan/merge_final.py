"""Merge fingerprint labels and full-transcript regions into one segment list per episode.

Usage: python3 -I merge_final.py FINGERPRINT_DB TEXT_DB

Both sources vote on every stretch of time; the highest-priority category wins (sponsor > promo > selfpromo >
bumper > outro > intro > music > content), so a transcript region beats an fp "music" or "content" piece.
Then: a content/music fragment of <= FRAG seconds between two segments of the skip family is absorbed into
them (credit fragments, promo tails), same-category neighbours closer than BRIDGE seconds join, and
segments under MIN_SEG seconds are dropped. Writes `final` (ep, start, end, category, source) to TEXT_DB.
"""
import html, json, re, sqlite3, sys
sys.path.insert(0, __file__.rsplit('/', 1)[0] if '/' in __file__ else '.')
import label_full as LF
from collections import defaultdict, Counter

PRIO = {'sponsor': 8, 'promo': 7, 'selfpromo': 6, 'bumper': 5, 'outro': 4, 'intro': 3, 'recap': 3, 'music': 2, 'repeat': 1.5, 'content': 1}
FAMILY = {'sponsor', 'promo', 'selfpromo', 'bumper', 'outro', 'intro', 'recap'}
FRAG, BRIDGE, MIN_SEG = 15.0, 3.0, 3.0
LEAD = 20.0      # a cue line this close outside an ad segment belongs to it ("this episode is sponsored by...")
ADS = ('sponsor', 'promo', 'selfpromo', 'bumper')
AD_GAP = 60.0    # a gap this long between two ad segments joins them when it sounds promotional (a trailer's tail and credits)
PROMO_WORDS = re.compile(r"podcast|presents|wherever you|subscribe|listen (now|on|to|wherever)|available (now|on|wherever)|\.com|dot com|"
                         r"network|\bradio\b|episodes? every|new (season|series|show)|patreon|starring", re.I)
def promotional(t): return bool(LF.STRONG.search(t) or LF.cue_of(t)[0] in ADS or PROMO_WORDS.search(t) or LF.L.NETWORKS.search(t))


def main():
    fp = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True); db = sqlite3.connect(sys.argv[2])
    show = {i: html.unescape(s) for i, s in fp.execute('SELECT id, show FROM episodes')}
    dur = dict(db.execute('SELECT ep, duration FROM ep_text'))
    items = defaultdict(list)
    for ep, s, e, c in fp.execute('SELECT ep, start, end, category FROM labels'):
        if ep in dur: items[ep].append((s, e, c, 'fp'))
    for ep, s, e, c in db.execute('SELECT ep, start, end, category FROM regions'):
        items[ep].append((s, e, c, 'text'))
    out = []
    for ep, its in items.items():
        pts = sorted({0.0, dur[ep]} | {x for s, e, *_ in its for x in (s, e)})
        elem = []
        for a, b in zip(pts, pts[1:]):
            if b - a < 1e-3: continue
            cov = [(PRIO[c], c, src) for s, e, c, src in its if s <= a + 1e-6 and e >= b - 1e-6]
            if not cov: elem.append([a, b, 'content', set()]); continue
            top = max(cov)[1]
            elem.append([a, b, top, {src for p, c, src in cov if c == top}])
        lines = json.loads(db.execute('SELECT segments FROM ep_text WHERE ep=?', (ep,)).fetchone()[0])
        def spoken(a, b): return ' '.join(t for s, e, t in lines if a <= (s + e) / 2 < b).strip()
        # neighbours of one category first become one piece, so a sliver between two pieces can't hide a neighbour
        joined = []
        for el in elem:
            if joined and joined[-1][2] == el[2] and abs(el[0] - joined[-1][1]) < 1e-6: joined[-1][1] = el[1]; joined[-1][3] |= el[3]
            else: joined.append(el)
        elem = joined
        # repeated "story" (label.py): beside an ad it is that ad's trailer body; anywhere else, a recap or cold open
        for i, el in enumerate(elem):
            if el[2] != 'repeat': continue
            near = [elem[j][2] for j in (i - 1, i + 1) if 0 <= j < len(elem) and elem[j][2] in ADS]
            if not near:  # look past a short music sting
                near = [elem[j][2] for j, k in ((i - 2, i - 1), (i + 2, i + 1)) if 0 <= j < len(elem) and elem[k][2] == 'music'
                        and elem[k][1] - elem[k][0] <= 5 and elem[j][2] in ADS]
            el[2] = near[0] if near else 'recap'
        # absorb short content/music fragments between two family segments, unless someone is talking in them and it
        # doesn't sound like an ad: that is a story's title or first line ("Statement of Lee Rentoul..."), not filler
        for i, el in enumerate(elem):
            if el[2] in ('content', 'music') and 0 < i < len(elem) - 1 and el[1] - el[0] <= AD_GAP \
                    and elem[i - 1][2] in ADS and elem[i + 1][2] in ADS and el[1] - el[0] > FRAG and promotional(spoken(el[0], el[1])):
                el[2] = elem[i - 1][2]; el[3] = {'bridge'}; continue
            if el[2] in ('content', 'music') and el[1] - el[0] <= FRAG and 0 < i < len(elem) - 1:
                l, r = elem[i - 1], elem[i + 1]
                said = spoken(el[0], el[1])
                if len(said.split()) > 4 and not (LF.STRONG.search(said) or LF.cue_of(said)[0]): continue
                if l[2] in FAMILY and r[2] in FAMILY:
                    el[2] = l[2] if PRIO[l[2]] >= PRIO[r[2]] else r[2]; el[3] = {'bridge'}
        # merge neighbours of one category
        merged = []
        for a, b, c, src in elem:
            if merged and merged[-1][2] == c and a - merged[-1][1] <= BRIDGE:
                merged[-1][1] = b; merged[-1][3] |= src
            else: merged.append([a, b, c, set(src)])
        fam = [m for m in merged if m[2] in ADS or m[2] in ('outro', 'intro')]
        for k, (a, b, c, src) in enumerate(merged):
            if c == 'content' or b - a < MIN_SEG: continue
            # stingers with no speech that only other shows carry: keep as music unless an ad is right beside them
            if c in ADS and src == {'fp'} and b - a <= 20 and not spoken(a, b) and not any(
                    m is not merged[k] and m[2] in ADS and (abs(m[0] - b) <= 3 or abs(a - m[1]) <= 3) for m in merged):
                c = 'music'
            if c in ADS:
                prev_end = max([m[1] for m in merged if m[1] <= a and m[2] != 'content'], default=0.0)
                next_start = min([m[0] for m in merged if m[0] >= b and m[2] != 'content'], default=dur[ep])
                for s, e, t in sorted(lines, key=lambda x: -x[0]):          # lead-in before the segment
                    if e <= a and a - e <= LEAD and s >= prev_end and promotional(t): a = min(a, s)
                for s, e, t in lines:                                         # tail after the segment
                    if s >= b and s - b <= LEAD and e <= next_start and promotional(t): b = max(b, e)
                src = src | {'ext'} if (a, b) != (merged[k][0], merged[k][1]) else src
            out.append((ep, a, b, c, '+'.join(sorted(src))))
    # Short episodes that are an announcement or another show's trailer (short_eps.py): flagged from the start to the
    # last line that sounds like one, or whole when that covers most of it ("updates first, then our summer short").
    import short_eps as SE
    kinds = dict(db.execute("SELECT ep, kind FROM episode_kind WHERE kind IN ('announcement', 'crosspromo')")) if db.execute(
        "SELECT 1 FROM sqlite_master WHERE name = 'episode_kind'").fetchone() else {}
    for ep, kind in kinds.items():
        lines = json.loads(db.execute('SELECT segments FROM ep_text WHERE ep=?', (ep,)).fetchone()[0])
        ends = [e for s, e, t in lines if LF.STRONG.search(t) or LF.cue_of(t)[0] in ADS or SE.ANNOUNCE.search(t) or SE.TEASE.search(t)]
        if not ends: continue
        stop = dur[ep] if max(ends) >= 0.6 * dur[ep] else min(dur[ep], max(ends) + 1.0)
        cat = 'selfpromo' if kind == 'announcement' else 'promo'
        out = [r for r in out if r[0] != ep or r[1] >= stop] + [(ep, 0.0, stop, cat, f'episode:{kind}')]
    out.sort(key=lambda r: (r[0], r[1]))
    db.executescript("""DROP TABLE IF EXISTS final; CREATE TABLE final (ep INTEGER, start REAL, end REAL, category TEXT, source TEXT);
                        CREATE INDEX final_ep ON final (ep, start);""")
    db.executemany('INSERT INTO final VALUES (?,?,?,?,?)', out); db.commit()
    tot = defaultdict(float)
    for r in out: tot[r[3]] += r[2] - r[1]
    audio = sum(dur.values())
    print(f'{len(dur)} episodes, {audio/3600:.0f} h of audio, {len(out):,} segments')
    for c, s in sorted(tot.items(), key=lambda x: -x[1]): print(f'  {c:10} {s/3600:6.1f} h  {100*s/audio:4.1f}%')
    ad = sum(tot[c] for c in ('sponsor', 'promo', 'selfpromo', 'bumper'))
    print(f'  ads/promos {ad/3600:.1f} h ({100*ad/audio:.1f}% of audio)')


if __name__ == '__main__':
    main()
