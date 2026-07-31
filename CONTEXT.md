# AniStream — Context

Last updated: 2026-07-31 by Codex Electron performance and IPC session

## Current phase

Phase 2 native media integration. AniList discovery/tracking, Anikoto episode lookup, MegaPlay
embedded anime playback, Netflix-style episode browsing, Framer Motion detail/player/reader
transitions, independently paged Latest Updates grids, MangaDex long-strip reading, MangaBaka
enrichment, SQLite anime/manga resume state, typed origin-validated IPC, persistent dashboard
caching, viewport-lazy reader pages, and feature-level renderer chunks are implemented. The former
AniWatch, Zenshin, AnimeTosho, Nyaa, custom HLS broker, torrent handoff, Video.js, hls.js, and
direct Motion runtime paths remain removed.

## What's working right now

- AniList authorization-code login starts restoring its encrypted token/profile during main-process
  initialization and persists until explicit logout. The local BrowserWindow can paint without
  waiting for a legacy-session profile request; auth IPC resolves only after restoration. Browse,
  unified search, pagination, title details, profile lists, progress, scores, completion,
  add/edit/remove, and latest-updated sorting work.
- The last verified AniList dashboard is persisted in SQLite and shown immediately after account
  restoration while a background refresh runs. Dashboard/search/browse/detail/latest response
  caches are TTL-bounded, identical reads are deduplicated in flight, and viewer caches are
  invalidated after mutations/logout.
- Anime and Manga are the primary navbar destinations; Profile contains both AniList libraries.
  Continue rails use AniList `CURRENT` entries and hide titles that appear caught up until new
  AniList/MangaDex availability is observed.
- Continue Watching/Reading and Trending remain Netflix-style horizontal carousels with edge
  controls, keyboard navigation, reduced motion, and real flex-width card expansion.
- Latest Anime and Latest Manga are separate static grids: 21 titles per provider page, seven
  columns × three rows at the default 1440px window, responsive at narrower widths, and no
  horizontal slider. Paging either field replaces only its own grid with 21 skeletons; Trending,
  Continue, and the rest of the catalog do not reload.
- Latest Anime is backed by paged AniList `airingSchedules` and carries normalized `pageInfo`
  through the typed preload bridge.
- Latest Manga is backed by paged MangaDex `order[latestUploadedChapter]=desc`; a bounded chapter
  batch supplies chapter number/publish time. Covers use `.512.jpg`, retry the original MangaDex
  cover URL once, and then show a title fallback.
- Every Latest Manga card has a Manga, Manhwa, Manhua, or Comic tag. MangaDex original language is
  primary, AniList country is the batch exact-ID cross-check, and MAL `media_type` is consulted only
  for up to six exact-ID gaps/disagreements per page. No title matching is used.
- The active anime adapter is `src/main/anikoto.ts`. It checks Anikoto's first 100 recent rows,
  accepts only one exact `ani_id` match, loads normalized episode rows from `/series/{id}`, and
  never maps titles by text similarity.
- Titles absent from Anikoto's recent index retain an AniList-numbered episode list and use
  MegaPlay's documented `/stream/ani/{anilistId}/{episode}/{sub|dub}` route. Exact Anikoto episode
  IDs use `/stream/s-2/{episodeEmbedId}/{sub|dub}`.
- Anikoto calls are main-process-only, serialized at one request per 2.1 seconds, bounded by a
  12-second timeout, cached for 15/30 minutes in bounded stores, deduplicated by URL while in
  flight, and paused on 429/403. The provider has a local `ANISTREAM_ANIKOTO_ENABLED` kill switch.
- Packaged AniStream serves only its built renderer assets from an ephemeral `127.0.0.1` port.
  This gives the embed a truthful HTTP referrer while retaining context isolation, a narrow preload
  bridge, host/path validation, CSP, and no renderer Node access. Fingerprinted Vite assets are
  immutable-cacheable; `index.html` is always revalidated.
- Every invoke channel is declared once in a shared TypeScript channel map. Main handlers reject
  calls whose `senderFrame` origin is not the exact local renderer origin, and the preload exposes
  only typed domain methods rather than raw `ipcRenderer`.
- Selecting a carousel title opens its details and Netflix-style episode list. Selecting an episode
  uses Framer Motion `AnimatePresence` to sweep a transform-only full-screen curtain over the view
  swap and enters real fullscreen from the trusted click gesture. Reduced-motion mode swaps
  immediately.
- Anime title cards and More Info now open directly to the episode browser. Episode rows always
  receive provider artwork/summary when present and fall back to the title banner/cover and AniList
  synopsis, so the list remains complete when Anikoto supplies only numbering.
- Watch selects the locally resumed episode when one exists; otherwise it selects the next AniList
  episode or episode 1. A thin red line shows local/AniList progress. Reaching the 90% completion
  threshold clears the local checkpoint so a later Watch action advances instead of reopening a
  completed episode.
- The fullscreen player embeds MegaPlay with sub/dub selection. `postMessage` progress is accepted
  only from `https://megaplay.buzz` and the current iframe window, persisted to SQLite every ten
  seconds, and used to update/complete the authenticated AniList entry at 90%/completion.
- The exact MegaPlay iframe intentionally has no HTML `sandbox` attribute because sandboxed
  playback was provider-blocked. Electron's BrowserWindow still uses `sandbox: true`,
  `contextIsolation: true`, no Node integration, denied child windows/navigation, source-URL
  validation, and exact message origin/window checks.
- Pressing Escape or using the visible Episodes/back control exits fullscreen, runs the same
  curtain transition, and restores the episode list. Completed embeds clear the local resume
  checkpoint without the unmount cleanup recreating it.
- The old AniWatch client, Zenshin episode mapper, AnimeTosho/Nyaa torrent discovery, magnet IPC,
  HLS manifest/proxy code, custom media protocol, Video.js, hls.js, and direct `motion` dependency
  are gone. `framer-motion` is the only renderer animation runtime.
- Manga title cards and More Info now open directly to a chapter-only detail surface; the old inline
  reader panel and the “AniList Sync / Keep your progress current” cards are removed from both media
  types.
- MangaDex chapter feeds page through the available configured-language archive in ascending order
  (bounded to 2,000 provider rows), rather than loading only the newest 100. Chapters with a
  non-empty `externalUrl` are excluded because they cannot be allocated through MangaDex@Home.
- Clicking a chapter opens a dedicated fullscreen MangaFire-inspired vertical long-strip reader.
  Framer Motion `AnimatePresence` handles entry/exit and chapter swaps; `useScroll` drives the thin
  transform-only reading indicator; Escape/fullscreen exit returns to the chapter list.
- Manga chapter ID, numeric chapter, and scroll ratio persist in SQLite every eight seconds and on
  exit. Read chooses the saved chapter, advances after 90%, falls back to the next AniList chapter,
  and otherwise opens the first available chapter. Chapter rows show a thin red local-progress line.
- The reader shows Previous/Next chapter controls at the end. Ongoing/hiatus titles show an opaque
  disabled Next control when no chapter is released; completed/cancelled titles omit it.
- MangaDex@Home page delivery remains main-process-only, uses both the shared 4 req/s API gate and a
  35 allocations/minute AtHome gate, refreshes a rotated image node once, and transfers binary
  `ArrayBuffer` page data instead of base64. The reproduced One Piece failure was fixed by
  filtering Manga Plus `externalUrl` chapters before reader selection.
- The manga reader now starts with only the first/resume-neighbor pages and admits additional pages
  through a two-request `IntersectionObserver` queue. Blob URLs are revoked on exit, failed pages
  can retry individually, and off-screen pages/episode rows/chapter rows use
  `content-visibility`.
- Concurrent MangaBaka enrichment now shares the parsed immutable result rather than sharing a
  one-use `Response` body; the runtime `Body is unusable` error found during this session is fixed
  and covered by a regression test.
- Verification passes for this session: TypeScript, ESLint with zero warnings, Prettier,
  production build, product-slice checks, 97 Vitest tests across 14 files, strict Electron security
  analysis (35 files, zero medium/high/critical findings), and runtime dependency audit (zero
  vulnerabilities).
- The development desktop runtime was driven through local CDP. A live title opened 12 episode rows;
  the unsandboxed MegaPlay embed returned HTTP 200; the Framer Motion curtain appeared; native
  fullscreen engaged; and both Escape and the visible exit control restored the episode browser.
- A second live desktop pass verified More Info opening directly to the episode browser with
  artwork and summaries, the removed sync card, a real MangaDex page in the fullscreen long-strip
  reader, the scroll indicator, retained chapter list, and fullscreen exit back to chapters.
- The same live pass verified 21 Anime cards in seven CSS-grid columns, Latest Anime page 2 without
  changing Trending, and 21 Manga cards in seven columns with 21/21 covers loaded and 21/21
  classification tags (`MANGA`, `MANHWA`, and `MANHUA` observed).
- The packaged app was launched normally with Electron logging enabled. It restored the saved
  account, rendered the signed-in seven-column Latest Anime page with remote covers, and produced
  no preload or renderer startup error. The additional DIPS database warning came from deliberately
  launching a second test instance against the same user-data directory.
- Final unsigned Apple Silicon package: `dist/AniStream-0.1.0-arm64.dmg`
  (140,062,549 bytes / 134 MiB). SHA-256:
  `d01cde15653ca023d1663fd74aac77012ee8d6296884630df6c578f6e64382a7`.
- Current provider verification is recorded in
  `docs/research/anikoto-megaplay-runtime-2026-07-29.md`.

## What's in progress

- Full MangaDex account follows/read-marker synchronization remains planned as a separate,
  opt-in, Keychain-backed personal-client module. Public MangaDex reading is independent.
- MangaDex language and scanlation-group selection remain pending. Archive paging and local
  chapter/scroll resume are now implemented.
- A full real-time episode watch is still needed to exercise every provider-owned playback control
  and observe MegaPlay's progress/completion messages over an entire stream. The packaged embed
  document and application flow are verified; direct media URLs are intentionally not extracted.
- The 21-title Latest grids need a final narrow-window visual pass below the default 1440px size;
  responsive five- and three-column rules are implemented and compile, but live CDP verification
  covered the default window.

## Open decisions (need user input)

- Before MangaDex account sync is enabled, confirm the personal API client and approve storing its
  username, password, client secret, access token, and refresh token in macOS Keychain. MangaDex
  documents that this personal-client flow bypasses account MFA.
- Provide a valid Developer ID Application certificate if the DMG should be signed and notarized.
  The installed Apple Development certificate is expired.
- Decide later whether the inactive VidKing and Parse experimental seams should be removed. Neither
  participates in current anime playback.

## Known issues / tech debt

- Anikoto documents no full-catalog search route. AniStream deliberately checks only the first 100
  recent rows instead of crawling roughly 90 pages; older titles therefore use AniList episode
  numbers and MegaPlay's direct AniList-ID route.
- MegaPlay does not map every AniList ID. An unmapped direct route may report provider error 410; the
  episode browser, AniList library, manga reader, and local state continue working.
- MegaPlay is embed-only and does not document a parent command for seeking. AniStream can remember
  an episode/time checkpoint and display it, but the provider-owned player controls exact seeking.
- Removing the provider iframe's HTML sandbox broadens what the approved MegaPlay document can do
  inside that frame. This explicit compatibility tradeoff is constrained by the retained Electron
  sandbox, context isolation, window/navigation denial, HTTPS source validation, and exact
  postMessage origin/source checks.
- The live check proves the packaged iframe received an HTTP 200 player document and the app's
  fullscreen/return flow works. It does not claim that direct HLS manifests or segments were
  extracted or that every MegaPlay control was exhaustively tested.
- MangaDex defaults to `MANGADEX_LANGUAGE=en`; licensed titles can have no chapters in that
  language. External publisher chapters such as Manga Plus are intentionally omitted because they
  have no MangaDex@Home image allocation. Exact mapping remains unavailable when
  `attributes.links.al` is absent or ambiguous.
- The MangaDex reader archive is bounded to 2,000 provider rows. Translation and scanlation-group
  selection are not implemented, so duplicate chapter numbers from different groups can appear.
- Page buffers are bounded by entry count rather than total bytes. A chapter is viewport-loaded,
  but an unusually large provider image can still create a temporary memory spike while decoded.
- MangaUpdates is consumed only through MangaBaka's normalized exact-ID record; direct integration
  remains deferred because the supplied specification did not establish a safe AniList lookup.
- MAL manga-kind cross-checks require `ANISTREAM_MAL_CLIENT_ID`. If it is absent or unreachable,
  MangaDex language remains the primary classifier and AniList country remains the available
  supplemental signal.
- TanStack Query is not installed. The existing request lifecycle remains intentionally small and
  main-process-backed; revisit only if renderer query invalidation grows substantially.
- The renderer entry is about 916 KB uncompressed. Detail, anime runtime, and manga reader are now
  separate lazy chunks (about 34 KB, 26 KB, and 39 KB respectively), so opening one media type no
  longer parses both runtimes. The entry remains worth monitoring if more global UI dependencies
  are added.
- The DMG is unsigned because no valid Developer ID Application identity is installed.
- Runtime dependency audit is clean. Development/build tooling still has previously accepted
  advisory chains.
- The AniList client secret was shared in chat and should be rotated if AniList permits.

## Next steps (in priority order)

1. Watch representative sub and dub episodes in the packaged app long enough to validate MegaPlay
   progress/completion events, local checkpoints, next-episode behavior, and AniList advancement.
2. Obtain/confirm the MangaDex personal client, move every credential/token into macOS Keychain, and
   implement opt-in token refresh, follows, read markers, reconciliation, logout, and conflicts.
3. Add MangaDex language/group selection and consider a byte-budgeted page cache if real-world
   memory profiling shows the current 18-entry bound is too permissive.
4. Exercise the Latest grids at narrow window sizes plus keyboard focus, retained carousel paging,
   completed-series end navigation, and all provider-owned player controls in a focused manual UX
   pass.
5. Install a valid Developer ID Application identity, sign/notarize the DMG, and rotate the exposed
   AniList client secret.

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
- 2026-07-29: Simplified the catalog home per user direction: removed the "Top Rated", "Based on
  Your Interest", and "Browse" sections (the paginated grid remains for search results only),
  promoted Trending to a dedicated top-20 rail with its own `TRENDING_DESC` fetch, and added
  "Latest Anime Updates" (AniList `airingSchedules`, adult-filtered, deduped per title) and
  "Latest Manga Updates" (MangaDex `order[latestUploadedChapter]=desc` with cover art). Latest-manga
  rows use the existing exact `links.al` mapping rule — mapped rows open the in-app AniList detail
  modal, unmapped rows open MangaDex externally with a visible badge, never guessed by title.
  Default window raised to 1440×900. MyAnimeList and MangaBaka were _not_ integrated in this pass;
  the user plans to supply their API documentation separately for future index strengthening
  (MangaBaka's exact-ID route is already used for manga enrichment per the 2026-07-28 entry).
- 2026-07-29 (later): Integrated MyAnimeList as supplemental indexing per user direction — "if one
  fails, the other takes over" plus score cross-referencing. Scope: MAL community scores in the
  detail modal (cross-referenced via AniList's own `idMal`, never title matching) and a MAL ranking
  rail as the Trending fallback when AniList is unreachable. AniList remains the sole tracker and
  primary metadata source; MAL cannot substitute for lists/auth. The MAL Client ID lives in the
  gitignored `.env` (public reads only, ID-as-header; no OAuth secret stored) — it was shared in
  chat but is a public identifier sent on every request, so rotation is unnecessary, unlike the
  AniList secret incident. Also per explicit user direction, adult-content filtering was removed
  across AniList browse/search, airing updates, and MangaDex latest updates. MangaBaka PAT plumbing
  added but inactive: the supplied value doesn't match the documented `mb-` prefix (likely the token
  name, not the token) and is deliberately withheld from request headers until a real PAT is
  provided.
- 2026-07-29: Superseded the AniWatch/Zenshin/AnimeTosho/Nyaa and Video.js/HLS architecture with a removable Anikoto catalog adapter plus MegaPlay's documented embedded player. AniStream accepts only exact AniList IDs from Anikoto's recent index, falls back to MegaPlay's AniList-ID route without title guessing, rate-limits and caches all Anikoto calls, validates player messages against the exact frame/origin, and serves packaged renderer assets from an ephemeral loopback-only HTTP origin because MegaPlay rejects `file://`/referrerless embeds. The packaged card → episode list → native fullscreen → Escape/exit → episode list flow was verified live.
- 2026-07-29: Replaced the direct `motion` dependency with `framer-motion` and adopted an `AnimatePresence` full-screen curtain for episode-list/player swaps. The curtain animates only transforms and becomes an immediate swap for reduced-motion users.
- 2026-07-29: Removed the HTML `sandbox` attribute from the exact MegaPlay iframe after the provider reported sandboxed playback. This is an explicit compatibility exception for that approved frame only; Electron's renderer sandbox, context isolation, denied child navigation/windows, HTTPS source validation, and exact postMessage origin/source validation remain mandatory.
- 2026-07-29: Replaced the horizontal Latest Anime/Manga rails with independently fetched 21-title pages rendered as seven columns × three rows at 1440px. Latest pagination owns its own loading/error/page state and does not refetch or blank Continue/Trending.
- 2026-07-29: Latest Manga publication kind now uses an exact-ID three-provider decision: MangaDex original language is primary, AniList country is the batch cross-check, and MAL `media_type` resolves only bounded gaps/disagreements. MangaDex covers use a 512px CDN image with one original-image fallback.
- 2026-07-30: Made episode and chapter lists the default title-detail content. Watch/Read are
  continuation actions: local SQLite resume wins, completed local progress advances, AniList
  progress is the remote fallback, and episode/chapter 1 is the final fallback.
- 2026-07-30: Replaced the inline MangaDex reader with a fullscreen vertical long-strip reader.
  Framer Motion owns view transitions and scroll-linked progress; SQLite owns local chapter and
  scroll resume while AniList remains the tracker.
- 2026-07-30: MangaDex chapter records with `attributes.externalUrl` are not readable
  MangaDex@Home chapters even when `pages > 0`; AniStream now filters them before selection and
  never sends their IDs to `/at-home/server/{chapterId}`.
- 2026-07-31: Kept Electron 43.2.0 after confirming it is the current stable release rather than
  forcing a Chromium roller workflow intended for Electron's source repository. Hardened the app
  instead: exact-origin typed IPC, non-blocking first paint, persistent/TTL-bounded caches,
  immutable fingerprinted assets, separate anime/manga lazy chunks, binary MangaDex IPC, and
  viewport-driven reader loading. Electron sandbox/context isolation and the approved unsandboxed
  MegaPlay iframe exception are unchanged.
