"""Classify short episodes (<= MAX_SECS) as a whole: announcement, crosspromo, trailer or content.

Usage: python3 -I short_eps.py FINGERPRINT_DB TEXT_DB [--review]

announcement  the host talking to listeners about the show (Patreon, a hiatus, live shows, a new project)
crosspromo    another show's trailer or ad dropped into the feed
trailer       a teaser for this show's own season or story (kept: it is the show's own content)
content       anything else (minisodes, short stories)
Writes `episode_kind` (ep, kind, why) to TEXT_DB; merge_final.py turns announcement / crosspromo into
whole-episode selfpromo / promo segments. Hand corrections live in OVERRIDES.
"""
import html, json, re, sqlite3, sys
sys.path.insert(0, __file__.rsplit('/', 1)[0] if '/' in __file__ else '.')
import label_full as LF

MAX_SECS = 600
ADDRESS = re.compile(r"\b(creator|writer|showrunner|producer|host)\b[^.]{0,30}\bhere\b|\b\w+ here,? (with|to|and|dropping|coming)\b|\bit is i\b|^\W*did you know (we|that we)\b|^\W*(hello|hi|hey|good (morning|evening)),? [\w ]{0,20}(fans|people|family|listeners|ardenites)\b|^(hi|hey|hello|greetings)\b[^.]{0,60}(everyone|everybody|listeners?|folks|friends|all|there|y'all|it's|this is|i'm)|"
                     r"\b(it's|this is) \w+( \w+)? (here|from|writer|creator|producer|host)\b|"
                     r"\b(dear|hello,?|hi,?|hey,?) listeners?\b|\bthanks? (you )?(so much )?for (listening|staying subscribed|your patience|sticking)", re.I)
ANNOUNCE = re.compile(r"patreon|kickstarter|crowdfund|ko-?fi|live show|tickets|hiatus|\bon (a )?break\b|update|announce|merch|"
                      r"\btour\b|we'?re back|new (podcast|show|project)|staying subscribed|this feed|bonus|donat|support (the|our|this) show|"
                      r"survey|q ?& ?a|\bnovel\b|\bbook\b|pre-?order|the next season|season \w+ (is|will)|coming back", re.I)
TEASE = re.compile(r"premier|coming (soon|this|on|in)|returns|trailer|available now|subscribe now|new episodes|"
                   r"wherever you (get|listen)|starting (on|this|next)|launch", re.I)
# ep -> kind, from hand review (2026-11-11): whisper garbled the show's name, so these looked like other shows.
OVERRIDES = {363: 'announcement', 1797: 'announcement', 1429: 'announcement', 1431: 'announcement',
             # novel excerpts and fundraiser / Patreon / Kickstarter updates that open without a greeting the rules know
             91: 'announcement', 93: 'announcement', 98: 'announcement', 105: 'announcement', 181: 'announcement',
             185: 'announcement', 187: 'announcement', 189: 'announcement', 198: 'announcement', 199: 'announcement',
             937: 'announcement', 1437: 'announcement',
             # another show's trailer or launch presented by this show's people
             99: 'crosspromo', 1837: 'crosspromo', 1980: 'crosspromo', 1989: 'crosspromo', 2000: 'crosspromo', 2009: 'crosspromo'}


def main():
    fp = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True); db = sqlite3.connect(sys.argv[2])
    review = 2 if '--review-rest' in sys.argv else 1 if '--review' in sys.argv else 0
    rows = db.execute('SELECT ep, show, duration, segments FROM ep_text WHERE duration <= ?', (MAX_SECS,)).fetchall()
    out = []
    for ep, show, dur, j in rows:
        segs = json.loads(j); text = ' '.join(t for _, _, t in segs)
        tok = lambda t: {re.sub(r"'s$", '', w.lower()) for w in re.findall(r"[A-Za-z']+", t)}
        name = {w for w in tok(show) if len(w) >= 4} - {'with', 'from', 'that', 'this', 'production', 'mystery', 'case'}
        words = tok(text)
        opening = ' '.join(t for _, _, t in segs[:4])
        own = bool(name & words)
        opens = bool(ADDRESS.search(opening))   # announcements open by talking to the listener
        addr = len(ADDRESS.findall(text)); ann = len(ANNOUNCE.findall(text)); tease = len(TEASE.findall(text))
        cues = sum(1 for _, _, t in segs if LF.cue_of(t)[0] in LF.SKIP or LF.STRONG.search(t))
        density = cues / max(1, len(segs))
        if opens and not own and (tease or cues >= 2) and ann <= tease + cues: kind = 'crosspromo'
        elif opens and ann >= 2: kind = 'announcement'
        elif not own and density >= 0.3: kind = 'crosspromo'
        elif tease or (own and cues >= 1): kind = 'trailer'
        else: kind = 'content'
        kind = OVERRIDES.get(ep, kind)
        why = f'opens={int(opens)} addr={addr} ann={ann} tease={tease} own={int(own)} cues={cues}'
        out.append((ep, kind, why))
        if review and (kind in ('announcement', 'crosspromo') if review == 1 else (kind in ('trailer', 'content') and ann + cues >= 3)):
            print(f'{kind[:5]} [{show[:18]}] ep{ep} {dur/60:.1f}m {why} | {text[:220]}')
    db.executescript('DROP TABLE IF EXISTS episode_kind; CREATE TABLE episode_kind (ep INTEGER PRIMARY KEY, kind TEXT, why TEXT);')
    db.executemany('INSERT INTO episode_kind VALUES (?,?,?)', out); db.commit()
    from collections import Counter
    print(Counter(k for _, k, _ in out))


if __name__ == '__main__':
    main()
