# AniStream Codebase Audit — 2026-07-31

Read-only architecture, performance, and UX audit. No code was changed as part of this
document. Produced by reading `CONTEXT.md`, `API.md`, `package.json`, and every file under
`src/` and `test/` (13,792 lines across 51 files), then running four focused deep-dive passes
in parallel (playback/reading UX, data/caching layer, Electron main-process architecture,
renderer UI/CSS/animation), each cross-checking CONTEXT.md's claims against the actual code
rather than trusting the docs. Every finding below cites a real `file:line`; every fix is a
specific code change, not general advice.

Skills consulted: `electron-best-practices`, `electron-development`, `macos-design-guidelines`,
`design-review`, `framer-motion-animator`, `motion-framer`, `gsap-framer-scroll-animation`,
`shadcn-layouts` (confirmed not applicable — see §6.8). `improve-codebase-architecture` and
`postgresql-optimization` were evaluated for relevance: the former's checklist was applied
manually (no dedicated skill was found registered under that name in this environment); the
latter does not apply — this project uses `better-sqlite3`, not PostgreSQL, so no
Postgres-specific tuning exists to perform.

---

## 1. Overall rating

| Dimension | Score | One-line reason |
|---|---|---|
| Electron security posture | **9.0 / 10** | sandbox+contextIsolation+no-nodeIntegration all correctly set, typed origin-validated IPC with zero bypasses found, minimal preload bridge, documented MegaPlay iframe exception has real compensating controls |
| Architecture & provider isolation | **8.0 / 10** | clean per-provider adapters, shared cache/queue primitives, one unbounded cache, some duplicated concurrency logic |
| Caching & network resilience | **7.5 / 10** | real LRU+TTL bounds almost everywhere, race-free request dedup/throttle, no stale-while-revalidate pattern anywhere |
| Playback UX (anime) | **6.5 / 10** | functional and secure, but no error/retry state, no keyboard escape outside native fullscreen, no focus trapping |
| Manga reader UX | **8.0 / 10** | best-implemented surface in the app — correct blob URL lifecycle, transform-only scroll progress, viewport-gated loading |
| Renderer UI/CSS quality | **6.5 / 10** | strong Framer Motion discipline and reduced-motion coverage, but a 3,459-line CSS file with duplicate rule blocks, ~23 dead classes, two broken custom-property references, and inconsistent loading states |
| Dead code hygiene | **6.5 / 10** | the big documented removals (AniWatch/Zenshin/AnimeTosho/Nyaa/hls-proxy/video.js) are genuinely 100% gone; smaller leftovers remain (Parse IPC surface, 2 unused DB tables, 23 CSS classes, dead media query) |
| Test/tooling discipline | **8.5 / 10** | 97 Vitest tests, typecheck/lint/format/build/security-scan all wired into CI, pure-function extraction specifically for testability |
| Documentation practices | **7.5 / 10** | unusually detailed CONTEXT.md/API.md with a real decision log, but several claims (non-blocking first paint, VidKing removal scope, 18-page-buffer meaning, responsive breakpoint coverage) are stale or imprecise against the current code |

**Overall: 7.6 / 10 — a well-architected, security-conscious personal project that has clearly
had real engineering discipline applied to it (typed IPC, bounded caches, race-free request
queues, pure-function test extraction). What's missing is a UI-polish and cleanup pass: loading
states are inconsistent, the CSS file has accumulated dead weight from three UI rewrites, and a
few caches/DB tables were scaffolded but never finished or removed.**

None of the findings below are severe (no security holes, no data-loss bugs, no crashes found).
They are ranked by effort-to-value below in §7.

---

## 2. The video.js question — direct answer

**Video.js is not applicable to the current anime player architecture, and adding it would not
improve anything.** This needs stating plainly because it's a reasonable thing to ask for and
the honest answer is "there's nothing to attach it to," not "here's how to improve it."

- The entire playback surface is a raw cross-origin `<iframe src="https://megaplay.buzz/...">`
  ([`AnimeWatchExperience.tsx:562-573`](../../src/renderer/src/AnimeWatchExperience.tsx)).
  There is no `<video>` element anywhere in the codebase for a player library to control.
- `AnimePlaybackCandidate.kind` is a closed TypeScript literal union with exactly one member,
  `"embed"` ([`shared/contracts.ts:256-263`](../../src/shared/contracts.ts)) — the type system
  has no second variant for a direct-media/HLS path to plug into.
- The Anikoto adapter only ever produces embed candidates
  ([`main/anikoto.ts:301-318`](../../src/main/anikoto.ts)) — no manifest URL, no direct media
  URL, nothing a `<video>` tag could consume.
- The CSP served with the renderer locks `frame-src` to exactly `https://megaplay.buzz` and has
  no allowance for a self-hosted media origin
  ([`main/renderer-server.ts:6-20`](../../src/main/renderer-server.ts)).
- `package.json` has no `video.js`, `@videojs/react`, or `hls.js` dependency.
- **This was already tried and reverted, same day.** CONTEXT.md's own changelog records
  adopting `@videojs/react@10.0.0-beta.25` with `HlsJsVideo` on 2026-07-29
  (`CONTEXT.md:298`), then superseding it later that same day: *"Superseded the
  AniWatch/Zenshin/AnimeTosho/Nyaa and Video.js/HLS architecture with a removable Anikoto
  catalog adapter plus MegaPlay's documented embedded player"* (`CONTEXT.md:321`). MegaPlay is
  embed-only and does not publish a raw HLS manifest/segment contract
  ([`API.md:228-229`](../../API.md)), so there was never a stream for video.js to control.

**What would have to change before video.js became relevant again:** a *new* video source that
returns a real manifest/segment URL instead of an iframe embed — e.g. a self-hosted HLS bridge
or a provider with a documented direct-media API. That is a full new adapter (new
`AnimePlaybackCandidate` kind, a privileged main-process media broker like the one CONTEXT.md
records was removed, CSP changes to allow the new media origin) — not an "improve the current
player" task. If that direction is ever wanted, say so explicitly and it can be scoped
separately; it is out of the scope of "improve the existing player."

**What can genuinely be improved in the player today** is UX around the iframe, not the iframe
itself — see §3 below.

---

## 3. Anime playback UX — findings

All in [`src/renderer/src/AnimeWatchExperience.tsx`](../../src/renderer/src/AnimeWatchExperience.tsx)
unless noted.

### 3.1 No feedback once the iframe document has loaded but video hasn't actually started
`loaded` flips to `true` on `<iframe onLoad>` (line ~572), which fires when the iframe
*document* parses — not when MegaPlay's internal player actually starts playing. The loading
spinner disappears at that point even if the video itself takes several more seconds to buffer
(ads, redirects, slow CDN), leaving a bare, apparently-frozen iframe.
**Fix** — track the first `progress` postMessage event as the real "playing" signal and keep a
buffering overlay until either that fires or an error state is reached:
```tsx
const [hasProgressed, setHasProgressed] = useState(false);
// inside the existing progress branch of handleMessage:
if (!hasProgressed) setHasProgressed(true);
// render:
{!loaded || !hasProgressed ? <div className="anikoto-player-loading" role="status">…</div> : null}
```

### 3.2 No error/retry state for a failed embed load
There is no `onError` on the `<iframe>`, and cross-origin iframe load failures don't reliably
fire `onError` anyway. If the embed fails (network error, MegaPlay outage, ad-block
interference), `loaded` never becomes `true` and the spinner spins forever with no retry
affordance — the only escape is backing out to the episode list entirely.
**Fix** — add a timeout fallback and a retry control:
```tsx
const [loadTimedOut, setLoadTimedOut] = useState(false);
useEffect(() => {
  setLoadTimedOut(false);
  const timer = setTimeout(() => { if (!loaded) setLoadTimedOut(true); }, 15_000);
  return () => clearTimeout(timer);
}, [source.id, episode.number]);
// render a retry button when loadTimedOut is true, remounting the iframe via its key
```

### 3.3 No keyboard Escape path outside native browser fullscreen
There is no `keydown` handler anywhere in this file. Exiting only works via the native
`fullscreenchange` listener or the visible back button. If the app's internal "player" view is
showing but the OS/browser isn't in native Fullscreen (e.g. user exited via an OS gesture),
Escape does nothing. Contrast with `MangaReaderFullscreen.tsx:207-222`, which does wire Escape.
**Fix**:
```tsx
useEffect(() => {
  if (view !== "player") return;
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !document.fullscreenElement) returnToEpisodes();
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [view, returnToEpisodes]);
```

### 3.4 No focus trapping / dialog semantics on the fullscreen player
The `.watch-player-view` wrapper (~line 252) has no `role="dialog"`/`aria-modal`, and nothing
moves focus into it on entry. Tab order can leak to elements visually hidden behind the player;
screen readers get no "you're in a player now" context. `MangaReaderFullscreen.tsx:226-228`
already does this correctly — mirror it here.
**Fix**: add `role="dialog" aria-modal="true"` to the player wrapper, and:
```tsx
const backButtonRef = useRef<HTMLButtonElement>(null);
useEffect(() => { if (view === "player") backButtonRef.current?.focus(); }, [view]);
```

### 3.5 State churn competes with the curtain transition for the same animation frames
`playEpisode` synchronously fires `setLoadingPlayback(true)`, `setPlayback(undefined)`,
`setSource(undefined)`, `setActiveEpisode(episode)`, and `transitionTo("player")` all in one
tick. `setActiveEpisode` immediately triggers the `getAnimePlayback` effect (a new IPC round
trip and re-render) *while* the 300ms curtain animation is already in flight — both are
competing for main-thread time on the same frames, risking dropped animation frames on slower
hardware even though the curtain itself only animates a transform (no layout thrash).
**Fix** — defer the data-fetching state change until the curtain finishes covering the screen:
stash the target episode in a ref, apply `setActiveEpisode` inside `onAnimationComplete`
alongside the existing `setView(transitionTarget)` call, so the IPC dispatch doesn't start
until after the 300ms slide completes.

### 3.6 Unmemoized per-render recomputation
`allEpisodes`, `activeIndex`, `nextEpisode`, `embedSources` (lines ~66-72) are plain `const`
expressions recomputed on every render, including a `.flatMap` over all seasons' episodes (up
to `MAX_EPISODES = 2_000` per `anikoto.ts:19`). Cheap today, but an easy, free win.
**Fix**:
```tsx
const allEpisodes = useMemo(() => seasons.flatMap((s) => s.episodes), [seasons]);
const embedSources = useMemo(
  () => playback?.candidates.filter((c) => c.kind === "embed") ?? [],
  [playback],
);
```

### 3.7 What's already correct (no fix needed, confirmed by direct code reading)
- `postMessage`, `fullscreenchange`, and outer unmount effects all clean up their listeners
  correctly — no leak found.
- `event.source !== iframeRef.current?.contentWindow` origin/window check on line ~519 is
  intentional and correct: it rejects stale messages from a previous iframe instance after a
  remount, not a bug.
- Resume-checkpoint saving (throttled to 10s, force-flushed on unmount) is a sound, already-used
  pattern — matches the manga reader's 8s equivalent.
- The curtain's easing/duration (`[0.22, 1, 0.36, 1]`, 0.3s, transform-only) and its
  `useReducedMotion` handling are both correctly implemented.
- The missing `sandbox` attribute on the MegaPlay iframe is a deliberate, documented exception
  (`CONTEXT.md:73,163,323`) — confirmed the compensating controls actually exist in code (see
  §5.5), not just asserted in docs.

---

## 4. Manga reader UX — findings

All in
[`src/renderer/src/MangaReaderFullscreen.tsx`](../../src/renderer/src/MangaReaderFullscreen.tsx)
unless noted. **This is the best-implemented interactive surface in the app** — most items below
are minor tuning notes, not bugs.

### 4.1 `requestedPages` Set isn't cleared on cleanup — dev-only StrictMode leak
The reader-cleanup effect (~lines 179-185) revokes every blob URL still held, but never calls
`requestedPages.current.clear()`. Under React StrictMode (enabled — `main.tsx:1,11`), double-
invoked effects can create a blob URL that's discarded before ever being stored/revoked. This is
invisible in production (StrictMode double-invoke is dev-only) but worth closing.
**Fix**: add `requestedPages.current.clear();` to the same cleanup block at line ~181.

### 4.2 Renderer-side page cache is unbounded *within* a single long chapter
The main-process `pageCache` really is bounded to 18 entries
([`main/mangadex.ts:22`](../../src/main/mangadex.ts)) and is real LRU+TTL — but that bounds
*fetched raw bytes before IPC transfer*, not what the renderer keeps alive. Once a page's blob
URL is created client-side, it stays in `pageUrls` (and therefore in memory as a live decoded
image) until the chapter changes — for a very long webtoon chapter, memory grows roughly
linearly with pages scrolled past. `content-visibility: auto` mitigates paint/layout cost but
not the underlying blob memory. If a doc or mental model reads "18 pages" as "the reader only
keeps 18 in memory at a time," that's inaccurate — clarify that number refers to the
main-process fetch cache, not renderer-held images.
**Fix (optional, only worth doing if real memory profiling shows it matters)**: evict blob URLs
for pages more than N pages behind the current scroll position, revoking them and clearing their
`pageUrls`/`requestedPages` entries so `LazyMangaPage`'s `IntersectionObserver` re-fires and
re-fetches on scroll-back (cheap, since the main-process 18-entry cache will usually still be
warm).

### 4.3 Fixed prefetch tuning, not adaptive to connection speed
`PAGE_LOAD_CONCURRENCY = 2` and `PAGE_PREFETCH_MARGIN = "1800px 0px"` (lines 19-20) are static.
Given the main-process AtHome allocation gate allows 35 requests/minute
([`mangadex.ts:42-44`](../../src/main/mangadex.ts)), the client-side concurrency of 2 is the
actual bottleneck on a fast connection, not MangaDex's limit.
**Fix**: bump `PAGE_LOAD_CONCURRENCY` to 3, or make it adaptive via
`navigator.connection?.effectiveType` if available.

### 4.4 What's already correct (confirmed by direct code reading)
- Blob URL creation/revocation on the steady-state path is correctly ordered — no leak in
  normal (non-StrictMode) operation.
- The 20-entry `atHomeCache` for chapter-node metadata is real, bounded, and accurately matches
  any "20 chapter nodes" documentation claim.
- Scroll-linked reading progress uses a pure `scaleX` transform driven by a spring motion value
  — zero layout/reflow cost, a clean implementation.
- `persistProgress` is correctly throttled to one IPC/DB write per 8 seconds even though the
  underlying scroll-progress listener fires on every frame.
- `decoding="async"` (no `loading="lazy"`) on page images is the *correct* choice here, since
  the `<img>` only enters the DOM once `IntersectionObserver`-gated prefetch has already
  fetched the bytes — `loading="lazy"` would be redundant/counterproductive at that point.
- Page bytes transfer as a raw `ArrayBuffer` via structured clone (no base64/JSON overhead) —
  the efficient choice, confirmed in `mangadex.ts:223-230`.

---

## 5. Data layer, caching, and Electron architecture

### 5.1 One genuinely unbounded cache
[`main/mangabaka.ts:20`](../../src/main/mangabaka.ts) uses a plain `new Map<number,
CachedEnrichment>()` instead of the shared `createBoundedCache` primitive every other provider
cache uses. Entries are added on every manga detail view and never evicted by count — only a
lazy TTL check on read. Keys are AniList manga IDs; a long browsing session could accumulate an
unbounded number of stale entries.
**Fix**:
```ts
import { createBoundedCache } from "./anilist/cache";
private readonly cache = createBoundedCache<MangaEnrichment>({ maxEntries: 150, ttlMs: CACHE_TTL_MS });
```
Delete the now-redundant `CachedEnrichment` interface and manual `expiresAt` handling
(lines 10-13, 34-35, 56).

### 5.2 Anikoto reimplements request-queue logic instead of extending the shared primitive
`main/anilist/request-queue.ts`'s `createRequestGate()` is a correctly race-free (single-
threaded promise-chain) primitive reused by AniList/MAL/MangaBaka/MangaDex. `main/anikoto.ts`
(lines 38-41, 122-181) independently re-derives the same dedup/cleanup-safety properties for its
own fixed-2.1s-interval pacing, duplicating ~60 lines of concurrency-critical code that had to be
separately verified correct.
**Fix**: add an optional `minIntervalMs?: number` to `RequestGateOptions`
(`request-queue.ts:9-12`), enforce it inside `acquireSlot()`'s loop, and replace Anikoto's
hand-rolled implementation with `createRequestGate({ requestsPerMinute: Infinity, minIntervalMs: 2_100 })`.

### 5.3 No stale-while-revalidate pattern anywhere
Every cache (AniList browse/detail/dashboard, MangaDex, MAL, MangaBaka, Anikoto) is strict
"cache hit or block on network" — there's real LRU+TTL, but no background-refresh-while-serving-
stale pattern. For rate-limited providers (MangaDex 4 req/s, Anikoto 1 req/2.1s) with short TTLs
(2-5 min), wrapping `browseCache`/`detailCache` reads in a SWR helper (serve cached value
immediately, kick off a background refetch, update on resolve) would improve perceived latency
on revisit without extra provider load. Not currently implemented anywhere; worth prototyping
around the two highest-traffic caches (AniList `browseCache`, MangaDex `availabilityCache`)
first.

### 5.4 Two unused SQLite tables shipped in every user's database
[`main/database.ts:37-53`](../../src/main/database.ts) defines `library_entries` and
`sync_queue` tables — confirmed via grep that **no prepared statement anywhere queries either
table** beyond the `CREATE TABLE IF NOT EXISTS`. This is scaffolding for a planned
offline-sync/local-library feature that was never finished.
**Fix**: either implement the feature these tables were built for, or delete the two `CREATE
TABLE` statements — carrying two schema objects (one with `CHECK`/`AUTOINCREMENT`) that nothing
reads or writes is confusing dead weight in every installed copy of the app.

### 5.5 Parse episode-guide feature is fully wired but has no caller — the actual dead code, not VidKing
CONTEXT.md (`CONTEXT.md:151`) frames *VidKing and Parse* together as "inactive experimental
seams." Verified against code: **VidKing is already 100% gone** — `grep -rin "vidking" src/`
returns zero matches; the doc note about it is stale. **Parse is different**: it is fully wired
end-to-end (`main/parse-anime.ts` → registered in `main/index.ts:220-224` as IPC channel
`anime:episode-guide` → declared in `shared/ipc.ts:59` and `shared/contracts.ts:400` → exposed
on the preload bridge as `getAnimeEpisodeGuide` in `preload/index.ts:25`) but **no renderer
component ever calls it** — confirmed via grep across every `.tsx` file. It's also inert without
a paid `PARSE_API_KEY` even if called. There's also an orphaned `.episode-guide` CSS rule at
`styles.css:2690` for the same abandoned feature.
**Fix**: delete `main/parse-anime.ts` and its 4 wiring points (`index.ts`, `shared/ipc.ts`,
`shared/contracts.ts`, `preload/index.ts`) plus the dead CSS rule — *or* actually call it from
the episode-browser UI if the feature is still wanted. Given the linked research doc's own
conclusion was "unapproved hosted scraper pending cost/authorization" (`CONTEXT.md:234`),
deletion is the more consistent choice unless there's a concrete near-term plan to finish it.

### 5.6 Redundant full-detail IPC round-trip after every list mutation
`MediaDetailModal.tsx` (5 call sites: lines ~141-142, 159-164, 184-189, 208-216, 330-334) calls
`updateAniListEntry`/`addAniListEntry` (which return `void`), then immediately re-issues a full
`getAniListMediaDetail` call — a large GraphQL query covering title/synopsis/studios/cast/
staff/relations/recommendations/links — purely to read back a 4-field `listEntry` object
(`id`, `status`, `score`, `progress`).
**Fix**: change `updateEntry`/`addEntry` in
[`main/anilist/client.ts:230,393`](../../src/main/anilist/client.ts) to return the mutated
entry from AniList's own mutation response instead of `void`; propagate the return type through
`shared/ipc.ts:52-53`; update the 5 `MediaDetailModal.tsx` call sites to merge the returned
entry into local state instead of re-fetching the whole detail payload. Removes 5 full-detail
round trips from the hot progress-tracking path.

### 5.7 Startup isn't fully non-blocking, contrary to the literal CONTEXT.md claim
CONTEXT.md claims "non-blocking first paint" (`CONTEXT.md:337`). True for the AniList
session-restore specifically (`index.ts:126`, awaited only after `createWindow`), but two other
things *do* sit on the blocking path before `createWindow()` is called
([`main/index.ts:112-406`](../../src/main/index.ts)):
- `openAppDatabase(...)` (line 118) is a fully synchronous `better-sqlite3` open + 4 pragmas +
  schema creation + ~9 prepared statements, all on the main thread.
- `rendererServerPromise` is genuinely `await`ed (line 132) before `createWindow` can run in the
  packaged app, since the window needs the resolved local server URL.
**Fix**: call `createWindow(rendererUrl)` immediately once the renderer server resolves, and
open the database in parallel behind a `databasePromise` that only the DB-backed IPC handlers
(`playback:resume`, `anilist:cached-dashboard`, etc.) await — mirroring the pattern already used
for `restorePromise`.

### 5.8 `renderer-server.ts` is a sound but inherently fragile workaround
Running a loopback HTTP server just so the MegaPlay iframe gets a truthful `Referer` header is
well-mitigated in code (127.0.0.1-only bind, Host-header pinning, path-traversal guards,
GET/HEAD-only, full security headers on every response including errors, `server.unref()` +
explicit close on quit — all verified present). It is, however, more attack surface than
`file://` loading by nature (it's a listening socket), and the redundant `<meta
http-equiv="Content-Security-Policy">` in `renderer/index.html:7-10` can drift from the
authoritative HTTP-header CSP in `renderer-server.ts:6-20` since nothing keeps them in sync.
**Fix (low-effort hardening)**: delete the meta-tag CSP entirely — Electron's `loadURL` applies
the HTTP-header CSP before the HTML is even parsed, so the meta tag is purely redundant, not a
fallback. **If extended to more providers later**, prefer `session.defaultSession.webRequest
.onBeforeSendHeaders` scoped to `urls: ["https://megaplay.buzz/*"]` to inject the `Referer`
header on just that request, rather than adding more loopback listeners.

### 5.9 Confirmed clean: IPC design, preload bridge, security posture
Independently verified, no fix needed:
- Every IPC channel flows through the single typed `IpcInvokeChannelMap`
  (`shared/ipc.ts:39-99`), enforced identically by `registerTrustedIpcHandler` in
  `main/ipc.ts` and `invoke()` in `preload/index.ts` — zero raw `ipcMain.handle`/`ipcRenderer`
  bypasses found anywhere.
- Every handler validates `event.senderFrame`'s origin against the exact local renderer origin
  — no exceptions found.
- `BrowserWindow` webPreferences (`main/index.ts:55-64`): `contextIsolation: true,
  nodeIntegration: false, sandbox: true, webviewTag: false` — all explicitly re-asserted, not
  left to defaults.
- The MegaPlay iframe's missing `sandbox` attribute has real compensating controls: the embed
  URL is always server-constructed against a hardcoded `MEGAPLAY_ORIGIN` (never
  renderer-supplied), `postMessage` handling checks both `event.origin` and `event.source`
  identity, and `setPermissionRequestHandler` restricts the `fullscreen` permission to an exact
  two-origin allowlist. This matches what CONTEXT.md documents — verified true, not hand-waved.
- The big documented removals (AniWatch, Zenshin, AnimeTosho, Nyaa, hls-proxy, hls-manifest,
  anime-sources, zenshin-episodes, video.js, hls.js) are **100% gone** — zero references found
  anywhere in `src/` or `test/`, confirmed by grep. This specific set of CONTEXT.md claims is
  fully accurate.

---

## 6. Renderer UI, CSS, and animation

### 6.1 Inconsistent loading/skeleton states
Only the Latest Anime/Manga grids have a real shimmer skeleton
(`.latest-update-skeleton`, `styles.css:812-819`). Everything else pops in with plain loading
text or nothing:
- Trending rail: plain `"Loading AniList catalog…"` text
  ([`CatalogView.tsx:267-269`](../../src/renderer/src/CatalogView.tsx)).
- Search results page-2+ transitions: **zero visual feedback** — the stale page-1 grid stays on
  screen unchanged while a new page loads, because the loading-text condition is gated on
  `!trending.length && !searchItems.length`, which is false once any results have ever rendered.
- Detail modal: hero paints immediately, but everything below it (`dl`, cast, relations, links)
  mounts conditionally with no reserved space, causing a real layout jump.
- The manga reader's lazy-chunk `Suspense` fallback (`MediaDetailModal.tsx:547`) is a bare
  gradient div with **no spinner and no text** — a first-time chapter open shows a blank dark
  screen.
- The detail-modal chunk's own `Suspense fallback={null}` (`App.tsx:330`) means a cold-start
  click on a card is a dead click until the chunk downloads.

**Fixes**:
1. `CatalogView.tsx:267-269` — reuse the existing shimmer pattern for the Trending rail instead
   of text.
2. `CatalogView.tsx:266-269` — key loading/dim state off `loading` alone so page transitions get
   feedback (e.g. `aria-busy={loading}` + `opacity: loading ? 0.4 : 1` on `.browse-grid`).
3. `MediaDetailModal.tsx:424-544` — reserve skeleton space via `min-height` for the overview/
   cast/relations sections.
4. `styles.css:2566-2568` — replace the bare gradient with the same spinner pattern already used
   for the anime player's loading state (`.anikoto-player-loading`, `styles.css:2031-2052`).
5. `App.tsx:330` — give the `Suspense fallback` a minimal spinner (`.loading-orbit`,
   `styles.css:3384-3391`, already exists) instead of `null`.

### 6.2 Inconsistent image-loading attributes and error fallbacks
`loading="lazy" decoding="async"` is applied in most catalog/rail image spots but **missing** on
the nav avatar, profile hero avatar, add-title search results, relations mini-grid, and the
global-search popover thumbnails. Only `LatestMangaCover`
([`CatalogView.tsx:557-569`](../../src/renderer/src/CatalogView.tsx)) has a real `onError`
fallback chain (retry once, then text fallback) — every other cover image shows a permanently
broken-image icon on a CDN miss.
**Fix**: add the two attributes to the listed spots
(`App.tsx:282,435,529`, `MediaDetailModal.tsx:518,671`, `GlobalSearch.tsx:133`); extract
`LatestMangaCover`'s fallback logic into a shared `<CoverImage src fallbackSrc title />`
component and reuse it everywhere else a cover image is rendered.
No CLS risk was found — every image container already has a CSS `aspect-ratio`, which is the
correct modern substitute for explicit `width`/`height` attributes.

### 6.3 One real layout-triggering animation, by design
`.rail-card` (`styles.css:570-583`) transitions `flex-basis`, which is not compositor-only —
hovering one card forces layout recalculation across up to ~24 sibling cards in that row, because
that's literally the point (real flex-width expansion so a focused card visually pushes its
neighbors, per `ContentCarousel.tsx`'s own comment). This is a legitimate Netflix-authenticity
trade-off, correctly bounded to one row rather than the whole page — not a bug, but worth
knowing it's the one place in the app that breaks the "transform/opacity only" rule, so it isn't
copied elsewhere by accident. If jank ever shows up on lower-end hardware, the fallback is
dropping the "push" effect for a `transform: scaleX()`-only hover on the art.

Everything else animated with Framer Motion — modal enter/exit, search popover, pagination
stagger + spring `layoutId` indicator — is correctly transform/opacity-only, and
`prefers-reduced-motion` is checked consistently in every `motion.*` usage across all four
components reviewed, plus a global CSS safety net
(`styles.css:3450-3459`) that covers pure-CSS animations too. This is genuinely well done.

### 6.4 CSS custom-property bug — two undefined tokens silently no-op four rules
`:root` (`styles.css:1-22`) never defines `--text` or `--accent`, but both are referenced with
no fallback at `styles.css:2552,2562,2583,2620`. An unresolved `var()` with no fallback makes
`color` fall back to the *inherited* value — these four declarations are silent no-ops.
**Fix**: add `--text: #f5f5f5; --accent: var(--cyan);` to `:root`, or replace the four
references with existing tokens directly.

### 6.5 Duplicate/conflicting CSS rule blocks from incomplete refactors
Three selectors are defined twice with genuinely conflicting values, evidence of a UI rewrite
that didn't delete the old rules:
- `.detail-modal:has(.watch-experience)` — `width: min(1380px, 96vw)` (`styles.css:1235-1237`)
  vs. `width: min(1120px, 94vw)` (`styles.css:1661-1663`).
- `.watch-experience` — bordered/shadowed (`styles.css:1244-1252`) vs. borderless/transparent
  "Netflix-inspired" version (`styles.css:1670-1677`, comment confirms this is the newer one).
- `.anistream-player` — `position: relative` (`styles.css:1321-1329`) vs. `position: absolute`
  (`styles.css:2011-2020`).
**Fix**: delete the earlier (losing, unreachable) block in each pair.

### 6.6 ~23 dead CSS classes — the old custom video-control-bar UI, never deleted
Confirmed by grepping every `.tsx` file in the renderer tree (not just the audited subset): the
entire pre-Netflix-redesign player chrome is still in `styles.css` and referenced by zero
components — `.player-controls`, `.player-progress-row`, `.player-control-row`,
`.player-control-group`, `.player-control-right`, `.volume-range`, `.speed-popover`,
`.mini-next-popover`, `.source-strip`, `.player-hidden-select`, `.player-popover-anchor`,
`.player-episode-label`, `.player-title`, `.player-gradient`, `.playback-stage`,
`.watch-header`, `.watch-back`, `.watch-experience--player`, `.episode-list`,
`.episode-guide`, `.media-shelf`, `.icon-button`, `.vidking-player`, `.manga-reader-error`
(roughly 280 lines total, `styles.css:855,1263-1655,1927,2185,2570,2690,2764`). CONTEXT.md
documents the replacement ("Replaced the compact player/episode drawer with a Netflix-reference
episode browser") but the old rules were never removed.
**Fix**: delete all 23 blocks — confirmed unreachable from any current component.

### 6.7 `!important` patch over a real specificity bug
`.avatar-button { border-radius: 8px !important; }` (`styles.css:170`) is losing to
`.nav-account > button { border-radius: 50%; }` (`styles.css:152-157`, higher specificity from
the child combinator), and `!important` was used to force it rather than fixing the specificity.
**Fix**: move the `.avatar-button` rule after `.nav-account > button` in source order, or scope
it as `.nav-account > .avatar-button`, and drop `!important`.

### 6.8 Dead/unreachable responsive breakpoint
`styles.css:2148` and `styles.css:3423-3447` define `@media (max-width: 760px)` rules, but
`main/index.ts:50-51` sets `minWidth: 960` on the `BrowserWindow` — the window can never be
narrower than 960px, so this entire breakpoint is unreachable in the shipped app. CONTEXT.md
claims the responsive CSS was reviewed and found adequate for the 960×640 minimum
(`CONTEXT.md:266`) — that review apparently missed that a chunk of the breakpoint CSS targets a
width that can't be reached. Relatedly, `body { min-width: 860px }` (`styles.css:34`) is below
the real enforced 960px minimum and should be updated to match.
**Fix**: delete or re-scope the `760px` rules to `≤1100px`/`960px` (whichever was actually
intended), and change `styles.css:34` to `960px`.

### 6.9 CSS structure/scale
3,459 lines, ~190 selectors, flat single-pass organization in roughly page order, no ITCSS/BEM
convention, colors tokenized via custom properties but spacing is all magic numbers (`52px 8vw`,
`150px 5vw 105px`, etc. — no spacing scale). Not urgent today, but this will get harder to
maintain as the file grows; a light split (tokens / base / catalog / detail-modal / player /
reader / responsive) would pay for itself before the file crosses ~5,000 lines.

### 6.10 Accessibility notes
- Global `:focus-visible` styling is solid and consistently applied.
- `MediaDetailModal` has `role="dialog" aria-modal="true"` and Escape-to-close, but **no focus
  trap** — Tab can move out of the dialog into the page behind the backdrop, which contradicts
  the `aria-modal="true"` promise. **Fix**: focus the close button on mount, add a basic
  Tab/Shift+Tab wrap-around trap.
- `ContentCarousel`'s arrow-key paging only works while focus sits on the carousel's outer
  wrapper, not once a user has Tabbed into an individual card — no roving-tabindex, no guarantee
  a newly focused card is scrolled fully into view past the edge-fade gradient. **Fix**:
  consider `scrollIntoView({ block: "nearest" })` on card focus, or roving-tabindex across the
  row.
- Icon-only buttons elsewhere (nav refresh, avatar, carousel edges, search clear, pagination,
  modal close, cast/staff) all have correct `aria-label`s — no gaps found there.
- A handful of small muted-text tokens (`#8e8e8e`/`#777` on dark backgrounds, used for card
  metadata) sit close to the WCAG AA 4.5:1 threshold; not catastrophic, worth a contrast pass if
  accessibility is a priority.

### 6.11 GSAP verdict: no
GSAP would add a second animation runtime, a second bundle-size cost, and a second
`prefers-reduced-motion` surface to keep in sync — for zero incremental capability. Its
differentiating strengths (`ScrollTrigger` pinning, scroll-scrubbed timelines) don't map onto
anything in this app: carousels scroll via native `scrollBy`/`scroll-snap-type`
(user-initiated, not scroll-linked), and there is no long-scroll/scrollytelling surface anywhere
in the UI. Every animation actually present is squarely Framer Motion's sweet spot and is
already implemented well. **Do not add GSAP.**

### 6.12 `shadcn-layouts` — confirmed not applicable
No Tailwind config, no `components.json`, no `@/components/ui/*` imports anywhere — this is a
hand-rolled CSS codebase, not a shadcn/ui project. The skill's layout-debugging mental model
(flex/grid reasoning) was applied conceptually while reviewing the carousel/grid layouts above,
but its component-composition guidance doesn't map onto this stack. No action item here.

### 6.13 Debouncing
`GlobalSearch.tsx` correctly debounces keystrokes at 250ms with a 2-character minimum and
discards stale out-of-order responses via a monotonic request ID — no changes recommended, this
is a clean implementation. Other search entry points (catalog search-mode fetch, "Add title"
modal) are submit-triggered, not keystroke-triggered, so no debounce is needed there and none
was incorrectly omitted.

---

## 7. Prioritized action list

### Quick wins (each under ~30 minutes, no design decisions needed)
1. §6.4 — define `--text`/`--accent` in `:root` (4 silently-broken rules).
2. §6.7 — fix `.avatar-button` specificity, drop `!important`.
3. §6.5 — delete the 3 duplicate/superseded CSS rule blocks.
4. §6.8 — delete or fix the unreachable `760px` media queries; fix `body { min-width }`.
5. §6.2 — add `loading="lazy" decoding="async"` to the 6 listed `<img>` spots.
6. §3.6 — memoize `allEpisodes`/`embedSources`/etc. in `AnimeWatchExperience.tsx`.
7. §4.1 — clear `requestedPages` in the manga reader's cleanup effect.
8. §5.8 — delete the redundant meta-tag CSP from `index.html`.

### Medium effort (a focused session each)
9. §6.6 — delete the ~23 dead player-UI CSS classes (~280 lines).
10. §5.5 — delete (or finish wiring) the Parse episode-guide feature end to end.
11. §5.4 — delete (or implement) the two unused SQLite tables.
12. §5.1 — bound the MangaBaka cache with `createBoundedCache`.
13. §6.1 — add skeleton/loading states to Trending rail, search pagination, detail modal, manga
    reader chunk, and detail-modal `Suspense` fallback.
14. §3.1–3.4 — anime player: buffering feedback, error/retry state, keyboard Escape, focus trap.
15. §6.10 — focus trap for `MediaDetailModal`; roving focus for carousel cards.
16. §6.2 — extract a shared `<CoverImage>` component with fallback handling.

### Larger changes (architectural, worth scoping separately)
17. §5.6 — return mutated entries from AniList mutations to cut 5 redundant full-detail IPC
    round trips.
18. §5.7 — reorder startup so `createWindow()` isn't gated behind the synchronous DB open.
19. §5.2 — fold Anikoto's pacing into the shared `RequestGate` (`minIntervalMs` option).
20. §5.3 — prototype a stale-while-revalidate wrapper for the highest-traffic caches.
21. §6.9 — split `styles.css` into an ITCSS-ish structure before it grows further.
22. §5.8 — if more iframe-embed providers are ever added, move to `webRequest.onBeforeSendHeaders`
    header injection instead of more loopback HTTP servers.

Not recommended: adding GSAP (§6.11), adding video.js/hls.js to the current MegaPlay path (§2),
or reaching for list virtualization at the current 21-item Latest grid scale (§ — content-
visibility is already the right-sized tool; only revisit if the AniList library view grows into
the thousands of entries).
