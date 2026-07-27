# AniStream — Context

Last updated: 2026-07-28 by Codex carousel-and-MangaDex session

## Current phase

Phase 2 product shell and provider foundations. AniList discovery, durable login, list management,
profile editing, catalog rails, title details, and tracker mutations work. A public MangaDex
availability adapter now informs Continue Reading. MangaDex page reading/account sync and native
anime HLS/torrent playback remain the next substantial slices.

## What's working right now

- AniList authorization-code login restores its encrypted token/profile before the Electron window
  opens and persists until explicit logout.
- Anime and Manga are the only primary navbar destinations; the avatar opens Profile, which contains
  both AniList libraries.
- Profile anime/manga lists can be filtered and sorted by Latest updated (default), Title A–Z,
  Highest score, or Most progress.
- AniList browse/search, pagination, detailed title data, list add/edit/remove, progress, score, and
  completion mutations are implemented.
- Netflix-style horizontal rails use native scroll snapping, visible-width paging, edge-hover
  chevrons, keyboard arrows, reduced-motion handling, and real card-width expansion that pushes
  neighboring cards.
- “Based on Your Interest” uses AniList genre preferences and excludes every title already present
  in the corresponding AniList library.
- Continue Watching is sourced only from AniList `CURRENT` anime. Finished titles at total progress
  and airing titles caught up to the episode before `nextAiringEpisode` are hidden until more content
  is available.
- Continue Reading is sourced only from AniList `CURRENT` manga. The main-process MangaDex adapter
  searches publicly, accepts only one exact `attributes.links.al` match, loads the configured-language
  chapter aggregate, and hides titles when AniList progress has reached the latest numeric chapter.
  Unmapped/unavailable titles remain visible rather than being falsely marked caught up. Availability
  is reevaluated every five minutes; the MangaDex cache permits a fresh network check every 30 minutes.
- Manga detail pages no longer show the anime-only Studios field.
- MangaDex requests use a truthful User-Agent, a shared 4 requests/second queue, a 30-minute bounded
  cache, 20-second timeouts, exact mapping, and 429/403 cooldown behavior. Public reading remains
  independent from credentials.
- Optional Parse episode-guide and VidKing iframe seams exist but are not load-bearing.
- `npm run typecheck`, all 50 Vitest tests, `npm run format:check`,
  `npm run check:product-slice`, `npm run check:anilist-oauth`, and
  `npm run check:packaged-preload` pass. ESLint has zero errors and two documented React effect
  warnings.
- The packaged app launched for ten seconds with Electron logging and emitted no preload, bridge, or
  renderer error.
- The rebuilt unsigned Apple Silicon package is
  `dist/AniStream-0.1.0-arm64.dmg` (134 MB, built 2026-07-28). SHA-256:
  `90ac0fad7163c4d5b0814ccff113e7298fdabae541ac089118e57afa0b281e00`.
- Current MangaDex research and implementation boundaries are recorded in
  `docs/research/mangadex-runtime-evaluation.md`.

## What's in progress

- MangaDex chapter feeds, scanlation/language selection, MangaDex@Home page proxying, and the native
  reader are not yet connected.
- Full MangaDex account follows/read-marker synchronization remains planned as a separate opt-in
  personal-client module.
- No native HLS or torrent source is connected to the Watch surface. AnimePahe-style HLS remains the
  approved primary direction, with AnimeTosho/Nyaa torrent fallback.
- Local in-episode/in-chapter resume timestamps are not yet persisted; AniList integer progress is
  currently the source for continue rails.

## Open decisions (need user input)

- Before MangaDex account sync is enabled, confirm that the personal API client is approved and that
  storing its username, password, client secret, access token, and refresh token in macOS Keychain is
  acceptable. MangaDex documents that this personal-client flow bypasses account MFA.
- Decide whether the optional Parse hosted scraper remains enabled after its target authorization,
  cost, and live response schema are verified.
- Decide whether VidKing should remain a clearly labeled fallback iframe after native HLS playback
  lands.
- Choose the local playback/read threshold for writing progress to AniList without excessive
  mutations.

## Known issues / tech debt

- MangaDex availability currently uses the English aggregate by default (`MANGADEX_LANGUAGE=en`).
  Licensed titles can have no MangaDex chapters in that language; those are treated as unknown and
  stay in Continue Reading.
- Exact AniList mapping can fail when the right MangaDex result is outside the first ten search
  results or lacks `links.al`. A future manual mapping UI should resolve those cases safely.
- MangaDex aggregate data is only an availability hint; concrete reading must use chapter feeds and
  MangaDex@Home.
- The carousel/UI changes were structurally tested and the desktop app launched without console
  errors, but automated visual screenshot inspection was not permitted. Perform a manual hover,
  paging, focus, and narrow-window pass before treating pixel behavior as final.
- The two existing `react-hooks/set-state-in-effect` warnings in `CatalogView.tsx` and
  `GlobalSearch.tsx` remain. TanStack Query is the planned request-lifecycle fix.
- Parse has not been live-tested with a real API key; VidKing remains an external iframe with
  availability and provenance outside AniStream's control.
- The DMG is unsigned because no valid Developer ID Application certificate is installed.
- Runtime dependency audit is clean; full audit still contains accepted development/build-only
  advisories in Electron Builder/ESLint dependency trees.
- The AniList client secret was previously shared in chat and should be rotated if AniList permits.

## Next steps (in priority order)

1. Implement MangaDex chapter-feed normalization, translation/group choice, MangaDex@Home allocation,
   trusted image proxying, and the first native reader mode with fixture and live checks.
2. Move planned MangaDex personal-client credentials to macOS Keychain, then implement opt-in token
   refresh, follows/read markers, reconciliation, and explicit logout.
3. Re-verify and implement the approved removable AnimePahe-style HLS adapter, then add
   AnimeTosho/Nyaa torrent fallback.
4. Persist local playback/reading resume state and define bounded AniList progress-write thresholds.
5. Manually verify carousel edge reveal, card push expansion, keyboard navigation, profile sorting,
   and Continue rail behavior in the packaged app.

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
- 2026-07-27: Changed persisted AniList state from token-only to an encrypted versioned token-plus-profile session restored before window creation. This removes startup auth flicker and keeps the user recognized during transient startup network failures.
- 2026-07-27: Implemented AniList as the sole metadata source for the first Anime/Manga product surfaces. MyAnimeList credentials are not needed because no verified data gap currently requires it.
- 2026-07-27: Adopted the inspected Netflix design-system palette and interaction hierarchy as a reference, not copied components: black/neutral surfaces, white action hierarchy, red primary actions, plus AniStream cyan tracker accents and a distinct editorial Manga treatment.
- 2026-07-27: Implemented the Aniyomi-inspired anime provider boundary natively in TypeScript as title mapping → seasons/episodes → hosters → video variants. Provider-specific scraping remains outside shared contracts and no source domain is silently hardcoded.
- 2026-07-27: Selected the 1024×1024 iOS marketing export from the supplied IconKitchen set as the macOS icon master because it has twice the dimensions of the 512×512 web/Android alternatives.
- 2026-07-27: Researched VidKing, Parse, and Cineby. VidKing remains an unapproved remote iframe option rather than a native source; Parse remains an unapproved hosted scraper pending cost, target authorization, and endpoint-schema verification; Cineby remains a visual reference only. AniList `SaveMediaListEntry`/`UpdateMediaListEntries` plus local timestamp state are the recommended basis for progress, score, completion, Continue Watching, and interest-based rails. The source is kept in the dedicated `assets/app-icon` directory; Electron Builder generates the packaged `.icns` resource from that master.
- 2026-07-27: Implemented AniList-driven discovery rails and progress controls. Continue rails are derived from current AniList entries, top-rated/interest rows use AniList browse filters, and playback completion/rating/explicit completion call the existing authenticated list mutations. Parse episode loading and VidKing playback are optional, main-process-controlled seams; neither is treated as a native or load-bearing source.
- 2026-07-27: Initialized Git version control for the project (previously no repository existed at all) and added four GitHub Actions workflows: `ci.yml`, `package-mac.yml`, `security-audit.yml`, and `codeql.yml`. All four run on GitHub-hosted `macos-14` (arm64) runners except CodeQL, which runs on `ubuntu-latest` since static analysis needs no Electron build. Each workflow has a matching implementation-agnostic specification under `spec/spec-process-cicd-*.md`. This wires the project's existing typecheck/build/regression scripts and `npm audit` split into automated checks; it does not add new test coverage, linting, or code signing, which remain open tech debt.
- 2026-07-27: Added Vitest with 35 fixture-based unit tests for the AniList GraphQL normalizers, request-dedup/throttle gate, and bounded cache. Split `src/main/anilist.ts` (1,159 lines) into `src/main/anilist/{client,queries,normalize,keychain,session-store,request-queue,cache}.ts` first, so the normalizers became directly importable/testable pure functions instead of module-private code reachable only by mocking fetch/Electron. `AniListClient`'s public interface and import path are unchanged.
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
- 2026-07-27: Extended `ci.yml` to run `npm run lint`, `npm run format:check`, and `npm test` alongside
  the existing typecheck/build/contract checks. Discovered `npm ci` (no flags) fails on this repo —
  `eslint-plugin-react@7.37.5` (latest) has a peer range that predates ESLint 10 — so switched every
  workflow that installs dependencies to `npm ci --legacy-peer-deps` (audit keeps `--ignore-scripts`
  too) after confirming locally that the flag is the only change needed; the actual installed tree
  works correctly. Updated all four `spec/spec-process-cicd-*.md` docs to match and bumped them to
  version 1.1, and fixed an unrelated pre-existing broken markdown table in the security-audit spec
  (an unescaped `||` had split a cell) noticed while editing it.
- 2026-07-27: The first live run of `codeql.yml` on GitHub failed with `Resource not accessible by
integration` against the workflow-runs API. `github/codeql-action/analyze` needs `actions: read` to
  read workflow-run metadata during the SARIF upload step, which the original `permissions:` block
  (`contents: read`, `security-events: write`) didn't grant. Added `actions: read`. Bumped
  `spec-process-cicd-codeql.md` to version 1.1 with this as an explicit error-handling scenario, so a
  future permissions edit doesn't silently regress it.
- 2026-07-28: User approved carousel direction A: native scroll snapping, edge-hover chevrons that page by the visible viewport, and actual flex-width expansion so hovered/focused cards push adjacent cards.
- 2026-07-28: Continue rails now use only AniList `CURRENT` entries. Anime availability uses totals plus `nextAiringEpisode`; Manga uses exact AniList-to-MangaDex mapping and translated aggregate availability. Recommendation rails exclude all corresponding AniList library IDs.
- 2026-07-28: Approved a public read-only MangaDex adapter after first-party research and live API checks. It is isolated in the main process, throttled to 4 requests/second, cached for 30 minutes, accepts only a unique exact `attributes.links.al` mapping, and treats unavailable data as unknown. Full personal-client account sync remains planned as a separate Keychain-backed opt-in because public OAuth clients are unavailable and the documented personal flow bypasses MFA.
