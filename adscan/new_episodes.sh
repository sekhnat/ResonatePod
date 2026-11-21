#!/usr/bin/env bash
# Pick up every new episode under ~/Podcasts and run it through the pipeline: fingerprint, match repeated
# audio, transcribe spans and whole episodes (whisper only does what is not done yet), then rebuild labels
# and the exports the app reads (export/segments.json + <episode>.vtt sidecars). Nothing to do: ~1 minute.
# Single instance via flock; safe to run by hand any time; the hourly timer runs it as a user service.
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${ADSCAN_DATA:-$HOME/Documents/resonate-adscan}"
PODCASTS="${RESONATE_PODCASTS:-$HOME/Podcasts}"
LIBRARY="${RESONATE_LIBRARY:-$HOME/.config/Resonate/library.db}"
STATE="$DATA/.state"; LOG="$DATA/new_episodes.log"
mkdir -p "$DATA/work/span" "$DATA/work/full" "$DATA/export"

exec > >(tee -a "$LOG") 2>&1
echo "── new_episodes start $(date '+%F %T')"

exec 9>"$DATA/.new_episodes.lock"
if ! flock -n 9; then echo "already running, exiting"; exit 0; fi

PY="python3 -I"
count() { sqlite3 "$1" "$2"; }

# The app keeps library.db open in WAL, so copy it through sqlite's .backup, not cp.
if [[ -f "$LIBRARY" ]]; then
  sqlite3 "$LIBRARY" ".backup '$DATA/work/library-snapshot.db'"
  LIB_ARG="$DATA/work/library-snapshot.db"
else
  LIB_ARG=""; echo "note: $LIBRARY not found; new files keep no episode-key link this cycle"
fi

FP=$(count "$DATA/fingerprints.db" "SELECT COUNT(*) FROM episodes WHERE fp IS NOT NULL")
TXT=$(count "$DATA/fulltext.db" "SELECT COUNT(*) FROM ep_text")
TXT_SPAN=$(count "$DATA/fingerprints.db" "SELECT COUNT(*) FROM span_text")
read -r S_FP S_TXT S_SPAN _ < "$STATE" 2>/dev/null || S_FP=""
echo "state: fingerprinted ${FP:-new}, full-transcribed ${TXT:-new}, span-transcribed ${TXT_SPAN:-new}"

echo "── fingerprint"
$PY "$SCRIPTS/fingerprint.py" "$PODCASTS" "$DATA/fingerprints.db" $LIB_ARG
FP2=$(count "$DATA/fingerprints.db" "SELECT COUNT(*) FROM episodes WHERE fp IS NOT NULL")

if [[ "$S_FP" == "" || "$FP2" != "$S_FP" ]]; then
  echo "── match ($FP2 fingerprinted, was ${S_FP:-nothing})"
  $PY "$SCRIPTS/match.py" "$DATA/fingerprints.db" > "$DATA/match.log"
  tail -3 "$DATA/match.log"
fi

echo "── transcribe spans"
$PY "$SCRIPTS/transcribe.py" "$DATA/fingerprints.db" "$DATA/work/span" 2>&1 | tail -3
SPAN2=$(count "$DATA/fingerprints.db" "SELECT COUNT(*) FROM span_text")

echo "── transcribe episodes"
$PY "$SCRIPTS/transcribe_full.py" "$DATA/fingerprints.db" "$DATA/fulltext.db" "$DATA/work/full" 2>&1 | tail -2
TXT2=$(count "$DATA/fulltext.db" "SELECT COUNT(*) FROM ep_text")

if [[ "$S_FP" == "" || "$FP2" != "$S_FP" || "$SPAN2" != "$S_SPAN" || "$TXT2" != "$S_TXT" ]]; then
  echo "── label, merge, review, snap, export"
  "$SCRIPTS/run_all.sh"
  $PY "$SCRIPTS/export_transcripts.py" "$DATA/fingerprints.db" "$DATA/fulltext.db"
  echo "── segments: $(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))))' "$DATA/export/segments.json") episodes"
else
  echo "── nothing new; labels unchanged"
fi
printf '%s %s %s %s\n' "$FP2" "$TXT2" "$SPAN2" "$(date +%s)" > "$STATE"
echo "── new_episodes done $(date '+%F %T')"
