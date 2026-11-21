# Whisper pipeline for Resonate — Round 3: every new release, automatically

> Round 3. Rounds 1–2 planned a greenfield pipeline; it has since been built and run once by hand.
> This round makes it a feature of the app: the pipeline moves into this repo, a systemd timer runs it for
> every new release, and Resonate auto-imports the skip-lists and shows the whisper transcripts.

## Context

**The pipeline exists and has run.** `~/Documents/resonate-adscan/` (moved from its old location;
`run_all.sh`/`finish.sh` re-pointed, nothing else refers to the old path) holds:

- `fingerprint.py ~/Podcasts fingerprints.db [library-snapshot]` — fpcalc fingerprints, incremental by
  size+mtime, ignores `*.part`. A snapshot of Resonate's `library.db` links files → ep keys (2176/2261 linked).
- `match.py` — repeated-audio detection; **rebuilds** matches/spans/clips from all fingerprints in **~45 s**.
- `transcribe.py` — whisper on distinct repeated span audio → `span_text`; incremental, keyed by
  (episode, start, end) so a match.py rebuild keeps it. **Lacks the emulator-pause/`nice` handling that
  `transcribe_full.py` has** — must be fixed before it runs unattended.
- `transcribe_full.py` — whisper large-v3-turbo full-episode → `fulltext.db.ep_text`; incremental, niced,
  pauses while the PS5 emulator (`kyty_emulator`) holds the GPU.
- Label chain (no audio): `label.py` → `label_full.py` → `short_eps.py` → `merge_final.py` →
  `review.py apply` (495 hand verdicts in `verdicts.json`) → `snap.py` (~1 min) → `export.py` →
  `export/segments.json`. `run_all.sh` runs the chain in ~3 min.
- State: **2261 eps fingerprinted, 2149 transcribed (1119 h), 1911 entries in `export/segments.json`.**
  Quality: ~97% precision, ~94% recall.
- **`review.py` resolves `verdicts.json` beside itself** (`HERE`) — it moves with the scripts.
- `finish.sh` (wait for transcribe_full, then label+merge) is superseded by the new driver.

**Already imported into Resonate** (Settings → Import; 1780 episodes carry skips in
`~/.config/Resonate/library.db` `ep_state.skips`) — nothing there needs redoing.

**The gap:** `~/Podcasts` now holds **2719 files (41 shows)** — **~458 never processed** (new shows' back
catalogs). Every new release currently needs a manual pipeline run. Resonate auto-refreshes hourly while
running and auto-downloads new episodes, so new releases simply appear as files under `~/Podcasts/<Show>/`.

**App side today:**
- Skips: manual import only — `dialog:openSkips` IPC → `importSkips` (`src/store/slices/settings.ts`) merges
  by absolute file path, pins `fileBytes`; `parseSkipFile`/`cleanSegments` (`shared/skips.ts`) already accept
  the pipeline's format. The renderer is the sole writer of `library.db` (patch-based), so auto-import must
  happen in-app — not by an external write.
- Transcripts: `loadMeta` (`src/store/slices/player.ts`) fetches the feed's `podcast:transcript` URL only;
  `parseTranscript` (`shared/meta.ts`) parses VTT/SRT; UI already renders `meta.transcript` (`NowPlaying.tsx`).
  Nothing reads local transcript files. Scoped local reads exist: `media:chapters` IPC via
  `DownloadRoots.resolve` (`electron/paths.ts`) — the pattern to copy.
- `deleteFile` → `platform.deleteFile` IPC deletes the episode file; a sibling `.vtt` would be orphaned.
- `diskUsage` (`electron/downloads.ts`) sums *every* file — sibling `.vtt`s would inflate the storage figure.

## Decisions (this round)

1. **Trigger:** systemd user timer, hourly, `Persistent=true`, running an incremental driver.
2. **Location:** pipeline moves into this repo (`adscan/`); databases stay in `~/Documents/resonate-adscan/`
   (the data dir). `verdicts.json` moves with the scripts (it's pipeline curation, and `review.py` looks for
   it beside itself).
3. **Backfill:** run the driver once to catch up the ~458 unprocessed files (resumable, background).
4. **Transcripts:** in scope — the pipeline exports per-episode VTT, the app shows local transcripts.

## Approach

**1. `adscan/` in the repo — the pipeline as a feature** (moved from the data dir, unchanged unless noted):

```
adscan/
  README.md               install, data dir, timer, review workflow, dependency list (fpcalc, ffmpeg, whisper-cli)
  fingerprint.py  match.py  transcribe.py(+emulator pause/nice)  transcribe_full.py
  label.py  label_full.py  short_eps.py  merge_final.py  review.py  snap.py  export.py
  export_transcripts.py    NEW: fulltext.db ep_text segments → VTT beside each episode file
  verdicts.json            moved from the data dir (review.py resolves it beside itself)
  run_all.sh               moved; cds to the data dir, calls repo scripts by path
  new_episodes.sh          NEW driver (below)
  resonate-adscan.service/.timer + install.sh   → ~/.config/systemd/user/
```

Data dir `~/Documents/resonate-adscan/` keeps only data afterwards: `fingerprints.db`, `fulltext.db`,
`work/`, `export/`, logs. Old script copies there are removed once the repo ones run.

**2. Driver `new_episodes.sh`** (single instance via `flock`, logs to the data dir):

1. Snapshot the live library safely: `sqlite3 ~/.config/Resonate/library.db ".backup work/library-snapshot.db"`
   (the app keeps the DB open in WAL — a raw `cp` is not safe).
2. `fingerprint.py ~/Podcasts fingerprints.db work/library-snapshot.db` (seconds when nothing new).
3. If the fingerprint count changed → `match.py` (~45 s rebuild).
4. If spans/clips changed → `transcribe.py` (whisper on new span audio only).
5. `transcribe_full.py` (new episodes only; pauses for the emulator).
6. If anything changed → the `run_all.sh` chain + `export.py` → fresh `export/segments.json`,
   and `export_transcripts.py` → VTT for episodes not yet exported.

Steps 3–6 are gated on table counts before/after, so an idle hour costs ~1 minute.

**3. Timer:** `resonate-adscan.timer` (hourly, `Persistent=true`) → `resonate-adscan.service` → the driver.
GPU cost per cycle ≈ only the new episodes. Install via `adscan/install.sh` (copy units,
`systemctl --user daemon-reload && enable --now`).

**4. Resonate: auto-import skip-lists.** New setting `segmentsFile` (Preferences row: file picker, default
unset → feature off). On startup and on the existing services interval, stat the file; when size/mtime changed,
read it through a new `skips:read` IPC (pattern of `dialog:openSkips`, same size guard) and merge it by
reusing the `importSkips` merge (extracted to a shared function). Quiet: toast only when segments actually
changed. The manual Import… button stays.

**5. Resonate: local transcripts.** `export_transcripts.py` writes `<episode file>.vtt` beside each episode
(in `~/Podcasts`, inside the download roots — readable via `DownloadRoots.resolve`). New `media:transcript`
IPC (copy of `media:chapters`): resolves `<file>.vtt`, returns its text. In `loadMeta`: try the local VTT
first — it matches the actual downloaded audio (dynamic ads and all); fall back to the feed transcript URL.
`parseTranscript` already parses VTT. Also: `deleteFile` removes the sibling `.vtt`; `diskUsage` skips
non-audio files.

**6. One-time catch-up:** run the driver by hand → ~458 files fingerprinted (~1 min), span audio +
full episodes transcribed in the background (resumable; the emulator pause keeps the GPU shared fairly),
then labels, `export/segments.json` and VTTs. Re-import in the app picks everything up.

## Files to modify

**New — `adscan/` (moved/created, see tree above).**
**Resonate app:**
- `shared/settings.ts` — add `segmentsFile` setting
- `electron/ipc.ts` — `skips:read` (configured path) and `media:transcript` (scoped `.vtt` read); extend delete
- `src/platform.ts` — expose both to the renderer
- `src/store/slices/settings.ts` — extract the merge from `importSkips`; quiet auto-import action
- `src/services/index.ts` — startup import + mtime watch on the existing `setInterval`
- `src/store/slices/player.ts` — local-first transcript in `loadMeta`
- `src/store/slices/downloads.ts` / electron delete — remove sibling `.vtt`
- `electron/downloads.ts` — `diskUsage` ignores non-audio files
- `src/screens/SettingsScreen.tsx` (or Preferences) — Segments-file row + status; keep manual import
- `README.md` — document the adscan feature end to end
- `~/.config/systemd/user/resonate-adscan.{service,timer}` — installed by `adscan/install.sh`

## Reuse

- `importSkips` merge (`src/store/slices/settings.ts`) — path→key matching, `fileBytes` pinning
- `parseSkipFile` / `cleanSegments` / `parseTranscript` (`shared/skips.ts`, `shared/meta.ts`) — unchanged
- `dialog:openSkips` IPC pattern + size guard (`electron/ipc.ts`); `media:chapters` scoped-read pattern
- `maybeRefresh` interval pattern (`src/services/index.ts`) for the mtime check
- Pipeline scripts as-is: incremental and resumable already — only `transcribe.py` needs the pause/nice fix

## Steps

- [x] 1. Move the pipeline into `adscan/` (scripts + `verdicts.json` + `run_all.sh`); add the emulator pause +
      `nice` to `transcribe.py`; re-point `run_all.sh` at the data dir + repo script paths; `adscan/README.md`
- [x] 2. `export_transcripts.py`: `ep_text` segments → `<file>.vtt` beside the episode, skipping existing
- [x] 3. `new_episodes.sh` driver: flock, library snapshot, fingerprint → match → span-transcribe →
      transcribe_full → label chain + export (gated on change), log to the data dir
- [x] 4. systemd units + `install.sh`; enable the timer
- [ ] 5. Catch-up run of the driver (~458 files; whisper in the background)
- [x] 6. App: `segmentsFile` setting + `skips:read` IPC + platform surface + Settings/Preferences row
- [x] 7. App: extract the shared merge + quiet auto-import + mtime watch in services
- [x] 8. App: `media:transcript` IPC + local-first branch in `loadMeta`; `.vtt` cleanup on delete;
      `diskUsage` filter
- [x] 9. Tests: settings-slice auto-import (merge, unmatched, quiet), local-transcript fallback,
      `diskUsage` filter
- [x] 10. README: the automated flow, dependencies, install

## Verification

- `npm test` (vitest + db suite) for app changes
- Driver by hand: fingerprint reports the ~458, `match.log`/`transcribe.log`/`transcribe_full.log` advance,
  `export/segments.json` entry count and VTTs grow, counts in the app's import grow accordingly
- Timer: `systemctl --user list-timers`, `journalctl --user -u resonate-adscan.service`; an idle cycle
  finishes in ~1 min and rewrites nothing
- App: with `segmentsFile` configured — launch → skips present; touch `segments.json` → re-import within
  a minute, toast only on change; playback still jumps (`skipAt` untouched)
- Transcripts: an episode with no feed transcript shows the whisper VTT; an episode with both prefers local;
  deleting an episode removes its `.vtt`
- End to end: a genuinely new release is downloaded → next timer cycle fingerprints/transcribes/labels it →
  `segments.json` and VTTs updated → app auto-imports segments and shows the transcript
