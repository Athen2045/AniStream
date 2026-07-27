# AniStream — Context

Last updated: 2026-07-27 by Codex macOS DMG rebuild session

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
- `npm run package:mac` produces the current 134 MB
  `dist/AniStream-0.1.0-arm64.dmg`. The package was rebuilt from the latest source on
  2026-07-27 at 08:54 IST; packaged-preload, AniList OAuth, product-slice, all 43 Vitest tests,
  formatting, and lint (zero errors, two documented warnings) passed.
- The macOS package uses the custom 1024×1024 artwork at
  `assets/app-icon/AniStream-1024.png`; Electron Builder embeds it as
  `AniStream.app/Contents/Resources/icon.icns`, and the bundle's `CFBundleIconFile` points to it.
- The postinstall step explicitly verifies/downloads Electron and rebuilds the native SQLite module, addressing the missing-binary failure observed during the first launch attempt.
- `npm audit --omit=dev` reports zero runtime dependency vulnerabilities.
- `README.md`, `AGENTS.md`, `API.md`, and this context file now follow the required documentation roles.
- Phase 0 research is recorded in `docs/research/phase-0.md`.
- Current Consumet and Aniyomi evaluations are recorded in `docs/research/consumet-evaluation.md` and `docs/research/aniyomi-evaluation.md`.
- The project now has a Git history (`git init` plus initial commits); prior sessions worked with no version control at all.
- Four GitHub Actions workflows exist under `.github/workflows/`, each with an implementation-agnostic spec under `spec/`:
  `ci.yml` (typecheck, build, `check:product-slice`, `check:anilist-oauth` on every push/PR to `main`),
  `package-mac.yml` (unsigned arm64 DMG build plus `check:packaged-preload` against the real packaged ASAR, on version tags or manual dispatch, publishing to GitHub Releases),
  `security-audit.yml` (blocking `npm audit --omit=dev`, non-blocking full audit report, on manifest changes and weekly),
  and `codeql.yml` (CodeQL `javascript-typescript` security-extended analysis, on push/PR and weekly).
- These workflows run the project's _existing_ checks in CI; they do not add new test coverage. Unit/integration tests and ESLint/Prettier are still not configured (see Known issues below) and remain the next priority.
- Vitest is now configured (`vitest.config.ts`, `npm test` / `npm run test:watch`). 35 fixture-based
  unit tests in `test/main/` cover every AniList GraphQL normalizer (`src/main/anilist/normalize.ts`),
  the client-side request-dedup/throttle gate, and the bounded cache — the code most exposed to
  upstream schema drift, which previously had zero coverage. `ci.yml` should be extended to run
  `npm test` alongside typecheck/build (not yet wired in this pass).
- `src/main/anilist.ts` (1,159 lines) is split into `src/main/anilist/{client,queries,normalize,
keychain,session-store,request-queue,cache}.ts`. `AniListClient`'s public interface is unchanged;
  `src/main/index.ts` still imports it from `./anilist` unmodified. `scripts/verify-product-slice.mjs`
  was updated to read the new file locations.
- `AniListClient` now deduplicates identical in-flight read requests (browse/detail/search/viewer) and
  throttles all GraphQL calls to 25 requests/minute (`src/main/anilist/request-queue.ts`), plus a small
  bounded/TTL cache for public browse and media-detail lookups (`src/main/anilist/cache.ts`). Mutations
  are never deduplicated or cached. This fulfills the "request cache/throttle/dedup" roadmap item for
  AniList; MangaDex and the HLS adapter still need their own equivalents once implemented.
- Fixed a real gap in the above: the 25/min throttle only prevented bursts pre-emptively, it didn't
  react to an actual AniList 429. A user hit `Error invoking remote method 'anilist:browse': Error: Too
Many Requests` (AniList's real 429 body surfacing verbatim) — most likely because the running dev
  process predated this session's throttle (main-process changes need a full relaunch, not hot-reload).
  `RequestGate.reportRateLimited(retryAfterMs)` now pauses every future request until a 429's
  `Retry-After` header elapses (parsed as delta-seconds or HTTP-date, falling back to a conservative 60s
  when the header is absent), matching API.md: "On 429, stop the queue until Retry-After/reset." The
  user also gets a clearer message than the raw provider string. Covered by new tests in
  `test/main/request-queue.test.ts` and `test/main/parse-retry-after.test.ts`.
- ESLint (flat config, `eslint.config.js`) and Prettier (`.prettierrc.json`) are configured with
  `npm run lint` / `lint:fix` / `format` / `format:check`. `typescript-eslint` (parser and eslint-plugin
  alike) hard-refuses to run against TypeScript >= 7 (throws at require-time, not just a peer warning) —
  this project deliberately runs TS 7. ESLint therefore parses `.ts`/`.tsx` with `@babel/eslint-parser` +
  `@babel/preset-typescript` instead, which understands TS syntax without invoking the TS compiler.
  Consequence: no TS-aware semantic lint rules (no-explicit-any, no-floating-promises, etc.); `tsc --noEmit`
  now has `noUnusedLocals`/`noUnusedParameters` enabled in both tsconfigs instead, since it correctly
  understands type-only imports and constructor parameter properties that babel's parser cannot see.
  Revisit the ESLint setup once typescript-eslint ships TS 7 support:
  https://github.com/typescript-eslint/typescript-eslint/issues/10940
- `npm run lint` is clean (0 errors). Two `react-hooks/set-state-in-effect` warnings remain, deliberately
  left as warnings (not fixed) in `CatalogView.tsx`/`GlobalSearch.tsx`: both call `setLoading(true)` at
  the start of a data-fetching effect, the standard vanilla-React pattern used throughout this codebase.
  The real fix is adopting TanStack Query (already an approved-but-unimplemented dependency per the
  README tech-stack table) for request lifecycle management.
- Added a top-level React error boundary (`src/renderer/src/ErrorBoundary.tsx`, wrapping `<App />` in
  `main.tsx`) so an uncaught render error shows a truthful degraded state and a reload button instead of
  a blank window.
- Hardened the three spots where an AniList-supplied banner/cover URL was interpolated directly into a
  CSS `background-image` template literal (App.tsx, CatalogView.tsx, MediaDetailModal.tsx) — a stray `"`
  in a URL could break out of the CSS string. `src/renderer/src/safe-css-url.ts` now builds a properly
  quoted, https-only `url(...)` value shared by all three call sites.
- Performance/responsiveness pass on the renderer: `.media-card`/`.browse-card` use
  `content-visibility: auto` with `contain-intrinsic-size` so long AniList libraries (which can run into
  the hundreds of entries) skip layout/paint work for off-screen cards; `MediaDetailModal` is now
  code-split via `React.lazy`/`Suspense` (its own ~12 KB chunk, only fetched once a title is opened,
  confirmed via the `electron-vite build` chunk output). The existing responsive grid/breakpoint CSS
  (`repeat(auto-fill, minmax(...))` grids plus the `max-width: 1100px` breakpoint) was reviewed and
  already covers the app's 960x640 minimum window size correctly; no changes were needed there.
  **Not verified visually** — this environment has no tool that can launch and drive the actual Electron
  window (the available browser/simulator tools are for web pages and iOS simulators respectively), so
  this pass was verified via typecheck/build/lint/test and build-output inspection only, not by running
  the app and resizing the window. Do that manually before considering this fully done.
- `npm audit --omit=dev` remains 0 vulnerabilities. Full `npm audit` is now 13 high-severity advisories
  (down from 16): the pre-existing electron-builder `brace-expansion`/`minimatch` chain, plus a new,
  same-shape `minimatch`/`brace-expansion` chain via `eslint-plugin-react@7.37.5` (latest available
  release). Neither has a fix that isn't a breaking downgrade (npm's suggested fixes are older, not
  newer, versions of electron-builder/eslint-plugin-react) — both are dev/build-tooling-only and never
  ship in the packaged app, so this remains accepted risk, not applied.

## What's in progress

- No source provider is connected to the new Watch surface. It intentionally shows a truthful
  unavailable state until the approved AnimePahe-style HLS adapter is re-verified and implemented.
- Manga browse/details use AniList; MangaDex chapter feeds, account sync, and reader are not connected.

## Open decisions (need user input)

- None currently blocking the next vertical slice.

## Known issues / tech debt

- MangaDex, offline sync/reconciliation, and concrete video-source adapters are documented but not implemented.
- Regression scripts exist and run automatically in CI (`ci.yml`). Vitest now covers the AniList
  normalizers, request-dedup/throttle gate, and cache, but there is still no provider-fixture suite for
  a real HLS/MangaDex adapter (neither is implemented yet), and `ci.yml` doesn't yet run `npm test` or
  `npm run lint` (only wired locally so far).
- ESLint/Prettier are now configured, but ESLint runs on `@babel/eslint-parser` rather than
  `typescript-eslint`, which hard-refuses TypeScript >= 7 — see the dated entry above and the decision
  log for the tradeoff (no TS-aware semantic lint rules; `tsc --noEmit` covers unused-code detection
  instead). Revisit once typescript-eslint ships TS 7 support.
- The DMG is unsigned because no valid Developer ID Application certificate is installed. `package-mac.yml`
  sets `CSC_IDENTITY_AUTO_DISCOVERY=false` so CI packaging stays deterministic rather than searching for a
  signing identity that doesn't exist; this must be revisited if a certificate is ever provisioned.
- Full `npm audit` reports 13 high-severity advisories (down from 16): electron-builder's development/
  packaging dependency tree (`brace-expansion`/`minimatch` lineage) plus the same-shape chain via
  `eslint-plugin-react@7.37.5` (latest available). Runtime-only audit (`--omit=dev`) is clean. npm's
  offered forced fixes for both are breaking downgrades and were not applied — accepted risk, dev/build
  tooling only, never shipped in the packaged app.
- The renderer's data-fetching effects (`CatalogView`, `GlobalSearch`, `App`'s dashboard load) all call
  `setLoading(true)` synchronously at effect start, which a newer `eslint-plugin-react-hooks` rule flags.
  Left as a warning rather than fixed, since the real fix is adopting TanStack Query (already an
  approved-but-unimplemented dependency) for request lifecycle management instead of patching each effect.
- The responsive/performance pass on the renderer (content-visibility on card grids, code-splitting
  `MediaDetailModal`) was verified via typecheck/build/lint/test and build-output inspection only — this
  environment has no tool that can launch and drive the actual Electron window, so it has not been
  visually verified by running the app and resizing it. Do that manually before relying on it.
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
   Not started this session — needs live research against the current AnimePahe site before any code
   is written (Cloudflare handling, embed extraction), which is out of scope for an in-editor pass.
2. Implement MangaDex chapter browsing, MangaDex@Home proxy/reporting, and the first reader modes.
3. Implement full MangaDex personal-client authentication, follows, and read-marker sync using Keychain.
4. AniList's in-memory request dedup/throttle/cache is done (see decision log). Remaining: the same
   dedup/throttle/cache pattern for MangaDex once implemented, and making the AniList
   catalog/dashboard cache **persisted** (SQLite-backed, survives restart) rather than in-memory-only.
5. Add local playback/reading progress, continue-watching/reading rails, pending mutation queue, and
   conflict-safe reconciliation.
6. Add AniList favorites, activity feed, reviews/recommendations actions, notifications, and richer
   statistics incrementally; do not interpret “all API fields” as a reason to expose unsafe moderator
   or irrelevant platform operations.
7. Provider fixtures/tests exist now for AniList (35 Vitest cases); still need equivalents once
   MangaDex/HLS adapters land, plus valid Developer ID signing/notarization.
8. Wire `npm test` and `npm run lint` into `ci.yml` (currently only run locally in this session).
9. Manually launch the app and resize the window to visually verify the responsive/performance pass
   (content-visibility grids, code-split MediaDetailModal) — not yet done in this environment.

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
- 2026-07-27: Initialized Git version control for the project (previously no repository existed at all)
  and added four GitHub Actions workflows: `ci.yml`, `package-mac.yml`, `security-audit.yml`, and
  `codeql.yml`. All four run on GitHub-hosted `macos-14` (arm64) runners except CodeQL, which runs on
  `ubuntu-latest` since static analysis needs no Electron build. Each workflow has a matching
  implementation-agnostic specification under `spec/spec-process-cicd-*.md`. This wires the project's
  existing typecheck/build/regression scripts and `npm audit` split into automated checks; it does not
  add new test coverage, linting, or code signing, which remain open tech debt.
- 2026-07-27: Added Vitest with 35 fixture-based unit tests for the AniList GraphQL normalizers,
  request-dedup/throttle gate, and bounded cache. Split `src/main/anilist.ts` (1,159 lines) into
  `src/main/anilist/{client,queries,normalize,keychain,session-store,request-queue,cache}.ts` first, so
  the normalizers became directly importable/testable pure functions instead of module-private code
  reachable only by mocking fetch/Electron. `AniListClient`'s public interface and import path are
  unchanged.
- 2026-07-27: Implemented client-side request deduplication and a 25-req/min throttle for all AniList
  GraphQL calls, plus a bounded/TTL cache for public browse and media-detail lookups, fulfilling the
  "request cache/throttle/dedup" roadmap item for AniList specifically. Mutations are deliberately never
  deduplicated or cached, matching API.md's "keep list mutations serialized" client strategy. MangaDex
  and the HLS adapter need their own equivalents when implemented — this decision does not extend to
  them.
- 2026-07-27: Added ESLint (flat config) and Prettier. Discovered `typescript-eslint` (both the parser
  and the eslint-plugin) throws at require-time against TypeScript >= 7, which this project deliberately
  runs — not merely a peer-dependency warning but a hard-coded version guard with no current escape
  hatch (confirmed by testing `overrides`, which npm accepted but silently failed to apply for this
  peer-dependency case). Chose `@babel/eslint-parser` + `@babel/preset-typescript` instead, which parses
  TS syntax without invoking the TS compiler, and moved unused-code detection to `tsc --noEmit`
  (`noUnusedLocals`/`noUnusedParameters`) since babel's parser cannot see type-only imports or
  constructor parameter properties and would otherwise misreport them as unused. Revisit when
  typescript-eslint ships TS 7 support.
- 2026-07-27: Deliberately left two `react-hooks/set-state-in-effect` warnings unfixed in
  `CatalogView.tsx`/`GlobalSearch.tsx` (both call `setLoading(true)` at the start of a data-fetching
  effect) rather than restructuring around them, since the real fix is adopting the already-planned
  TanStack Query dependency for request lifecycle management, not a narrow per-effect rewrite.
- 2026-07-27: Declined to apply npm's suggested audit fixes for the electron-builder and (newly
  introduced by this session's ESLint addition) eslint-plugin-react `minimatch`/`brace-expansion`
  advisory chains, since both suggested fixes are breaking _downgrades_, not newer safe releases,
  matching the electron-builder decision already on record. Both chains are dev/build-tooling-only.
- 2026-07-27: Added a top-level React error boundary and hardened three CSS `background-image`
  template-literal interpolations of AniList-supplied URLs (via a shared `safe-css-url.ts` helper),
  closing two findings from the earlier codebase audit.
- 2026-07-27: Applied `content-visibility: auto` to the library/catalog card grids and code-split
  `MediaDetailModal` via `React.lazy` for renderer performance. Reviewed the existing responsive
  grid/breakpoint CSS and found it already adequate for the app's 960×640 minimum window size; did not
  add new breakpoints. This pass was verified only via typecheck/build/lint/test and build-output
  chunk sizes, not by visually running the app, since this environment has no tool that can drive an
  actual Electron window.
