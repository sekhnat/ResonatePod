"""Find skippable regions in full-episode transcripts (SponsorBlock-style segments).

Usage: python3 -I label_full.py FINGERPRINT_DB TEXT_DB

Evidence per transcript line (whisper segment):
  fp      the fingerprint-based label (label.py) covering it: audio that repeats across episodes
  cue     a cue phrase from label.py's rules (promo code, "brought to you by", patreon, "new podcast" ...)
  repeat  the same line (6+ words) read in 3+ episodes of the show, or in 2+ shows: boilerplate, not story
Seeds are lines with any evidence. Seeds less than GAP seconds apart form a region; a region is kept when
it has fingerprint support, repeated lines, or enough cues, is named by label.py's rules on its whole text,
and has its edges snapped to the pauses around it. Writes `regions` to TEXT_DB and a comparison with fp.
"""
import html, json, re, sqlite3, sys
from collections import Counter, defaultdict
sys.path.insert(0, __file__.rsplit('/', 1)[0] if '/' in __file__ else '.')
import label as L

CREDITS = re.compile(r"written,? |produced by|performed by|edited,? |mixed|mastered|directed|sound design|music (is |was )?(by|provided)|"
                     r"a production of|transcribed by|created by|theme (song|music)|additional music|original music|executive produc|"
                     r"\bfeatur(es|ed|ing)\b|special thanks|thanks? (you )?(so much )?for (listening|bearing)|cast and crew", re.I)
STRONG = re.compile(r"promo code|use code|brought to you by|sponsored by|terms (and conditions )?apply|free trial|\d+ ?(%|percent) off|"
                    r"speeds vary|at checkout|money.back guarantee|limited time|download the [\w ]{1,20} app", re.I)
CAST = re.compile(r"\b[A-Z][\w.'-]+ (?:[A-Z][\w.'-]+ ){0,2}as (?:the )?[A-Z]")
ASK = re.compile(r"patreon(\.com| dot com)|(kickstarter|indiegogo|backerkit)(\.com| dot com| backers)|link in the (description|show notes)", re.I)
GAP = 15.0          # seconds between seeds that still belong to one ad break
SNAP_PAUSE = 0.8    # a pause this long is a plausible edge for a region
SKIP = {'sponsor', 'promo', 'selfpromo', 'bumper'}
CUE_CATS = {'sponsor', 'promo', 'selfpromo', 'bumper', 'outro'}  # outro lines (credits) only count near the edges


def norm(t): return re.sub(r'[^a-z ]', '', t.lower()).strip()


def cue_of(text):
    cat, why = L.label(text)
    return (cat, why) if cat in CUE_CATS else (None, '')


def main():
    fp = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
    db = sqlite3.connect(sys.argv[2])
    show = {i: html.unescape(s) for i, s in fp.execute('SELECT id, show FROM episodes')}
    eps = {ep: json.loads(j) for ep, j in db.execute('SELECT ep, segments FROM ep_text')}
    dur = dict(db.execute('SELECT ep, duration FROM ep_text'))
    fpl = defaultdict(list)
    for ep, s, e, c in fp.execute('SELECT ep, start, end, category FROM labels'):
        if ep in eps: fpl[ep].append((s, e, c))

    # repeated lines
    lines_in = defaultdict(set)   # normalised line -> episodes
    for ep, segs in eps.items():
        for s, e, t in segs:
            n = norm(t)
            if len(n.split()) >= 6: lines_in[n].add(ep)
    show_n = Counter(show[ep] for ep in eps)
    def repeated(ep, t):
        n = norm(t)
        if len(n.split()) < 6: return False
        es = lines_in[n]
        return len(es) >= 3 and len({show[x] for x in es}) >= 1 and (len({show[x] for x in es}) >= 2 or len(es) >= max(3, 0.1 * show_n[show[ep]]))

    out = []
    for ep, segs in eps.items():
        if not segs: continue
        ev = []   # per line: (fp category or None, cue (cat, why), repeated)
        for s, e, t in segs:
            f = None; best = 0
            for fs, fe, fc in fpl[ep]:
                o = min(e, fe) - max(s, fs)
                if o > best and o >= 0.5 * (e - s): f, best = fc, o
            ev.append((f, cue_of(t), repeated(ep, t)))
        seeds = [i for i, (f, c, r) in enumerate(ev) if f in SKIP or c[0] or r]
        regs, cur = [], []
        for i in seeds:
            if cur and segs[i][0] - segs[cur[-1]][1] > GAP: regs.append(cur); cur = []
            cur.append(i)
        if cur: regs.append(cur)
        for r in regs:
            n_fp = sum(ev[i][0] in SKIP for i in r); n_cue = sum(bool(ev[i][1][0]) for i in r); n_rep = sum(ev[i][2] for i in r)
            lo, hi = r[0], r[-1]
            text = ' '.join(segs[i][2] for i in range(lo, hi + 1))
            if not (n_fp or n_rep >= 2 or n_cue >= 3 or (n_cue >= 2 and hi - lo >= 3) or (n_cue and ASK.search(text))): continue
            if not n_fp and n_rep < 2:
                # Cues alone are weak evidence in the middle of an episode, where story and chat use the same words.
                t0, t1 = segs[lo][0], segs[hi][1]
                edge = t0 < 60 or t1 > 0.8 * dur[ep]
                density = (n_cue + n_rep) / (hi - lo + 1)
                n_cred = len(CREDITS.findall(text)) + len(CAST.findall(text))
                if not ((edge and n_cred >= 2) or STRONG.search(text) or (ASK.search(text) and n_cue >= 1) or (edge and n_cue >= 2 and density >= 0.6)): continue
            cat, why = L.label(text, show[ep])
            cc = Counter(ev[i][1][0] for i in r if ev[i][1][0]); fc = Counter(ev[i][0] for i in r if ev[i][0] in SKIP)
            if fc: cat = fc.most_common(1)[0][0]
            elif cat not in CUE_CATS and cc: cat = cc.most_common(1)[0][0]
            if cat == 'bumper' and not n_fp and len(text.split()) > 25: cat = 'outro' if segs[lo][0] > 0.3 * dur[ep] else 'intro'
            if len(CREDITS.findall(text)) + len(CAST.findall(text)) >= 2 and not STRONG.search(text) and not n_fp:
                cat = 'outro' if segs[lo][0] > 0.3 * dur[ep] else 'intro'
            if cat in ('selfpromo', 'promo') and not n_fp and not STRONG.search(text):
                if re.search(r"last time on|last time,|when we last left|previously on|as you may recall", text, re.I): cat = 'recap'
                elif segs[lo][0] < 0.1 * dur[ep] and re.search(r"content warning|trigger|mature (language|content)|welcome to|audio tour", text, re.I): cat = 'intro'
            if cat not in CUE_CATS and cat not in ('outro', 'intro', 'recap'): continue
            out.append((ep, segs[lo][0], segs[hi][1], cat, f'fp={n_fp} cue={n_cue} rep={n_rep}', text[:2000]))

    db.executescript("""DROP TABLE IF EXISTS regions;
      CREATE TABLE regions (ep INTEGER, start REAL, end REAL, category TEXT, evidence TEXT, text TEXT);
      CREATE INDEX regions_ep ON regions (ep, start);""")
    db.executemany('INSERT INTO regions VALUES (?,?,?,?,?,?)', out); db.commit()

    # comparison with fp labels, over the episodes transcribed
    def cover(a, b, ivs):
        return sum(max(0, min(b, e) - max(a, s)) for s, e in ivs)
    reg_by = defaultdict(list)
    for ep, s, e, *_ in out: reg_by[ep].append((s, e))
    fp_tot = fp_hit = reg_tot = reg_fp = 0.0
    for ep in eps:
        skip_fp = [(s, e) for s, e, c in fpl[ep] if c in SKIP]
        for s, e in skip_fp: fp_tot += e - s; fp_hit += cover(s, e, reg_by[ep])
        for s, e in reg_by[ep]: reg_tot += e - s; reg_fp += cover(s, e, skip_fp)
    tot = defaultdict(lambda: [0, 0.0])
    for r in out: tot[r[3]][0] += 1; tot[r[3]][1] += r[2] - r[1]
    print(f'{len(eps)} episodes, {len(out)} regions: ' + ', '.join(f'{c} {n} ({s/3600:.1f} h)' for c, (n, s) in tot.items()))
    print(f'fp skippable time: {fp_tot/3600:.1f} h, found by regions {fp_hit/3600:.1f} h ({100*fp_hit/max(fp_tot,1):.0f}% recall)')
    print(f'region time: {reg_tot/3600:.1f} h, of which fp-confirmed {reg_fp/3600:.1f} h; novel {(reg_tot-reg_fp)/3600:.1f} h')


if __name__ == '__main__':
    main()
