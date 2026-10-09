# Changelog

All notable changes to AniStream are listed here. Each release has full notes in
[`.github/releases/`](.github/releases/), which also become the GitHub Release text.

Legend: 🎉 new feature · 💄 design · ⚡️ improvement · 🦺 fix · 🏗️ internal or compatibility ·
⬆️ dependency update

## v2.0.0 (unreleased)

A full redesign, plus movies and shows, an airing schedule, Up Next and playlists, and offline
library edits. [Full notes](.github/releases/v2.0.0.md)

- 🎉 More: New movies and shows section with TMDB browsing and search, title pages, and embedded
  playback that falls back across configured players
- 🎉 Up Next & Playlists: Queue titles or single episodes, save playlists, and autoplay the next one
  after a 5-second countdown
- 🎉 Airing schedule: Week, Month, and All airing views, plus a "Ready for you" strip
- 🎉 Offline mode: Library, edits, and progress work offline and sync when AniList is back
- 🎉 Simkl: Optional movie and show sync, with ratings, watch list, and a Simkl profile
- 🎉 For You: On-device recommendation engine with "Because you watched…" and "Because you
  like…" rows, an exploration pick, and Not interested feedback
- 🎉 Learn from my activity: For You learns from how you watch, on this device only, with an off
  switch that deletes the measurements
- 🎉 Settings: Account, Customize app, Playback, Reading, Backup, and Updates in one place
- 💄 Full-page title views, a new Home / Anime / Manga layout, Profile, manga reader, player,
  sign-in, and loading screens
- ⚡️ Per-section search with AniList filters, removable Continue cards, and MyAnimeList gap filling
- ⚡️ Optional extra English chapters for manga that MangaDex lacks
- ⚡️ More works without setup, Report a bug in the account menu, and anime player beacons blocked
- 🦺 Fixed manga chapters failing to load after a quick reopen, the chapter list not scrolling,
  player buttons that ignored clicks near their top edge, settings not persisting in installed
  builds, and AniList profile changes not showing
- 🏗️ 0.1.x backups still restore; releases include `SHA256SUMS.txt`
- 🏗️ Characters, Staff, and Related removed from anime and manga title pages
- ⬆️ Electron 44.7.0

## v0.1.7 (2026-09-14)

- ⚡️ Navbar account menu for guests and signed-in users
- ⚡️ Dedicated Settings view for local data, backups, and app updates
- 🦺 Fixed profile image alignment and account-menu keyboard behaviour

## v0.1.6 (2026-09-13)

- 🦺 New users no longer get stuck on the loading screen when AniList is unavailable
- 🏗️ Removed retired recommendation preview code and unused font assets

## v0.1.5 (2026-09-13)

- 💄 Ani logo in the navbar and native Windows and macOS app icons
- 🏗️ Leaner production codebase and README screenshots

## v0.1.4 (2026-09-13)

- 🎉 Coordinated Windows and macOS release built from one `main` commit
- 💄 Home and Profile redesign with Trending, Continue, For You, and Latest Updates rails
- ⚡️ Unified search, season selection, and launch readiness screen with recovery guidance
- 🦺 Continue opens the correct episode instead of falling back to Episode 1

## v0.1.3 (2026-08-11)

- ⚡️ Guarded startup with a clear failure screen
- ⚡️ Artwork fallbacks and steadier Latest Updates refreshes
- 🏗️ Tighter release permissions and a clean npm audit

## v0.1.0 – v0.1.2 (2026-08-02 – 2026-08-03)

- 🎉 First releases: AniList sign-in, discovery, personal library, and profile
