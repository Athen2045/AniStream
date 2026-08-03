# AniStream v0.1.1

## Browse first. Connect when you want.

AniStream no longer opens behind an AniList login screen. You can now launch the app and browse
anime and manga, search for titles, open details, watch episodes, read chapters, and keep local
resume progress without connecting an account.

Connect AniList from **Profile** when you want personalized Continue rows, list management, ratings,
and tracker syncing.

## What's new

### Guest access

- Browse Trending and Latest Updates while signed out.
- Search anime and manga from the shared search bar.
- Open title details, episode lists, and chapter lists without an AniList session.
- Watch anime and read MangaDex chapters with local resume state.
- Keep AniList-only actions hidden until an account is connected.

### New Profile connection experience

- Replaced the startup login wall with a dedicated Profile sign-in page.
- Added a centered, simplified **Make AniStream yours** connection screen.
- Added clear restoring, browser-authorization, cancellation, and error states.
- Added a reduced-motion-aware Framer Motion transition from sign-in to the authenticated Profile.
- Kept AniList credentials and session storage in the trusted Electron process and macOS Keychain.

### Personalization boundary

- Continue Watching and Continue Reading appear only for connected AniList users.
- Add, remove, rating, progress, and completion controls are hidden from guests.
- Open details remount safely when a guest becomes an authenticated viewer.
- Signed-in users retain the existing AniList profile and complete anime and manga libraries.

### Release and documentation

- Reworked the README with simple GitHub Releases installation instructions followed by a complete
  developer architecture and setup reference.
- Updated the macOS release workflow to attach the DMG with the repository-scoped GitHub token.
- Added explicit artifact checks so a missing DMG fails the release job.
- Bumped the application and package version to `0.1.1`.

## Install on macOS

1. Download `AniStream-0.1.1-arm64.dmg` from this release.
2. Open the DMG and drag **AniStream** into **Applications**.
3. Open AniStream from the Applications folder.

This is an unsigned and unnotarized preview for Apple Silicon Macs running macOS 12 or newer. If
macOS blocks the first launch, Control-click AniStream, choose **Open**, then confirm **Open**. Do not
disable Gatekeeper globally.

## AniList connection note

AniStream works without an account. The public preview does not package an AniList OAuth client
secret, so account syncing may require developer configuration. Browsing, playback, reading, and
local resume remain available while signed out.

## Platform status

- **macOS on Apple Silicon:** available in this release.
- **Windows:** under development; no Windows package is included.
- **Android:** under development; no APK is included.

## Verification

- 136 tests across 25 test files.
- TypeScript, ESLint, and Prettier checks passed.
- Production Electron/Vite build passed.
- Product-slice and AniList OAuth contract checks passed.
- Packaged CommonJS preload verified.
- DMG integrity verified with `hdiutil`.
- ARM64 executable and `0.1.1` bundle metadata verified.

### Download checksum

```text
SHA-256  f4e92b2ba3b7316a7588e287c65aa2c45fe4239242711f60554cdcf0e904f245
File     AniStream-0.1.1-arm64.dmg
```

## Known limitations

- The application is not yet signed or notarized with an Apple Developer ID.
- Streaming and reading availability depends on external providers and can change without notice.
- MegaPlay owns playback controls and exact seeking behavior inside its embedded player.
- MangaDex titles without chapters in the selected language may have an empty chapter list.
- Full MangaDex account synchronization remains planned and is not part of v0.1.1.

Only access media you are legally permitted to use in your region.

**Full changes:** [v0.1.0...v0.1.1](https://github.com/Athen2045/AniStream/compare/v0.1.0...v0.1.1)
