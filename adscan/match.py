"""Find audio that repeats across episodes, from the fingerprints fingerprint.py stored.

Usage: python3 -I match.py DB_PATH

Writes three tables into the same database (replacing earlier results):
  matches  one row per verified shared stretch between two episodes
  spans    per-episode repeated intervals, merged, each tied to a clip
  clips    one row per distinct repeated piece of audio, with a guess at what it is:
             ad     heard in 2+ different shows (network ads, cross-promos)
             theme  one show, in most of its episodes at a consistent position (from start or end)
             shared longer than 5 min: a crossover or re-run carried by another feed
             repeat one show, anything else (same-show ad, recap, promo, a jingle mid-episode)
"""
import html, sqlite3, sys, time
from collections import defaultdict
import numpy as np

SAMPLE_BITS = 2          # keep 1/4 of frames (chosen by value, so both copies keep the same ones)
MAX_GROUP = 3000         # ignore values shared by more frames than this (silence, tones)
MIN_VOTES = 6            # sampled exact hits at one offset before we look closer
OFFSET_TOL = 2           # frames: offsets within this are the same alignment
SMOOTH = 16              # frames (~2 s) to average bit error over
MAX_BER = 0.30           # mean bit error rate below this counts as the same audio
MIN_FRAMES = 40          # ~5 s: shortest stretch kept
SHARED_LEN = 300         # seconds: longer than this is shared content, not an ad
MIN_OVERLAP = 16         # frames two intervals in one episode must share to be the same span


def load(db):
    item = float(db.execute("SELECT value FROM meta WHERE key='item_seconds'").fetchone()[0])
    rows = db.execute('SELECT id, show, duration, fp, ep_key FROM episodes WHERE fp IS NOT NULL ORDER BY id').fetchall()
    eps = {r[0]: (html.unescape(r[1]), r[2], np.frombuffer(r[3], dtype='<u4'), r[4] is not None) for r in rows}
    return item, eps


def candidates(eps):
    hs, es, ps = [], [], []
    for eid, (_, _, fp, _) in eps.items():
        mix = (fp.astype(np.uint64) * np.uint64(2654435761)) & np.uint64(0xFFFFFFFF)
        keep = np.nonzero((mix >> np.uint64(32 - SAMPLE_BITS)) == 0)[0]
        hs.append(fp[keep]); es.append(np.full(len(keep), eid, np.int32)); ps.append(keep.astype(np.int32))
    H, E, P = np.concatenate(hs), np.concatenate(es), np.concatenate(ps)
    order = np.lexsort((P, E, H)); H, E, P = H[order], E[order], P[order]
    starts = np.r_[0, np.nonzero(np.diff(H))[0] + 1]
    sizes = np.diff(np.r_[starts, len(H)])
    gstart = np.repeat(starts, sizes); gsize = np.repeat(sizes, sizes)
    # Star: every frame votes with the group's first (lowest episode id) occurrence.
    ok = (gsize <= MAX_GROUP) & (E != E[gstart])
    a, pa, b, pb = E[gstart][ok], P[gstart][ok], E[ok], P[ok]
    off = (pb - pa).astype(np.int64)
    key = (a.astype(np.int64) << 44) | (b.astype(np.int64) << 24) | (off + (1 << 23))
    uk, cnt = np.unique(key, return_counts=True)
    print(f'  {len(H):,} sampled frames, {ok.sum():,} votes, {len(uk):,} alignments', flush=True)
    # Merge neighbouring offsets for the same pair before thresholding.
    out = defaultdict(int)
    for k, c in zip(uk.tolist(), cnt.tolist()):
        a_, b_, o = k >> 44, (k >> 24) & 0xFFFFF, (k & 0xFFFFFF) - (1 << 23)
        out[(a_, b_, o // (OFFSET_TOL + 1))] += c
    cands = defaultdict(list)
    for (a_, b_, ob), c in out.items():
        if c >= MIN_VOTES: cands[(a_, b_)].append(ob * (OFFSET_TOL + 1) + OFFSET_TOL // 2)
    return cands


def runs(mask):
    d = np.diff(np.r_[0, mask.astype(np.int8), 0])
    return list(zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]))


def verify(fa, fb, offsets):
    found = []
    for o in sorted(offsets):
        best = None
        for oo in range(o - OFFSET_TOL, o + OFFSET_TOL + 1):  # pin the exact alignment
            i0, i1 = max(0, -oo), min(len(fa), len(fb) - oo)
            if i1 - i0 < MIN_FRAMES: continue
            ber = np.bitwise_count(fa[i0:i1] ^ fb[i0 + oo:i1 + oo]).astype(np.float32) / 32
            sm = np.convolve(ber, np.ones(SMOOTH, np.float32) / SMOOTH, mode='same')
            score = (sm < MAX_BER).sum()
            if best is None or score > best[0]: best = (score, oo, i0, ber, sm)
        if not best or best[0] < MIN_FRAMES: continue
        _, oo, i0, ber, sm = best
        for s, e in runs(sm < MAX_BER):
            if e - s >= MIN_FRAMES:
                found.append((i0 + s, i0 + e, i0 + s + oo, i0 + e + oo, float(ber[s:e].mean())))
    # Drop duplicates found from neighbouring offsets.
    found.sort(key=lambda r: r[4]); kept = []
    for r in found:
        if not any(min(r[1], k[1]) - max(r[0], k[0]) > MIN_OVERLAP for k in kept): kept.append(r)
    return kept


class DSU:
    def __init__(self): self.p = {}
    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x: self.p[x] = self.p[self.p[x]]; x = self.p[x]
        return x
    def union(self, a, b): self.p[self.find(a)] = self.find(b)


def main():
    db = sqlite3.connect(sys.argv[1]); t0 = time.time()
    item, eps = load(db)
    print(f'{len(eps)} episodes, {sum(len(e[2]) for e in eps.values()) * item / 3600:.0f} h of audio', flush=True)
    cands = candidates(eps)
    print(f'  {sum(len(v) for v in cands.values()):,} candidate alignments over {len(cands):,} episode pairs ({time.time()-t0:.0f}s)', flush=True)

    matches = []
    for n, ((a, b), offs) in enumerate(cands.items(), 1):
        for sa, ea, sb, eb, ber in verify(eps[a][2], eps[b][2], offs):
            matches.append((a, sa, ea, b, sb, eb, ber))
        if n % 20000 == 0: print(f'  verified {n:,}/{len(cands):,} pairs, {len(matches):,} matches', flush=True)
    # The same file downloaded twice (a renamed folder, a show subscribed twice) matches end to end:
    # keep the copy Resonate links to (else the lower id) and forget the other, so it can't pose as a
    # second show or inflate counts.
    dups = {}
    for a, sa, ea, b, sb, eb, _ in matches:
        if (ea - sa) * item > 0.8 * min(eps[a][1], eps[b][1]):
            keep, drop = sorted((a, b), key=lambda x: (not eps[x][3], x))
            dups[drop] = keep
    matches = [m for m in matches if m[0] not in dups and m[3] not in dups]
    for d in dups: del eps[d]
    print(f'  {len(matches):,} verified matches, {len(dups)} duplicate files set aside ({time.time()-t0:.0f}s)', flush=True)

    # Spans: merge each episode's matched intervals; clips: spans joined by matches.
    per_ep = defaultdict(list)
    for mi, (a, sa, ea, b, sb, eb, _) in enumerate(matches):
        per_ep[a].append((sa, ea, mi)); per_ep[b].append((sb, eb, mi))
    span_of = {}; spans = []  # (ep, start, end)
    for ep, ivs in per_ep.items():
        ivs.sort(); cur = None
        for s, e, mi in ivs:
            if cur and s < spans[cur][2] - MIN_OVERLAP:
                spans[cur] = (ep, spans[cur][1], max(spans[cur][2], e))
            else:
                spans.append((ep, s, e)); cur = len(spans) - 1
            span_of[(mi, ep, s)] = cur
    dsu = DSU()
    for mi, (a, sa, ea, b, sb, eb, _) in enumerate(matches):
        dsu.union(span_of[(mi, a, sa)], span_of[(mi, b, sb)])
    comps = defaultdict(list)
    for si in range(len(spans)): comps[dsu.find(si)].append(si)

    show_eps = defaultdict(int)
    for show, *_ in eps.values(): show_eps[show] += 1
    clip_rows, span_rows = [], []
    for cid, sis in enumerate(sorted(comps.values(), key=len, reverse=True), 1):
        ss = [spans[i] for i in sis]
        shows = {eps[ep][0] for ep, _, _ in ss}; n_eps = len({ep for ep, _, _ in ss})
        lens = sorted((e - s) * item for _, s, e in ss); med = lens[len(lens) // 2]
        # Where it sits: seconds from start and from end, per occurrence.
        from_start = [s * item for ep, s, _ in ss]; from_end = [eps[ep][1] - e * item for ep, _, e in ss]
        iqr = lambda v: float(np.subtract(*np.percentile(v, [75, 25])))
        if med > SHARED_LEN: kind = 'shared'  # a whole segment or episode carried by another feed, not an ad
        elif len(shows) >= 2: kind = 'ad'
        elif n_eps >= 0.5 * show_eps[next(iter(shows))] and min(iqr(from_start), iqr(from_end)) < 60: kind = 'theme'
        else: kind = 'repeat'
        clip_rows.append((cid, kind, n_eps, len(shows), ', '.join(sorted(shows)), med,
                          float(np.median(from_start)), float(np.median(from_end))))
        for ep, s, e in ss: span_rows.append((ep, s * item, e * item, cid, kind))

    db.executescript("""
      DROP TABLE IF EXISTS matches; DROP TABLE IF EXISTS duplicates; DROP TABLE IF EXISTS spans; DROP TABLE IF EXISTS clips;
      CREATE TABLE matches (a INTEGER, a_start REAL, a_end REAL, b INTEGER, b_start REAL, b_end REAL, ber REAL);
      CREATE TABLE clips (id INTEGER PRIMARY KEY, kind TEXT, n_eps INTEGER, n_shows INTEGER, shows TEXT,
                          median_len REAL, median_from_start REAL, median_from_end REAL);
      CREATE TABLE spans (ep INTEGER, start REAL, end REAL, clip INTEGER, kind TEXT);
      CREATE TABLE duplicates (ep INTEGER PRIMARY KEY, same_as INTEGER);
      CREATE INDEX spans_ep ON spans (ep); CREATE INDEX spans_clip ON spans (clip);
    """)
    db.executemany('INSERT INTO matches VALUES (?,?,?,?,?,?,?)',
                   [(a, sa * item, ea * item, b, sb * item, eb * item, ber) for a, sa, ea, b, sb, eb, ber in matches])
    db.executemany('INSERT INTO duplicates VALUES (?,?)', list(dups.items()))
    db.executemany('INSERT INTO clips VALUES (?,?,?,?,?,?,?,?)', clip_rows)
    db.executemany('INSERT INTO spans VALUES (?,?,?,?,?)', span_rows)
    db.execute("INSERT OR REPLACE INTO meta VALUES ('matched_at', strftime('%s','now'))")
    db.commit()
    kinds = defaultdict(lambda: [0, 0.0])
    for r in span_rows: kinds[r[4]][0] += 1; kinds[r[4]][1] += r[2] - r[1]
    print(f'{len(clip_rows):,} clips, {len(span_rows):,} spans; ' +
          ', '.join(f'{k}: {n:,} spans / {s/3600:.1f} h' for k, (n, s) in sorted(kinds.items())) +
          f' ({time.time()-t0:.0f}s)', flush=True)


if __name__ == '__main__':
    main()
