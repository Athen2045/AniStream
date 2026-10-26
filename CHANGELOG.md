# Changelog

All notable changes to AniStream are listed here. Each release has full notes in
[`.github/releases/`](.github/releases/), which also become the GitHub Release text.

Legend: 🎉 new feature · 💄 design · ⚡️ improvement · 🦺 fix · 🔒 security · 🏗️ internal or
compatibility · ⬆️ dependency update

## v2.1.2 (2026-10-26)

No more ad pop-ups from the new movie and show players, keyboard controls that keep working, and a
quicker way to the next episode. [Full notes](.github/releases/v2.1.2.md)

- ⚡️ During an episode's ending, Skip becomes Next episode (own player and main anime player)
- ⚡️ Players take the keyboard as soon as they start
- 🔒 Movies & TV players could open ads in your web browser (#38)
- 🦺 Own player shortcuts stopped working after clicking its buttons or sliders (#38)
- 🦺 Space right after a player opened went back to the title page
- 🦺 Escape on the own player's settings menu also closed the player
- 🦺 The X to remove a show from Anime's Continue Watching didn't appear

## v2.1.1 (2026-10-23)

Smoother downloads and navigation, and a handful of fixes for small annoyances.
[Full notes](.github/releases/v2.1.1.md)

- ⚡️ Back returns you to where you started watching or reading, not to the title page
- ⚡️ Season downloads ask in a clear pop-up with the episode count, quality and size
- ⚡️ The season picker only shows when there is something to pick (One Piece keeps its arcs)
- 💄 One Back button everywhere: title pages, players and the manga reader
- 🦺 Download all and the Up Next menu could be cut off on anime title pages
- 🦺 Escape on a pop-up also closed the title page behind it
- 🦺 Letters like g, p and y were cut off at the bottom of home page titles
- 🦺 The Back button on movie and show pages was partly hidden

## v2.1.0 (2026-10-22)

A new look, a new Search, our own video player with Skip opening and ending, and anime downloads
you can watch offline. [Full notes](.github/releases/v2.1.0.md)

- 🎉 New look: A slim side rail replaces the top bar, with a darker theme
- 🎉 Search: Anime, Manga or Movies & TV with results as you type, filters and "Did you mean"
- 🎉 Own player: Skip opening and ending, seek previews, audio and subtitle choice, automatic backup
- 🎉 Downloads: Watch anime episodes offline; title pages you've opened work offline too
- 🎉 For You without an account, learning from what you watch and read on this device
- ⚡️ Trending, For You and Search stay loaded when you switch sections
- ⚡️ Next-episode countdown matches Skip opening and shows in fullscreen
- ⚡️ Aired episodes that aren't available yet are named instead of showing broken tiles
- 🦺 Movies & TV: Next episodes watched inside the player now update Continue Watching
- 🦺 For You: Not interested works again, and titles opened from it list every episode

## v2.0.1 (2026-10-11)

In-app updates on Windows, a taste map, smarter For You, and about half the memory at idle.
[Full notes](.github/releases/v2.0.1.md)

- 🎉 Windows updates: New releases download in the background and install when you choose
  Restart to update, checked against the release's SHA-512 hash
- 🎉 Taste map: See your taste as a graph of what you've liked, grouped into named tastes
- ⚡️ For You: Picks you keep scrolling past fade out, sequels and next films get their own rows,
  and you can hide genres and tags
- ⚡️ About half the memory at idle, and more freed when minimized
- ⚡️ Smaller install (about 37 MB less on disk) and less code to load at startup
- 🔒 The installed app can no longer be run as a plain Node.js process

## v2.0.0 (2026-10-09)

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
