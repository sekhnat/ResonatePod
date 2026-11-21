#!/usr/bin/env bash
# Rebuild every label from the stored fingerprints and transcripts (no audio is re-transcribed). ~3 minutes.
# The scripts live here in the repo; the databases, logs and export stay in the data dir
# (~/Documents/resonate-adscan, overridable with ADSCAN_DATA).
set -euo pipefail
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${ADSCAN_DATA:-$HOME/Documents/resonate-adscan}"
cd "$DATA"
python3 -I "$SCRIPTS/label.py" fingerprints.db > label.log
python3 -I "$SCRIPTS/label_full.py" fingerprints.db fulltext.db > label_full.log
python3 -I "$SCRIPTS/short_eps.py" fingerprints.db fulltext.db > short_eps.log
python3 -I "$SCRIPTS/merge_final.py" fingerprints.db fulltext.db > merge_final.log
python3 -I "$SCRIPTS/review.py" fulltext.db apply > review.log   # hand verdicts (verdicts.json, lives beside the scripts)
python3 -I "$SCRIPTS/snap.py" fingerprints.db fulltext.db > snap.log
python3 -I "$SCRIPTS/export.py" fingerprints.db fulltext.db export/segments.json
cat merge_final.log review.log snap.log
