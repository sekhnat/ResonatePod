# Resonate

A podcast downloader and player for the Linux desktop, implemented from the
Claude Design mockups ("Resonate Podcast App"). It is built with React, TypeScript
and Vite on the **Nocturne** design system (dark, compact, Inter, Phosphor icons).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # store + OPML unit tests (Vitest)
npm run build      # typecheck + production build into dist/
```

## What's in it

The whole design is implemented and wired up:

| Area | Features |
| --- | --- |
| **Window** | KDE-style header bar (or GNOME with `?chrome=GNOME`), back/refresh, search field, main menu, window controls (minimize/close to tray, maximize) |
| **Sidebar** | New episodes / Shows / Queue / Downloads / Discover with live counts, subscriptions with unplayed badges, storage meter, Preferences |
| **Show page** | Artwork, Play latest, Subscribed (unsubscribe), effective auto-download rule, per-show settings; All / Unplayed / Downloaded filter; per-episode download/cancel/delete, play/pause, progress, mark played, add to queue |
| **New episodes** | Inbox across all shows, filters, add to queue, Mark all played, last/next feed check |
| **Shows** | Grid of subscriptions with "N new" tags, **Import OPML**, Add show |
| **Queue** | Drag-and-drop reordering, play next, remove, clear, total time; the next item plays automatically when an episode ends |
| **Downloads** | Active downloads with progress (respects *Simultaneous downloads*), pause/resume all, cancel, completed history, show in Files |
| **Discover** | Directory search, category chips, subscribe/unsubscribe, **add a feed by RSS URL** |
| **Preferences** | Auto-download, keep latest N, metered connections, simultaneous downloads, download folder, delete played, storage limit, default speed, trim silence, skip intervals, notifications, gpodder sync server, **Export OPML** |
| **Per-show overrides** | Auto-download, speed, silence trim, intro skip — each defaulting to *Global* |
| **Player bar** | Chapter skip, skip back/forward, play/pause, draggable seek bar with chapter ticks, speed, sleep timer, Now playing panel toggle, queue, volume/mute |
| **Now playing** | Side panel and full-window view with chapters (click to seek) and a transcript that follows playback |
| **Command palette** | <kbd>Ctrl</kbd>+<kbd>K</kbd>: commands, shows and episodes, arrow-key navigation |
| **Tray popover** | Plasma system-tray mini player: seek, speed, skip, sleep timer, up next, download status, pin |

Keyboard: <kbd>Space</kbd> play/pause · <kbd>←</kbd>/<kbd>→</kbd> skip ·
<kbd>Ctrl</kbd>+<kbd>K</kbd> palette · <kbd>Ctrl</kbd>+<kbd>R</kbd> refresh ·
<kbd>Ctrl</kbd>+<kbd>1–5</kbd> sections · <kbd>Ctrl</kbd>+<kbd>,</kbd> preferences ·
<kbd>Ctrl</kbd>+<kbd>/</kbd> shortcuts · <kbd>Ctrl</kbd>+<kbd>W</kbd> close to tray · <kbd>Esc</kbd> close overlays.

Library, playback position, queue, downloads and preferences persist in
`localStorage`.

## URL options

These mirror the design file's tweak panel:

| Param | Values | Default |
| --- | --- | --- |
| `chrome` | `KDE`, `GNOME` | `KDE` |
| `screen` | `inbox`, `shows`, `show`, `queue`, `downloads`, `discover`, `settings` | `show` |
| `subscriptions` | `false` hides the sidebar list | shown |
| `nowPlaying` | `false` starts with the panel closed | open |
| `tray` | `false` starts with the tray popover closed | open |
| `mode` | `app` fills the viewport, without the desktop frame and Plasma panel | framed |

## Current limits

This is the UI with a simulated engine, not yet a networked player:

- **Feeds, audio and downloads are simulated.** The catalogue is seed data from the
  design. Playback runs a clock with no audio output, and downloads progress at
  1.8 MB/s without fetching anything. Feeds added by URL or OPML are stored with
  their URLs, but their episodes aren't fetched.
- **Desktop integration is mocked.** The Plasma panel, tray, "Show in Files" and
  NetworkManager state are mocks. A real build would wrap this UI in Tauri or
  Electron, using MPRIS for media keys and a StatusNotifierItem for the tray.

## Layout

```
src/
  data.ts            seed catalogue, chapters, transcript, formatting helpers
  store.ts           Zustand store: playback clock, downloads, queue, rules, prefs
  model.ts           view-model helpers (episode rows, counts, labels)
  lib/opml.ts        OPML import/export
  components/        header, sidebar, player bar, now playing, dialogs, palette, Plasma/tray
  screens/           one file per screen
  styles/            nocturne.css (design system, verbatim) + app.css (states, menus, toasts)
```
