# AniStream — Context

Last updated: 2026-07-27 by Codex macOS application-icon session

## Current phase

Phase 2 product shell: AniList login now restores durably, and the packaged app has Anime, Manga,
and My Lists navigation, unified search, paginated browse, rich title details, and the native anime
provider contract chain. Actual HLS/torrent extraction and MangaDex chapter reading remain.

## What's working right now

- `npm install` completes and rebuilds `better-sqlite3` for Electron 43 on Apple Silicon.
- `npm run typecheck` passes for main, preload, shared contracts, and renderer.
- `npm run build` produces main, preload, and renderer production bundles.
- `npm run typecheck` and `npm run build` pass with the AniList authentication/profile/list implementation.
- The updated HLS-primary/torrent-fallback status contract passes typecheck and production build.
- `npm run dev` launches the Electron application successfully.
- The signed-out AniList application UI launches successfully in development and in the corrected packaged macOS application.
- The packaged preload is emitted as sandbox-compatible CommonJS at `out/preload/index.cjs`, and BrowserWindow requests that exact path.
- `npm run check:packaged-preload` inspects the real packaged ASAR and fails if main requests a missing preload or if the preload is emitted as ESM. The test failed on both historical defects and passes on the corrected package.
- The corrected packaged executable was launched with Electron logging enabled for more than eight seconds with no preload, bridge, or renderer console errors.
- The macOS bundle registers `anistream://` in `Info.plist`; `plutil -lint` passes.
- AniList's public GraphQL endpoint returned the expected `Athen101` profile statistics and complete anime-list shape for every field consumed by the new UI.
- The trusted main process opens AniList authorization-code OAuth using public client ID `47053`, receives `anistream://auth/anilist?code=…`, exchanges the code at the official token endpoint, verifies the token using `Viewer`, and encrypts it using asynchronous Electron `safeStorage`.
- If the Keychain item is absent, the trusted main process opens a native macOS hidden-input dialog, stores the submitted client secret under service `dev.anistream.desktop.anilist-client`, and continues authorization. `npm run configure:anilist` remains a fallback.
- `npm run check:anilist-oauth` verifies the built main process uses `response_type=code`, `grant_type=authorization_code`, Keychain lookup/storage, and the native secure prompt, and rejects a return to implicit OAuth.
- When AniList returns HTTP 401, `invalid_client`, or “Client authentication failed” during token exchange, AniStream removes only its rejected Keychain credential and tells the user to retry with the current secret instead of repeatedly reusing a bad value.
- The encrypted AniList session now stores the token plus a normalized profile snapshot and restores
  before the renderer is created. A complete stop/fresh launch of both the development and packaged
  apps reopened directly to Anime without showing the connection screen.
- The packaged app restored the user's real AniList profile and full anime/manga lists; explicit
  logout remains the only UI action that removes the valid saved session.
- Anime, Manga, and My Lists are first-class navbar destinations with a shared AniStream shell.
- Unified debounced search returns mixed anime/manga suggestions from AniList, supports keyboard
  navigation and Cmd+K focus, and was live-tested with `Naruto` (8 rendered suggestions).
- AniList `Page` browse supports trending/popularity/score/newest sorting and bottom pagination.
  The packaged app rendered a hero, 6 shelf cards, 17 browse cards, and moved to page 2 without
  renderer errors.
- Rich `Media` details include summary, format/status, episode/chapter counts, scores, dates,
  studios/producers, genres, source, cast, staff, relations, recommendations, external links,
  trailer URL, and the authenticated user's list-entry context.
- The inspected Netflix Figma system informed the black/neutral/red palette and translucent control
  hierarchy. AniStream adds cyan tracker/status accents; Manga uses taller editorial cards and serif
  hero typography inspired by reader/catalog products.
- Native TypeScript provider contracts exist in `src/shared/providers.ts`:
  `AnimeTitleMapping → AnimeSeason → AnimeEpisode → AnimeHoster → AnimeVideoVariant`, with an
  `AnimeSourceAdapter` boundary and HLS/torrent kinds.
- `npm run check:product-slice` guards session-before-window ordering, browse/detail IPC, navbar UI,
  and provider contracts.
- The profile UI supports anime/manga tabs, status/custom list groups, local title filtering, AniList catalog search/add-to-planning, refresh, logout, status/score/progress/notes edits, one-click progress increments, and list-entry removal.
- Access tokens remain in the main process; typed preload IPC exposes only normalized account/list values and bounded mutation inputs.
- The main process creates `anistream.sqlite` under the macOS application-support directory with `app_meta`, `library_entries`, and `sync_queue` tables.
- `npm run package:mac` produces the 130 MB `dist/AniStream-0.1.0-arm64.dmg`.
- The macOS package uses the custom 1024×1024 artwork at
  `assets/app-icon/AniStream-1024.png`; Electron Builder embeds it as
  `AniStream.app/Contents/Resources/icon.icns`, and the bundle's `CFBundleIconFile` points to it.
- The postinstall step explicitly verifies/downloads Electron and rebuilds the native SQLite module, addressing the missing-binary failure observed during the first launch attempt.
- `npm audit --omit=dev` reports zero runtime dependency vulnerabilities.
- `README.md`, `AGENTS.md`, `API.md`, and this context file now follow the required documentation roles.
- Phase 0 research is recorded in `docs/research/phase-0.md`.
- Current Consumet and Aniyomi evaluations are recorded in `docs/research/consumet-evaluation.md` and `docs/research/aniyomi-evaluation.md`.

## What's in progress

- No source provider is connected to the new Watch surface. It intentionally shows a truthful
  unavailable state until the approved AnimePahe-style HLS adapter is re-verified and implemented.
- Manga browse/details use AniList; MangaDex chapter feeds, account sync, and reader are not connected.

## Open decisions (need user input)

- None currently blocking the next vertical slice.

## Known issues / tech debt

- MangaDex, offline sync/reconciliation, and concrete video-source adapters are documented but not implemented.
- Regression scripts exist, but there is no unit/integration test runner or provider-fixture suite yet.
- The DMG is unsigned because no valid Developer ID Application certificate is installed.
- Full `npm audit` reports 16 high-severity advisories in electron-builder's development/packaging dependency tree (`brace-expansion`/`minimatch` lineage). Runtime-only audit is clean. npm's offered forced fix downgrades electron-builder across a breaking change and was not applied.
- The renderer now has the first production-direction Anime/Manga/Profile shell, but continue
  watching/reading, full reader/player controls, activity/social functions, favorites, notifications,
  and advanced AniList statistics are not implemented.
- MangaDex password-based personal-client credentials are still represented as development environment variables; real use must move credentials/tokens to macOS Keychain.
- Native anime playback contracts are implemented; source health, migrations, concrete HLS/torrent
  adapters, and playback resolution are not.
- No persisted AniList dashboard cache, request deduplication/throttle queue, pending offline mutations, activity feed, or social features exist yet.
- Authenticated `Viewer` and full list loading were exercised with the saved user token. A reversible
  live mutation/delete was not performed in this session.
- The AniList client secret was shared in chat. It is not present in source, output, documentation, or the packaged app; the user should rotate it in AniList developer settings if regeneration is available, then store the replacement with `npm run configure:anilist`.
- AniList rejected the client secret entered by the user with “Client authentication failed.” The request body and endpoint match AniList's current official authorization-code example, so the current evidence points to a stale/miscopied secret or a secret from a different AniList client; the actual credential cannot be independently verified without a fresh one-time authorization code.
- AniList's current official documentation still describes implicit OAuth, but the live authenticated authorization server returned `unsupported_grant_type` for `response_type=token` on 2026-07-27. Authorization code is the verified compatibility path for this client.

## Next steps (in priority order)

1. Re-verify the approved AnimePahe-style source and implement the first removable HLS adapter,
   episode resolver, variant selection, and internal player; then add AnimeTosho/Nyaa torrent fallback.
2. Implement MangaDex chapter browsing, MangaDex@Home proxy/reporting, and the first reader modes.
3. Implement full MangaDex personal-client authentication, follows, and read-marker sync using Keychain.
4. Add request deduplication, conservative throttling, and persisted AniList catalog/dashboard caches.
5. Add local playback/reading progress, continue-watching/reading rails, pending mutation queue, and
   conflict-safe reconciliation.
6. Add AniList favorites, activity feed, reviews/recommendations actions, notifications, and richer
   statistics incrementally; do not interpret “all API fields” as a reason to expose unsafe moderator
   or irrelevant platform operations.
7. Add provider fixtures/tests and valid Developer ID signing/notarization.

## Key architectural decisions log

- 2026-07-26: Initial API-first prototype created before full provider research. This is now considered provisional rather than a committed architecture.
- 2026-07-26: AniList selected as the recommended primary metadata and tracker source because public reads, authenticated list mutations, and the target discovery/list UX share its data model.
- 2026-07-26: MangaDex selected as the recommended manga catalog/chapter provider; correct implementation must use MangaDex@Home and proxy image requests.
- 2026-07-26: Direct AniDB integration recommended for deferral from v1 because its HTTP API is limited, registration-gated, strictly paced, and largely overlaps AniList. User may override.
- 2026-07-26: `public-apis` treated only as a discovery index; provider facts must come from each provider's own current documentation and live verification.
- 2026-07-26: Zenshin adopted only as an architecture reference for separating metadata, mapping, and media-source adapters. No scraping target is selected.
- 2026-07-27: Chose Electron + React + TypeScript + SQLite for the Apple Silicon macOS desktop app. This keeps the primary implementation in TypeScript, supports local files/media, secure main-process integrations, custom-protocol OAuth callbacks, and follows the useful parts of Zenshin's proven desktop shape. The accepted tradeoff is a larger binary and higher memory use than Tauri.
- 2026-07-27: User chose scraped/aggregator anime video sources similar to Zenshin. The architecture permits replaceable adapters, but no specific target is approved yet.
- 2026-07-27: User chose full MangaDex account synchronization for v1, including follows and read markers in addition to catalog/chapter delivery.
- 2026-07-27: Established Electron 43 + React 19 + TypeScript 7 + electron-vite 5 + SQLite (`better-sqlite3`) as the verified initial implementation. Main-process persistence and the typed preload seam both launch successfully on Apple Silicon macOS.
- 2026-07-27: Approved AnimePahe-style HLS as the primary anime playback source, with AnimeTosho/Nyaa-indexed torrents as fallback. Source metadata remains separate from AniList metadata, and each source must fail independently behind a removable adapter.
- 2026-07-27: Evaluated Consumet and rejected it as a current runtime/API dependency. Its public API is withdrawn, core repositories were unavailable after a March 2026 DMCA notice, and reusable-code licensing could not be resolved confidently. Its general removable-provider pattern remains useful reference material.
- 2026-07-27: Evaluated active Apache-2.0 Aniyomi as an architecture and product-behavior reference only. AniStream will adapt its source boundaries, migration concepts, rich video result shape, and local-media model in native TypeScript; Android APK extensions are not compatible with or trusted by the Electron application.
- 2026-07-27: Chose AniList's implicit OAuth grant for the personal desktop app, using public client ID `47053` and `anistream://auth/anilist`. This avoids packaging a client secret. The one-year token is verified with `Viewer`, encrypted with macOS Keychain-backed Electron `safeStorage`, and never crosses into the renderer.
- 2026-07-27: Implemented AniList profile and list management as the first product surface. `MediaListCollection` preserves status and custom groups; mutations are owned by the main process behind typed IPC.
- 2026-07-27: Fixed the packaged blank screen. `package.json` marks the project as ESM, so electron-vite originally emitted `index.mjs`; sandboxed preload execution rejected its `import` syntax. The preload build is now explicitly CommonJS (`index.cjs`), BrowserWindow uses the matching path, and an ASAR-level regression check enforces both presence and format.
- 2026-07-27: Superseded the implicit OAuth decision after AniList's live server rejected `response_type=token` with `unsupported_grant_type`. AniStream now uses authorization code exchange; the required client secret is stored and retrieved only through macOS Keychain and is not packaged, committed, placed in `.env`, or sent to the renderer.
- 2026-07-27: Removed manual Keychain setup as a login prerequisite. When the AniList secret is absent, the trusted main process now obtains it through a native macOS hidden-input dialog and saves it directly to Keychain before opening authorization; the terminal setup command is fallback-only.
- 2026-07-27: Added rejected AniList client-credential recovery. A token-exchange 401/`invalid_client`/“Client authentication failed” response invalidates only AniStream's Keychain secret, allowing the next login attempt to securely collect a replacement.
- 2026-07-27: Changed persisted AniList state from token-only to an encrypted versioned
  token-plus-profile session restored before window creation. This removes startup auth flicker and
  keeps the user recognized during transient startup network failures.
- 2026-07-27: Implemented AniList as the sole metadata source for the first Anime/Manga product
  surfaces. MyAnimeList credentials are not needed because no verified data gap currently requires it.
- 2026-07-27: Adopted the inspected Netflix design-system palette and interaction hierarchy as a
  reference, not copied components: black/neutral surfaces, white action hierarchy, red primary
  actions, plus AniStream cyan tracker accents and a distinct editorial Manga treatment.
- 2026-07-27: Implemented the Aniyomi-inspired anime provider boundary natively in TypeScript as
  title mapping → seasons/episodes → hosters → video variants. Provider-specific scraping remains
  outside shared contracts and no source domain is silently hardcoded.
- 2026-07-27: Selected the 1024×1024 iOS marketing export from the supplied IconKitchen set as the
  macOS icon master because it has twice the dimensions of the 512×512 web/Android alternatives.
  The source is kept in the dedicated `assets/app-icon` directory; Electron Builder generates the
  packaged `.icns` resource from that master.
