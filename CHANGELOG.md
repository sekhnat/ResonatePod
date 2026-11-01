# Changelog

What's new in each release of Resonate. When a version is tagged, CI publishes
its entry here as the "What's new" section of the GitHub release, so every
release needs one.

## 1.8.1 (1 November 2026)

- Fixed: show and episode titles, author names, people and other feed text now
  display character references decoded, so a show appears as "Josie's Lonely
  Hearts Club" instead of "Josie&#39;s Lonely Hearts Club". Feeds that escape
  twice (`&amp;#39;`) or put HTML-escaped text in CDATA are decoded too, and
  subscribed shows are re-read once so their stored titles are corrected.

## 1.8.0 (30 October 2026)

- Added: back up the whole library — shows, episodes, downloads, playback
  history and preferences — to one file, and restore it.
- Added: reads Podcasting 2.0 feed tags — people, numbering, funding,
  soundbites, location, license and episode GUIDs. Existing subscriptions are
  re-read in full once so they pick the new tags up.

## 1.7.0 (29 October 2026)

- Faster: the window opens before the keyring and download folders are read,
  feeds that arrive together during a refresh are merged into one store update,
  download progress is batched to the window, the XML parser stays out of the
  window's main script, and the library is sent to it as one JSON string.
- Smaller: the app ships only what it loads — the renderer packages it uses,
  the 59 Phosphor icons it shows, and one Chromium locale. The silence
  analyser runs only for shows that trim.
- Fixed: the end-to-end test's flaky final "console errors" check.

## 1.6.0 (28 October 2026)

- The library now lives in a SQLite database and is saved as changes happen,
  keeping the app responsive with large libraries; an importer brings the old
  JSON library across.
- Feeds are parsed in a worker so the window stays responsive, long episode
  lists draw only the rows on screen, and a performance benchmark with
  budgets guards the hot paths.
- Security: a Content Security Policy for the page, inline styles folded into
  classes, the HTTP and file bridges confined and capped, and a login is no
  longer sent to another site when a redirect leaves the one it was for.
- Releases: a Flatpak is built and attached, the checksums are signed with
  Sigstore, and the AppImage carries update information with a `.zsync` for
  in-place updates.
- Fixed: downloads report disk write failures instead of "finishing", two
  episodes with the same day and title no longer overwrite each other's file,
  offline play history is no longer dropped after 500 entries, and a hung
  feed server no longer wedges a refresh.
- Tooling: Electron 43, fast-xml-parser 5, ESLint, CodeQL and Dependabot.

## 1.5.4 (27 October 2026)

- Fixed: long show titles and authors stay inside their cards on the Shows
  grid.

## 1.5.3 (27 October 2026)

- Fixed: downloads no longer get stuck on "Retrying" — due retries are
  queued first and the UI is told.

## 1.5.2 (27 October 2026)

- Changed: list screens fill the window instead of a fixed width.

## 1.5.1 (27 October 2026)

- Fixed: the header and About dialog show the real app version.

## 1.5.0 (27 October 2026)

- Added: sorting episodes on the show page and in the inbox.

## 1.4.0 (26 October 2026)

- The rewrite as a real Linux desktop app (Electron): discovery through the
  Apple Search, gpodder.net, fyyd and Podcast Index APIs, embedded chapters,
  resilient downloads, private and moved feeds, and video support.
- CI tests, packages the AppImage and .deb, and publishes releases from tags.