# AniStream — Context

Last updated: 2026-07-29 by Codex Netflix episode browser and Video.js revamp session

## Current phase

Phase 2 native media integration. AniList discovery/tracking, Zenshin episode enrichment, the
Netflix-style episode browser, the fullscreen Video.js anime player/source broker, MangaDex reading,
MangaBaka enrichment, local playback resume, and the Netflix/MangaFire-inspired title surfaces are
implemented. Live HLS remains degraded because the approved public Aniwatch service is currently
unhealthy; torrent handoff is the active fallback.

## What's working right now

- AniList authorization-code login restores its encrypted token/profile before window creation and
  persists until explicit logout. Browse, unified search, pagination, title details, profile lists,
  progress, scores, completion, add/edit/remove, and default latest-updated sorting work.
- Anime and Manga remain the only primary navbar destinations; Profile contains both AniList
  libraries. Continue rails use only AniList `CURRENT` entries and hide caught-up titles until new
  episodes/chapters become available.
- Netflix-style rails provide viewport-width paging, hover edge controls, keyboard navigation,
  reduced-motion support, and cards that physically expand while pushing adjacent cards.
- Zenshin's live mapping mirrors provide exact AniList-ID episode catalogs, episode titles,
  thumbnails, summaries, runtimes, and season grouping. This was verified against live responses.
- Anime detail and direct carousel Watch actions open a Netflix-style episode browser at the saved
  episode or next AniList episode. Completed shows clamp to the final episode instead of requesting a
  nonexistent one.
- The episode browser matches the supplied Netflix reference with a full-width hero/detail sheet,
  season picker, numbered 16:9 rows, hover play affordances, runtimes, summaries, dividers, and local
  watched/resume progress.
- Clicking an episode performs a reduced-motion-aware transform/opacity transition and requests real
  fullscreen from the click gesture. The Video.js React v10 `HlsJsVideo` player supplies accessible
  adaptive-HLS controls, quality, captions, playback speed, picture-in-picture, and fullscreen while
  preserving AniStream's trusted main-process media broker, resume, AniList progress, next-episode
  preview, alternate HLS candidates, and torrent fallback.
- Playback position is persisted in SQLite every ten seconds and on pause/close. Reopening resumes the
  episode, 90%/ended marks the episode watched, and the authenticated AniList entry advances or
  completes.
- A clean-room, removable Aniwatch client implements documented search → episode → server → source
  contracts with exact unique-title matching, HTTPS validation, bounded throttling, timeouts, and
  cooldowns. HLS manifests, segments, keys, maps, and subtitles are brokered through a privileged
  `anistream-media://` main-process proxy; provider URLs never need direct renderer access.
- Nyaa and AnimeTosho magnet discovery run concurrently as the fallback. AniStream opens an explicitly
  selected magnet in the user's macOS handler and does not download, seed, or rehost torrents.
- Manga detail pages use the MangaFire-inspired chapter layout, omit Studios, show search/language/
  type/sort controls, completed marks, dates, and reader actions. The reader uses exact AniList →
  MangaDex mapping and MangaDex@Home page delivery.
- MangaDex image nodes are cached for at most 15 minutes and refreshed exactly once on image
  `404`/`410`, addressing rotated MangaDex@Home hosts without aggressive retries.
- MangaBaka enrichment is integrated through its stable exact AniList-ID route and supplies
  author/artist/publisher, MangaUpdates ID/rating, status, type, and chapter-total fields when present.
- The packaged Apple Silicon app was visually launched after this revamp; the renderer, persisted
  AniList session, artwork, and preload bridge loaded without the prior blank-screen failure.
- A Playwright-over-local-CDP interaction opened an anime, revealed the episode browser, selected the
  first episode, and verified `watch-experience--player` with the AniStream watch surface as
  `document.fullscreenElement`. The unhealthy public provider then resolved to the designed torrent
  fallback.
- `npm run typecheck`, 66 Vitest tests, `npm run format:check`, `npm run build`,
  `npm run check:product-slice`, `npm run check:anilist-oauth`, and
  `npm run check:packaged-preload` pass. ESLint has zero errors and two documented pre-existing
  React effect warnings.
- Final unsigned package: `dist/AniStream-0.1.0-arm64.dmg` (167 MB).
  SHA-256: `f42dc6fbaf38055d014dd39ce4de7189481d5ea61184ed89125d9b6efa339dc1`.
- Current provider verification is recorded in
  `docs/research/approved-aniwatch-zenshin-runtime-2026-07-28.md`; the original rejection report is
  retained as historical context and marked superseded by the user's explicit approval.

## What's in progress

- The approved public Aniwatch deployment currently returns empty search results, times out on
  episode/server requests, or returns source-resolution 500 errors. The client and player are ready,
  but a live HLS stream could not be verified from that deployment.
- Full MangaDex account follows/read-marker synchronization remains planned as a separate opt-in
  personal-client module. Public MangaDex reading does not depend on those credentials.
- Native in-app torrent playback is not implemented; the current fallback requires an installed
  macOS magnet handler.
- Full MangaDex archive paging, translation/group selection, and local page/chapter resume are still
  pending. Anime resume is implemented.

## Open decisions (need user input)

- Before MangaDex account sync is enabled, confirm that the personal API client is approved and that
  storing its username, password, client secret, access token, and refresh token in macOS Keychain is
  acceptable. MangaDex documents that this personal-client flow bypasses account MFA.
- Decide whether to self-host/fork a compatible Aniwatch API service, provide another compatible
  deployment through `ANISTREAM_ANIWATCH_API_URL`, or wait for the approved public deployment to
  recover. The repository has no declared license, so its scraper code was not copied into AniStream.
- Decide whether torrent fallback should remain an external magnet handoff or gain a local playback
  engine with explicit download, storage, seeding, and cleanup rules.
- Decide whether the inactive VidKing iframe seam should be removed entirely now that the native
  player is the product surface.

## Known issues / tech debt

- The approved public Aniwatch deployment is operationally unhealthy. Native HLS code is present and
  tested with fixtures, but no live stream was available during the final check. The UI reports this
  honestly and offers any torrent results instead of fabricating playback.
- Zenshin supplies episode metadata/mapping only; it does not supply a video stream. Its mirror data
  can also flatten provider-specific season numbering, so absolute episode numbers may appear in a
  single season until a better mapping service or local correction UI is added.
- `codex0555/Aniwatch-Api` has no declared license and its source resolver has public failure reports.
  The user accepted the operational/legal risk, but AniStream uses only a clean-room HTTP client and
  does not copy or bundle that repository's scraper/decryption implementation.
- AnimeTosho stopped adding new torrents on 2026-05-09 according to its official notice, so it is
  historical-only; Nyaa availability varies by network and title.
- MangaDex defaults to `MANGADEX_LANGUAGE=en`. Licensed titles may have no chapters in that language.
  Exact mapping can also fail when the correct result is outside the first ten search results or lacks
  `attributes.links.al`; unknown titles stay visible rather than being falsely marked caught up.
- The MangaDex reader fetches only the newest 100 readable chapters. Full archive pagination,
  translation/group selection, account follows/read-marker sync, and chapter-level local resume are
  not implemented.
- MangaUpdates is consumed only through MangaBaka's normalized exact-ID record. The supplied direct
  MangaUpdates OpenAPI did not provide a safe AniList-ID lookup contract, so direct integration is
  deferred.
- Automated visual inspection confirmed the packaged episode layout, and local CDP interaction
  confirmed episode-click fullscreen entry. Manually verify every Video.js control, keyboard focus,
  narrow-window behavior, exit/re-entry behavior, and actual HLS playback when a healthy endpoint
  becomes available.
- The two existing `react-hooks/set-state-in-effect` warnings in `CatalogView.tsx` and
  `GlobalSearch.tsx` remain. TanStack Query is the planned request-lifecycle fix.
- Video.js v10 is beta and may change its React API. The locked version is
  `@videojs/react@10.0.0-beta.25`; review its changelog before every upgrade.
- The renderer player chunks are large (about 903 KB main plus 1.60 MB lazy detail chunk). This is
  acceptable for the local desktop app but should be split further if startup/detail latency grows.
- The DMG is unsigned because the installed Apple Development certificate is expired and no valid
  Developer ID Application identity is available.
- Runtime dependency audit is clean; full audit still contains accepted development/build-only
  advisories in Electron Builder/ESLint dependency trees.
- The AniList client secret was previously shared in chat and should be rotated if AniList permits.

## Next steps (in priority order)

1. Restore live HLS by validating a healthy API-compatible Aniwatch deployment or a separately
   operated service, then run a real sub/dub stream through the main-process HLS proxy and every
   player control. Keep `ANISTREAM_ANIWATCH_ENABLED=0` as the immediate kill switch.
2. Obtain/confirm the MangaDex personal client, move every credential/token into macOS Keychain, and
   implement opt-in token refresh, follows, read markers, reconciliation, explicit logout, and
   conflict handling.
3. Add complete MangaDex archive pagination plus language/group selection and local chapter/page
   resume.
4. Manually verify direct Watch/Read card actions, episode switching, resume, AniList 90% progress,
   MangaDex page navigation/node refresh, magnet handoff, carousel hover/paging, keyboard focus, and
   narrow-window layout in the final packaged app.
5. Replace the expired signing certificate with a valid Developer ID Application identity, sign and
   notarize the DMG, then rotate the previously exposed AniList client secret.

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
- 2026-07-28: Evaluated `namtxs/anistream` as a reference. It is an MIT-licensed static frontend whose source was last pushed in 2023 and whose runtime depends on an external Ngewibu API. AniStream will reuse only reviewed playback UX ideas—episode switching, quality/subtitle controls, resume/autoplay, retry states, and schedule interaction—not its backend URLs, DOM scripts, advertisements, or assumed media format.
- 2026-07-28: Evaluated `ErickLimaS/anime-website` and `keerthivasansa/animos`. Neither adapter/API is adopted: both depend on disallowed Consumet or unapproved scraped-source stacks, use non-permissive Creative Commons licenses, and rely on stale or separately hosted service components. AniStream may independently implement their general ideas—source preferences, mapping caches, local resume, skip markers, player cleanup, and graceful provider failures—behind the existing native TypeScript contracts only.
- 2026-07-28: Evaluated `codex0555/Aniwatch-Api` and rejected it as an adapter/API. It is an unlicensed, inactive Express scraper targeting unapproved AniwatchTV/MegaCloud endpoints; its deployed API is unauthenticated, unversioned, unsafeguarded, and has reported source-resolution failures. Only the generic title → episode → hoster → variant progression is retained as an independently implemented reference pattern.
- 2026-07-28: Installed the public MangaDex reader adapter in the Electron main process: exact AniList mapping, chapter-feed normalization, MangaDex@Home allocation, no-auth image fetching, bounded page/node caches, and renderer-safe page data URLs. The first reader opens the newest 100 configured-language chapters and writes completed numeric chapters back to AniList; MangaDex account sync remains separate and opt-in.
- 2026-07-28: Installed the approved torrent discovery fallback using Nyaa RSS and AnimeTosho JSON. A selected normalized magnet is handed explicitly to the user's macOS torrent handler; AniStream never auto-starts or rehosts a torrent. The AnimePahe primary remains disabled because its verified legacy origin redirected to a parked domain, and AnimeTosho is treated as historical-only after its official notice that new torrents stopped in May 2026.
- 2026-07-28: Superseded the earlier `codex0555/Aniwatch-Api` rejection after the user explicitly approved the Aniwatch/Zenshin scraped-provider strategy and accepted its legal, reliability, and maintenance risks. AniStream implements a clean-room, removable HTTP client against the documented contract; the unlicensed scraper/decryption source is not copied or bundled.
- 2026-07-28: Adopted Zenshin's exact AniList-ID mapping mirrors for episode metadata only and Aniwatch for video resolution. Metadata and playback remain independent so provider failure cannot break AniList discovery, profile/list management, or MangaDex reading.
- 2026-07-28: Adopted hls.js with a privileged `anistream-media://` main-process broker for HLS manifests, segments, encryption keys, maps, and subtitles. The broker accepts only HTTPS upstream URLs, rewrites relative manifest resources, bounds temporary tokens, and keeps provider headers/URLs out of the renderer.
- 2026-07-28: Added SQLite-backed per-title anime resume with ten-second checkpoints and AniList progression at 90%/ended. Direct carousel Watch actions resume the saved episode or advance to the next AniList episode; completed titles clamp to their final episode.
- 2026-07-28: Adopted MangaBaka's stable `/v1/source/anilist/{id}` route as exact-ID supplemental manga metadata. Direct MangaUpdates lookup remains deferred because the supplied OpenAPI does not establish a safe AniList-ID mapping contract.
- 2026-07-28: Replaced request-gate `finally()` cleanup with a handled two-branch cleanup after runtime testing exposed false unhandled-rejection warnings during expected provider outages. MangaDex@Home image `404`/`410` responses now invalidate the scoped node and retry once with a fresh allocation.
- 2026-07-29: Replaced the compact player/episode drawer with a Netflix-reference episode browser and a separate fullscreen player state. Adopted `@videojs/react@10.0.0-beta.25` with its recommended `HlsJsVideo` media component for accessible controls and adaptive HLS, while keeping stream resolution, URL brokering, resume, tracker updates, and torrent fallback outside the player library. The episode-to-player transition uses only transform/opacity motion and honors reduced-motion preferences.
