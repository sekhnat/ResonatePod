# adscan — sponsor-block style ad skipping for Resonate

Fingerprints + transcripts of the downloaded podcast library, turned into skip segments
(`sponsor`, `promo`, `selfpromo`, bumper, intro, outro, recap) and per-episode transcripts for the app to use.
The scripts live here in the repo; the heavy state (databases, work files, logs, export) lives in the
**data dir**, by default `~/Documents/resonate-adscan` (override with `ADSCAN_DATA`).

## How it fits together

```
~/Podcasts/<Show>/<date> - <title>.mp3                     Resonate's downloads
        │ fingerprint.py     fpcalc → fingerprints.db      (incremental; links files to ep keys
        │                                                   via a snapshot of Resonate's library.db)
        ├─ match.py          repeated audio → matches/spans/clips in fingerprints.db
        ├─ transcribe.py     whisper on distinct repeated span audio → span_text
        ├─ transcribe_full.py whisper, whole episodes → fulltext.db ep_text
        ├─ run_all.sh        label → label_full → short_eps → merge_final → review apply →
        │                    snap → export.py → <data>/export/segments.json
        └─ export_transcripts.py  ep_text segments → <episode file>.vtt beside each episode
```

- Every step is incremental and resumable; `new_episodes.sh` runs the whole chain for whatever is new
  (fingerprint → match → span-transcribe → full-transcribe → labels → exports).
- Whisper runs on CUDA with `ggml-large-v3-turbo`; both whisper callers are niced and pause while
  `kyty_emulator` holds the GPU.
- Skip categories and the segments-file format are documented in the main README ("Skip segments");
  `export/segments.json` is that file, keyed by absolute episode path.
- Measured by hand on the 2,149-episode corpus (precision: an 80-segment sample plus 25 bridged
  stretches; recall: a fresh 15-episode sample): ~97% precision, ~94% recall. The corpus has since
  grown to 2,438 episodes (1,316 h).

## Install

Dependencies: `ffmpeg`, `fpcalc` (chromaprint), `whisper-cli` on PATH (CUDA build with
`models/ggml-large-v3-turbo.bin` under `~/Documents/Projects/WhisperExperiments/whisper.cpp`).

The timer makes every new release flow through on its own:

```sh
adscan/install.sh              # copies the systemd user units and enables the hourly timer
systemctl --user list-timers   # resonate-adscan.timer
```

Manual runs: `adscan/new_episodes.sh` (driver; safe to run by hand any time) or `adscan/run_all.sh`
(rebuild labels/exports from stored data, ~3 min, no audio). The driver takes a single-instance lock.

## App side

Resonate picks this up two ways once configured in Preferences:

- **Segments file** (`segmentsFile` setting): point it at `<data>/export/segments.json`; the app watches
  its mtime/size and re-imports quietly when the pipeline rewrites it.
- **Local transcripts**: `export_transcripts.py` writes `<episode>.vtt` beside each episode
  (inside the download roots), and the player prefers it over the feed's `podcast:transcript`.

## Review workflow (quality upkeep)

Verdicts live in `verdicts.json` here, one judgement per distinct piece of repeated audio:

```sh
cd <data dir>
python3 -I <repo>/adscan/review.py fulltext.db group      # cluster segments by transcript text
python3 -I <repo>/adscan/review.py fulltext.db show 0 50  # print groups for judging
# ... add verdicts to verdicts.json ("ok" | "drop" | category), then:
python3 -I <repo>/adscan/review.py fulltext.db apply
```

After any rule change run `run_all.sh`, then `review.py group`, judge what's unsure/unjudged, repeat.
Judge only what isn't confident — that's how the 495 current verdicts were made.
