# Resonate

[![CI](https://github.com/sekhnat/Resonate/actions/workflows/ci.yml/badge.svg)](https://github.com/sekhnat/Resonate/actions/workflows/ci.yml)

A podcast downloader and player for the Linux desktop. It's an Electron app with a
React UI built on the **Nocturne** design system (dark, compact, Inter, Phosphor icons).

## Install

Download the latest build from [Releases](https://github.com/sekhnat/Resonate/releases/latest):

- **AppImage** (any distribution): `chmod +x Resonate-*.AppImage && ./Resonate-*.AppImage`
- **Debian / Ubuntu**: `sudo apt install ./resonate_*_amd64.deb`

## Develop

```bash
npm install
npm run dev          # Vite + Electron with reload
npm test             # unit tests (Vitest)
npm run test:e2e     # drives the built app end to end (use `xvfb-run -a` on a headless box)
npm run dist         # release/Resonate-<version>.AppImage and resonate_<version>_amd64.deb
```

`npm run dev:web` runs the UI in a plain browser. It only streams, has no downloads, and
many feeds won't load there because of CORS.

## Features

| Area | What it does |
| --- | --- |
| **Subscriptions** | Subscribe by RSS URL, from Discover, or by OPML import. Feeds are re-checked hourly and on Ctrl+R, using ETag / Last-Modified. New episodes go to *New episodes*, with optional desktop notifications. Moved feeds are followed: permanent redirects (301/308) and `itunes:new-feed-url` update the stored address. |
| **Private feeds** | Token URLs (Patreon, Supercast, …) work as-is. Feeds behind HTTP Basic auth ask for a username and password, or take them from a pasted `https://user:pass@…` URL. Credentials are kept per server, encrypted with the system keyring, and also sent for enclosures on the same server. *Feed login…* in a show's settings changes them. |
| **Feeds** | RSS 2.0 with iTunes tags, Podcasting 2.0 `podcast:chapters` / `podcast:transcript`, and Podlove Simple Chapters. Show notes are shown as plain text. |
| **Video podcasts** | Video episodes show their picture in Now playing (double-click for full screen); audio keeps all the usual controls. |
| **Discover** | Searches Apple Podcasts ([Search API](https://performance-partners.apple.com/search-api)), [gpodder.net](https://gpodder.net/) and fyyd at once — plus [Podcast Index](https://api.podcastindex.org/) with your own free API key — merging results AntennaPod-style (each directory's rank, weighted and summed per feed). Or pick one directory. Apple episode matches are listed too. *Suggested for you* works like AntennaPod's: Apple's top chart for your region minus shows you follow, led by gpodder.net's personal suggestions when sync is connected. Browse Apple's regional charts or gpodder.net's most subscribed, by category. Pasting an Apple Podcasts link subscribes to the show's real feed. |
| **Playback** | Streams, or plays the downloaded file. Resumes where you left off. Speed changes keep pitch. Skip intervals, chapter skip, a draggable seek bar, and volume/mute. |
| **Silence trim** | Web Audio level detection plays quiet stretches at 3×. Time saved is tracked. |
| **Chapters & transcripts** | Clickable chapter list, from the feed or, failing that, from inside the file: ID3 `CHAP` frames (MP3) or Nero `chpl` (M4A), read from disk or with a few small Range requests while streaming. VTT/SRT/JSON and timed HTML transcripts follow playback; HTML and plain-text transcripts without timestamps are shown as text. |
| **Queue** | Drag to reorder, play next, remove, clear. The next item plays automatically when an episode ends. |
| **Sleep timer** | 15/30/60 minutes, end of chapter, end of episode. |
| **Downloads** | Saved to `~/Podcasts/<Show>/<date> - <title>.<ext>`. Concurrency limit, pause/resume (HTTP Range), cancel, delete, Show in Files. Network errors, stalls and server errors are retried with backoff (5 s up to 5 min), resuming from the partial file; failed downloads stay listed with *Retry*. Interrupted downloads resume when Resonate starts again. |
| **Auto-download** | Global *keep latest N* rule, overridable per show. |
| **Storage** | Deletes played files after 1 day or 1 week, checked hourly. A storage limit removes the oldest played files first. Changing the download folder offers to move existing downloads. Pauses on metered connections (NetworkManager via `nmcli`). |
| **Per-show settings** | Auto-download, speed, silence trim, intro skip. |
| **Sync** | gpodder.net API v2 (also oPodSync, Nextcloud gPodder Sync): two-way subscriptions and play positions. The password is stored with the system keyring via Electron `safeStorage`. |
| **Desktop** | Frameless window whose header bar is the title bar (KDE or GNOME style, picked from `XDG_CURRENT_DESKTOP`). Close goes to the tray; the tray menu has playback, sleep timer, up next, downloads, refresh, open and quit. MPRIS media keys and widgets work through MediaSession. Window size and position are remembered. *Start Resonate when you log in* writes an XDG autostart entry that opens hidden in the tray. |
| **Command palette** | Ctrl+K: commands, shows and episodes. |

Keyboard: <kbd>Space</kbd> play/pause · <kbd>←</kbd>/<kbd>→</kbd> skip ·
<kbd>Ctrl</kbd>+<kbd>K</kbd> palette · <kbd>Ctrl</kbd>+<kbd>R</kbd> refresh ·
<kbd>Ctrl</kbd>+<kbd>1–5</kbd> sections · <kbd>Ctrl</kbd>+<kbd>O</kbd>/<kbd>E</kbd> import/export OPML ·
<kbd>Ctrl</kbd>+<kbd>,</kbd> preferences · <kbd>Ctrl</kbd>+<kbd>/</kbd> shortcuts ·
<kbd>Ctrl</kbd>+<kbd>W</kbd> close to tray · <kbd>Ctrl</kbd>+<kbd>Q</kbd> quit.

Data lives in `~/.config/Resonate/`: `library.json`, `window.json`, and `secrets.json`
holding the encrypted sync password, feed logins and Podcast Index key. The library is written only when
something in it changes (debounced); the playback position is saved every 30 s while
playing, on pause, and on quit.

## Layout

```
electron/       main process: window, media protocol (local files + proxied streams with Range),
                download manager, tray, dialogs, nmcli, secrets, IPC; preload bridge
shared/         code used on both sides: feed parser, chapters/transcripts, embedded chapters
                (ID3/MP4), gpodder client, types
src/
  platform.ts   typed bridge to the main process, with a browser fallback
  store.ts      Zustand store: library, playback state, downloads, rules, sync
  lib/directory/ Apple, gpodder.net, fyyd and Podcast Index clients; combined search and suggestions
  audio/        the playback engine (one media element + Web Audio + MediaSession)
  services.ts   wires the store to downloads, tray, network checks and timers
  screens/      one file per screen;  components/  shared UI
e2e/run.mjs     Playwright-driven Electron test against a local feed server (directories are served
                from test/fixtures/directory via the RESONATE_URL_REWRITE test hook)
test/fixtures/  sample feed, chapters, transcript, and small media files (chaptered MP3/M4A, video)
```

## Notes

- The tray uses StatusNotifierItem. GNOME needs the AppIndicator extension to show it.
- `npm run icons` regenerates `assets/*.png` from the SVGs. It needs `playwright` with
  Chromium installed.
- CI (`.github/workflows/ci.yml`) runs the typecheck, unit tests and end-to-end test on
  every push, then builds and smoke-tests the AppImage and .deb (kept on the run for 7 days).
  To release, bump `version` in `package.json` and push a matching tag (`git tag v1.4.1 &&
  git push origin v1.4.1`); CI attaches the packages and checksums to a GitHub release.
