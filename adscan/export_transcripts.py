"""Write each episode's transcript as <episode file>.vtt, for the app to show when the feed has none.

Usage: python3 -I export_transcripts.py FINGERPRINT_DB TEXT_DB [--force]

Reads fulltext.db `ep_text` (ep, segments JSON of [from_s, to_s, text]) and resolves paths through
FINGERPRINT_DB episodes. The app reads the sidecar through its download roots, so skipping anything
outside them (or missing on disk) is right. Incremental: a VTT is (re)written when the audio file is
newer than it (episodes re-downloaded with new dynamic ads get re-made, the rest cost one stat).
"""
import argparse, json, os, sqlite3, time


def stamp(sec):
    ms = round(sec * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02}.{ms % 1000:03}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('fp'); ap.add_argument('text'); ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    fp = sqlite3.connect(f'file:{a.fp}?mode=ro', uri=True)
    db = sqlite3.connect(f'file:{a.text}?mode=ro', uri=True)
    path = dict(fp.execute('SELECT id, path FROM episodes'))
    written = unchanged = missing = empty = 0
    for ep, segs_json in db.execute('SELECT ep, segments FROM ep_text ORDER BY ep'):
        segs = json.loads(segs_json)
        if not segs: empty += 1; continue
        src = path.get(ep)
        if not src: missing += 1; continue          # fingerprinted then removed from episodes
        vtt = os.path.splitext(src)[0] + '.vtt'   # the app looks for <episode>.vtt, whatever the audio's extension
        try:
            if not a.force and os.path.exists(vtt) and os.path.getmtime(vtt) >= os.path.getmtime(src):
                unchanged += 1; continue
        except FileNotFoundError: missing += 1; continue   # audio gone (played and deleted): no sidecar wanted
        try:
            with open(vtt, 'w', encoding='utf-8', newline='\n') as f:
                f.write('WEBVTT\n\n')
                for start, end, text in segs:
                    f.write(f'{stamp(start)} --> {stamp(end)}\n{text}\n\n')
        except OSError: missing += 1; continue       # read-only download root, etc.
        written += 1
    print(f'{written:,} transcripts written, {unchanged:,} unchanged, {empty:,} without text, '
          f'{missing:,} files not on disk ({time.strftime("%H:%M")})', flush=True)


if __name__ == '__main__':
    main()
