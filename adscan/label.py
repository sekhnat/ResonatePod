"""Label each repeated span from its transcript, SponsorBlock style.

Usage: python3 -I label.py DB_PATH

Categories, checked in this order (first hit wins):
  sponsor    paid ad: promo codes, "brought to you by", terms apply, % off, a brand's .com
  promo      advertising for other shows, books, products: cross-promo swaps, network trailers
  selfpromo  the show's own asks: Patreon, merch, tours, crowdfunding
  bumper     "we'll be right back" and friends: the edge of an ad break
  recap      "previously on"
  outro      credits, "thanks for listening", licence notices
  selfpromo  (again) a website, "subscribe", "rate and review" when nothing above matched
  intro      "welcome to", "X presents", network idents, title cards, content warnings
  (theme)    anything still unlabelled that recurs in 30%+ of a show's episodes: intro if early, else outro
  music      little or no speech (whisper says "you" or nothing over music)
  content    anything else: the show itself
Each span is first cut at the edges of the fingerprint matches inside it (credits and the ad after them
repeat with different episodes, so they come apart), and each piece is labelled from the words in it.
A piece with no telling words that other shows also carry counts as promo.
Writes table `labels` (one row per piece) and prints a summary.
"""
import html, json, re, sqlite3, sys
from collections import Counter, defaultdict

R = lambda p: re.compile(p, re.I)
RULES = [
    ('sponsor', R(r"sponsored by|\b(promo|offer|discount|coupon) code|\buse code\b|terms (and conditions )?apply|"
                  r"restrictions (may )?apply|free trial|\d+ ?(%|percent) off|free shipping|limited time|"
                  r"download the [\w ]{1,20} app|"
                  r"\bAPR\b|shop (now|at)|in stores|while supplies last|subject to (credit|approval)|see store|"
                  r"availability varies|speeds vary|first (box|order|month)|\b(save|get) (up to )?\$?\d+ ?(%|percent|dollars)|"
                  r"\$\d+ off|at checkout|money.back guarantee|for a limited|exclusive offer|special offer|"
                  r"sign up (today|now)")),
    # Advertising for other shows, books and products: cross-promo swaps and network trailers.
    ('promo', R(r"wherever you (get|listen to|find) (your )?(favou?rite )?podcasts|subscribe to the show (for free )?wherever|new (season|episodes?)|"
                r"(season|episodes?) (drops|premieres|is available|are available)|listen (now|today)|\bout now\b|available now|"
                r"\bnovel\b|audio ?book|new book|pre-?order|best.?sell|on sale|releasing (this|on|in|next)|"
                r"search for .{1,40} (on|in) your|check out|give (a|it a) listen|new podcast|(our|my|the) podcast,? [A-Z]|"
                r"podcast (network|from)|host of|hosts of|apple podcasts|spotify|wondery|audible|"
                r"my new (show|series|podcast)|a new (show|series|podcast)|on the [\w' ]{1,30} podcast|"
                r"international order|retailers|first publication|trailer for|our podcast|a podcast (about|where|for)|"
                r"from the creators of|coming to you from|give (a|it a) listen|a listen to|radio drama|"
                r"now playing (on|via)|kickstarter is (now )?live|new (show|series) from|my show|the feed for")),
    # Product words that story pitches use too (a fictional insurance company): only after the promo cues.
    ('outro', R(r"brought to you by the (talents|work)|cast and crew")),
    # The show's own asks.
    ('selfpromo', R(r"patreon|(helped|help) (to )?make this (episode|show|podcast|season) possible|(kickstarter|indiegogo|backerkit) backers|our merch|link in the (description|show notes)|\b(our|my) patrons|\bbecom(e|ing) a patron|kickstarter|crowdfund|ko-?fi|\bmerch|support (the|this|our) (show|podcast|program|work)|"
                    r"tickets|live show|on tour|tour dates|discord|newsletter")),
    ('bumper', R(r"(we'?ll|will) be (right )?back|will return after (this|these|the)\b|after (the|this|these) (break|messages?|word)|stay tuned|"
                 r"(and )?now,? back to|we now return|right after this|be back (soon|shortly|in a moment)")),
    ('recap', R(r"previously,? on|last time on|^previously")),
    ('outro', R(r"thanks?( you)? (so much )?for listening|created by|written (and [\w ]{1,20} )?by|produced by|executive produc|"
                r"directed by|music (is )?by|starring|sound design|a production of|production of|until next time|"
                r"see you next|credits|all rights reserved|copyright|\bfeatur(es|ing)\b.{0,60}\bas\b|\bas\s+\w+\.?\s*$|"
                r"theme (music|song)|original music|special thanks|creative commons|distributed by|licensed under|"
                r"come back next (week|time)|good ?night\.?\s*$")),
    ('outro', re.compile(r"\b[A-Z][a-z]+ [A-Z][\w'-]+ as (the )?[A-Z]")),  # cast lists: "Billy Hindle as Alice Dyer"
    ('sponsor', R(r"brought to you by|insurance company? that|mortgage|credit card|\bloans?\b|financing|\bVPN\b|"
                  r"mattress|meal kit|go to [\w-]+\.com|sign up at|order (now|today)")),
    # Weak plugs (a website, "subscribe", "rate and review") only count when nothing above did.
    ('selfpromo', R(r"rate (and|&) review|leave (us )?a review|subscribe|tell (all )?your friends|spread the (word|love)|"
                    r"share (the|this) (show|podcast|episode)|independently produced|follow (us|the show)|\.com|dot com|\.org|"
                    r"\br slash\b|\bforward slash\b")),
    ('intro', R(r"welcome (back )?to|\bpresents\b|one network|^this is\b|you'?re listening to|episode (\d+|one|two|three)|"
                r"chapter (\d+|one|two|three)|^(hello|hi|hey)\b|content warnings?|trigger warnings?|listener discretion|"
                r"discretion is advised|not (be )?suitable for|show notes for (a )?(full )?list")),
]
FILLER = R(r"^[\W_]*(you|music|\[.*?\]|\(.*?\)|\*.*?\*|thank you|♪+|\s)*[\W_]*$")


NETWORKS = R(r"spectre ?vision|rusty quill|night brigade|believe|realm|acast|audioboom|wondery|iheart|sirius|"
             r"far and tall tales|fool and scholar|radio")


def label(text, show=''):
    t = (text or '').strip()
    words = re.findall(r"[A-Za-z']+", t)
    if FILLER.match(t): return 'music', ''
    for cat, rx in RULES:
        m = rx.search(t)
        if m: return cat, m.group(0)
    sentences = [x for x in (re.sub(r'[^a-z ]', '', x.lower()).strip() for x in re.split(r'[.!?]+', t)) if x]
    lw = [w.lower() for w in words]
    if (len(sentences) >= 3 and len(set(sentences)) <= 0.5 * len(sentences)) or (len(lw) >= 8 and len(set(lw)) <= 0.35 * len(lw)):
        return 'music', 'repetitive (whisper looping over music)'
    if len(words) < 6:
        # A few words over music: the show's or a network's name is a title card, anything else is noise
        # (whisper invents "Thank you" and the like when there's no speech).
        name = {w.lower() for w in re.findall(r"[A-Za-z']{4,}", show)} - {'with', 'from', 'that', 'this'}
        if (name & {w.lower() for w in words}) or NETWORKS.search(t): return 'intro', 'title card'
        return 'music', ''
    return 'content', ''


THEME_SHARE = 0.3 # an unlabelled piece in this share of a show's episodes is its theme, not story
MIN_PIECE = 3.0   # seconds: pieces shorter than this merge into the one before
SHARED_LEN = 300  # pieces longer than this that other shows carry are crossovers, not promos


def main():
    db = sqlite3.connect(sys.argv[1])
    show = {i: html.unescape(s) for i, s in db.execute('SELECT id, show FROM episodes')}
    segs = {(ep, s, e): json.loads(j) for ep, s, e, j in db.execute('SELECT ep, start, end, segments FROM span_text')}
    by_ep = defaultdict(list)  # ep -> [(start, end, partner_ep, partner_start)]
    for a, sa, ea, b, sb, eb in db.execute('SELECT a, a_start, a_end, b, b_start, b_end FROM matches'):
        by_ep[a].append((sa, ea, b, sb)); by_ep[b].append((sb, eb, a, sa))

    def pieces(ep, s, e):
        """Cut a transcribed span at its matches' edges; label each piece from the words inside it."""
        cuts = sorted({s, e} | {x for ms, me, _, _ in by_ep[ep] for x in (ms, me) if s < x < e})
        bounds = [cuts[0]]
        for c in cuts[1:-1]:
            if c - bounds[-1] >= MIN_PIECE: bounds.append(c)
        if e - bounds[-1] < MIN_PIECE and len(bounds) > 1: bounds.pop()
        bounds.append(e)
        out = []
        for ps, pe in zip(bounds, bounds[1:]):
            words = [t for fs, ts, t in segs[(ep, s, e)] if ps <= s + (fs + ts) / 2 < pe]
            text = ' '.join(words).strip()
            others = {show[p] for ms, me, p, _ in by_ep[ep] if min(me, pe) - max(ms, ps) > 0.5 * (pe - ps)} - {show[ep]}
            cat, why = label(text, show[ep])
            if cat in ('content', 'music') and others and 10 <= pe - ps < SHARED_LEN:
                cat, why = 'promo', 'also in ' + ', '.join(sorted(others))[:80]
            out.append((ps - s, pe - s, cat, why, text))
        return out

    # Where each span sits relative to the span transcribed for it (same audio, maybe shifted).
    def offset(ep, s, e, src_ep, src_s, src_e):
        if (ep, s, e) == (src_ep, src_s, src_e): return 0.0
        for ms, me, p, ps in by_ep[ep]:
            if p == src_ep and min(me, e) - max(ms, s) > 0 and src_s - 1 <= ps <= src_e:
                return (ms - s) - (ps - src_s)
        return 0.0

    show_eps = Counter(show.values())
    duration = dict(db.execute('SELECT id, duration FROM episodes'))

    cache, rows, missing = {}, [], 0
    for rid, ep, s, e, src_ep, src_s, src_e in db.execute(
            'SELECT sp.rowid, sp.ep, sp.start, sp.end, ss.ep, ss.start, ss.end '
            'FROM spans sp JOIN span_source ss ON ss.span_rowid = sp.rowid').fetchall():
        key = (src_ep, src_s, src_e)
        if key not in segs: missing += 1; continue
        if key not in cache: cache[key] = pieces(*key)
        off = offset(ep, s, e, *key)
        for ps, pe, cat, why, text in cache[key]:
            a, b = max(s, s + off + ps), min(e, s + off + pe)

            if b - a >= 1: rows.append((ep, a, b, cat, why, text[:2000], rid))
    # Story never repeats much; an unlabelled piece whose words recur across a good share of one show's
    # episodes is its theme or narrated opening. Whisper writes near-identical text for identical audio.
    def tkey(t):  # the eight longest distinct words: survives whisper starting a word or two early or late
        ws = sorted(set(re.findall(r"[a-z']{5,}", t.lower())), key=lambda w: (-len(w), w))[:8]
        return ' '.join(sorted(ws)) if len(ws) >= 5 else ''

    seen = defaultdict(set)
    for ep, a, b, cat, why, text, rid in rows:
        if cat == 'content' and tkey(text): seen[(show[ep], tkey(text))].add(ep)
    for i, (ep, a, b, cat, why, text, rid) in enumerate(rows):
        n = len(seen.get((show[ep], tkey(text)), ())) if cat == 'content' and tkey(text) else 0
        if n >= max(3, THEME_SHARE * show_eps[show[ep]]):
            rows[i] = (ep, a, b, 'intro' if a < 0.25 * duration[ep] else 'outro', f'theme: in {n} episodes', text, rid)
        elif n >= 3 and b - a < SHARED_LEN:
            # Story doesn't repeat word for word across episodes: this is a trailer's body, a recap or a cold open.
            # merge_final.py decides which from what sits next to it.
            rows[i] = (ep, a, b, 'repeat', f'repeat: in {n} episodes', text, rid)

    db.executescript("""DROP TABLE IF EXISTS labels;
      CREATE TABLE labels (ep INTEGER, start REAL, end REAL, category TEXT, matched TEXT, text TEXT, span_rowid INTEGER);
      CREATE INDEX labels_ep ON labels (ep, start);""")
    db.executemany('INSERT INTO labels VALUES (?,?,?,?,?,?,?)', rows); db.commit()

    tot = defaultdict(lambda: [0, 0.0])
    for r in rows: tot[r[3]][0] += 1; tot[r[3]][1] += r[2] - r[1]
    print(f'{len(rows):,} labelled pieces ({missing} spans without a transcript yet)')
    for cat, (n, secs) in sorted(tot.items(), key=lambda x: -x[1][1]): print(f'  {cat:10} {n:5} pieces  {secs/3600:5.1f} h')
    per = defaultdict(Counter); eps = defaultdict(set)
    for r in rows:
        if r[3] in ('sponsor', 'promo', 'selfpromo', 'bumper'): per[show[r[0]]][r[3]] += (r[2] - r[1]) / 60; eps[show[r[0]]].add(r[0])
    print('\nskippable minutes per show:  sponsor   promo  selfpromo  bumper   episodes')
    for s, c in sorted(per.items(), key=lambda x: -sum(x[1].values())):
        print(f'  {s[:40]:40} {c["sponsor"]:7.0f} {c["promo"]:7.0f} {c["selfpromo"]:9.0f} {c["bumper"]:7.0f}   {len(eps[s]):5}')


if __name__ == '__main__':
    main()
