# AniStream v0.1.2

## A calmer, more focused Profile

This release redesigns the connected AniList Profile to make large anime and manga libraries easier
to browse and manage. The same list, rating, progress, and synchronization features remain, but the
interface now gives more space to your titles and less space to controls.

## What's new

### Simplified Profile

- Condensed the six-stat profile dashboard into two clear Anime and Manga summaries.
- Replaced the overflowing status-pill row with one native list selector.
- Moved Refresh AniList and Log out into a quiet profile options menu.
- Reduced the profile hero height while preserving AniList banner and avatar artwork.

### Cleaner library browsing

- Added a compact sticky toolbar for list type, list selection, filtering, sorting, and adding titles.
- Increased the default library density to six cards per row.
- Simplified card information while retaining format, score, status, progress, and completion.
- Kept cover images lazy-loaded and off-screen cards paint-contained for large libraries.

### Better entry editing

- Replaced the large inline editor with a focused modal sheet.
- Added Escape and backdrop closing, keyboard focus containment, and focus restoration.
- Added restrained Framer Motion transitions with reduced-motion and reduced-transparency support.
- Kept completed titles protected from invalid `+1` progress actions.

## Install on macOS

1. Download `AniStream-0.1.2-arm64.dmg` from this release.
2. Open the DMG and drag **AniStream** into **Applications**.
3. Open AniStream from the Applications folder.

This is an unsigned and unnotarized preview for Apple Silicon Macs running macOS 12 or newer. If
macOS blocks the first launch, Control-click AniStream, choose **Open**, then confirm **Open**. Do not
disable Gatekeeper globally.

## Verification

- 136 tests across 25 test files passed.
- TypeScript, ESLint, and Prettier checks passed.
- Production Electron/Vite build passed.
- Product-slice and AniList OAuth contract checks passed.
- Packaged CommonJS preload verified.
- DMG integrity verified with `hdiutil`.
- ARM64 executable, macOS 12 minimum, and `0.1.2` bundle metadata verified.

### Download checksum

```text
SHA-256  3ed8802519af1ca96c823e0ed9a8a8ae2003fd8f8669a905bd0d2da7e494e724
File     AniStream-0.1.2-arm64.dmg
```

## Known limitations

- The application is not yet signed or notarized with an Apple Developer ID.
- Streaming and reading availability depends on external providers and can change without notice.
- MegaPlay owns playback controls and exact seeking behavior inside its embedded player.
- MangaDex titles without chapters in the selected language may have an empty chapter list.
- Full MangaDex account synchronization remains planned and is not part of v0.1.2.
- Windows and Android versions remain under development and are not included in this release.

Only access media you are legally permitted to use in your region.

**Full changes:** [v0.1.1...v0.1.2](https://github.com/Athen2045/AniStream/compare/v0.1.1...v0.1.2)
