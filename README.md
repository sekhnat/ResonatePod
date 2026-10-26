# Resonate

A podcast downloader and player for the Linux desktop. It's an Electron app with a
React UI built on the **Nocturne** design system (dark, compact, Inter, Phosphor icons).

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
| **Subscriptions** | Subscribe by RSS URL, from Discover, or by OPML import. Feeds are re-checked hourly and on Ctrl+R, using ETag / Last-Modified. New episodes go to *New episodes*, with optional desktop notifications. |
| **Feeds** | RSS 2.0 with iTunes tags, Podcasting 2.0 `podcast:chapters` / `podcast:transcript`, and Podlove Simple Chapters. Show notes are shown as plain text. |
| **Discover** | Apple Podcasts directory: top charts by category, and search. Pasting a feed URL subscribes directly. |
| **Playback** | Streams, or plays the downloaded file. Resumes where you left off. Speed changes keep pitch. Skip intervals, chapter skip, a draggable seek bar, and volume/mute. |
| **Silence trim** | Web Audio level detection plays quiet stretches at 3×. Time saved is tracked. |
| **Chapters & transcripts** | Clickable chapter list. VTT/SRT/JSON transcripts that follow playback, in the side panel and the full-window view. |
| **Queue** | Drag to reorder, play next, remove, clear. The next item plays automatically when an episode ends. |
| **Sleep timer** | 15/30/60 minutes, end of chapter, end of episode. |
| **Downloads** | Saved to `~/Podcasts/<Show>/<date> - <title>.<ext>`. Concurrency limit, pause/resume (HTTP Range), cancel, delete, Show in Files. |
| **Auto-download** | Global *keep latest N* rule, overridable per show. |
| **Storage** | Deletes played files after 1 day or 1 week. A storage limit removes the oldest played files first. Pauses on metered connections (NetworkManager via `nmcli`). |
| **Per-show settings** | Auto-download, speed, silence trim, intro skip. |
| **Sync** | gpodder.net API v2 (also oPodSync, Nextcloud gPodder Sync): two-way subscriptions and play positions. The password is stored with the system keyring via Electron `safeStorage`. |
| **Desktop** | Frameless window whose header bar is the title bar (KDE or GNOME style, picked from `XDG_CURRENT_DESKTOP`). Close goes to the tray; the tray menu has playback, sleep timer, up next, downloads, refresh, open and quit. MPRIS media keys and widgets work through MediaSession. |
| **Command palette** | Ctrl+K: commands, shows and episodes. |

Keyboard: <kbd>Space</kbd> play/pause · <kbd>←</kbd>/<kbd>→</kbd> skip ·
<kbd>Ctrl</kbd>+<kbd>K</kbd> palette · <kbd>Ctrl</kbd>+<kbd>R</kbd> refresh ·
<kbd>Ctrl</kbd>+<kbd>1–5</kbd> sections · <kbd>Ctrl</kbd>+<kbd>O</kbd>/<kbd>E</kbd> import/export OPML ·
<kbd>Ctrl</kbd>+<kbd>,</kbd> preferences · <kbd>Ctrl</kbd>+<kbd>/</kbd> shortcuts ·
<kbd>Ctrl</kbd>+<kbd>W</kbd> close to tray · <kbd>Ctrl</kbd>+<kbd>Q</kbd> quit.

Data lives in `~/.config/Resonate/` (`library.json`, plus `secrets.json` holding the
encrypted sync password).

## Layout

```
electron/       main process: window, media protocol (local files + proxied streams with Range),
                download manager, tray, dialogs, nmcli, secrets, IPC; preload bridge
shared/         code used on both sides: feed parser, chapters/transcripts, gpodder client, types
src/
  platform.ts   typed bridge to the main process, with a browser fallback
  store.ts      Zustand store: library, playback state, downloads, rules, sync
  audio/        the audio engine (HTMLAudioElement + Web Audio + MediaSession)
  services.ts   wires the store to downloads, tray, network checks and timers
  screens/      one file per screen;  components/  shared UI
e2e/run.mjs     Playwright-driven Electron test against a local feed server
test/fixtures/  sample feed, chapters and transcript for unit tests
```

## Notes

- The tray uses StatusNotifierItem. GNOME needs the AppIndicator extension to show it.
- `npm run icons` regenerates `assets/*.png` from the SVGs. It needs `playwright` with
  Chromium installed.
