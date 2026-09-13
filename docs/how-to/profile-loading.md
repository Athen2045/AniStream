# Profile desktop loading

Run these commands from the checkout in PowerShell:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:ANISTREAM_PERF = '1'
npm run dev
```

The main process prints `[AniStream perf]` records with a fixed IPC channel name,
elapsed milliseconds, and `ok` or `error`. Disable them by removing `ANISTREAM_PERF`
before the next launch. Packaged apps always disable this diagnostic, including
when the environment variable is set. Nothing is uploaded. Arguments, results,
URLs, titles, credentials, and error messages are excluded from these timing records.

`startup:ready-to-show` measures from main-module initialization, after static
imports, to Electron's first `ready-to-show` event. It excludes npm/Vite compilation
and does not measure time until all artwork or provider content appears. IPC
durations include application queuing, provider work and normalization, but exclude
renderer paint and image decoding. `ok` means the handler resolved; a normalized
unavailable result also counts as `ok`.

## Windows verification, 2026-09-09

Tested the current checkout through its own Electron executable and Vite server,
using the installed Windows UI driver. The existing development profile was used.
The standalone Home prototype and old installer were not used for this test.

| Live observation                                              |        Duration |
| ------------------------------------------------------------- | --------------: |
| Initial window ready                                          |          489 ms |
| Final build after restart, window ready                       |          480 ms |
| Initial anime browse IPC                                      |      823–852 ms |
| Initial latest anime IPC                                      |  1,137–1,151 ms |
| Initial latest manga IPC                                      |  2,218–2,219 ms |
| Background manga availability batch, before scheduling change |     11.2–11.4 s |
| Test anime episode catalog                                    |        2,304 ms |
| Test anime embed URL resolution                               | Rounded to 0 ms |

These are individual observations, including paired development-mode calls, not
statistical benchmarks or counts of outgoing HTTP requests. Existing main-process
deduplication can merge concurrent IPC calls. Startup variation is not evidence of
a startup speedup. Cached title, score and snapshot calls were observed resolving
in 0–2 ms during the session.

Native checks confirmed Anime/Manga navigation and artwork, restored member
presentation, loaded title metadata and scores, unmapped manga feedback, and a
mapped title with no English chapters. Re:ZERO Season 4 episode 1 played with
subtitles through the approved MegaPlay embed; returning to Episodes worked.
Normal playback checkpoint writes occurred in the development profile. This was
a short playback check, not episode completion or tracker reconciliation testing.
The manga examples did not provide readable English pages, so this session does
not establish live manga page throughput or decoded-image memory usage.

## Improvements verified with deterministic tests

- Title metadata and manga snapshots now start together. Each publishes when ready;
  the optional MAL score cannot hold the chapter list back. With 800 ms metadata,
  1,200 ms manga and 2,200 ms score fixtures, chapter readiness changed from
  3,000 ms to 1,200 ms (60% less waiting). This is a controlled scenario, not a
  promise that every live title loads 60% faster.
- Read shares the pending title work and waits for metadata needed to choose the
  correct next chapter, without waiting for the score. Tests cover errors, empty
  chapters, explicit retry, disposal and superseding language preferences.
- Media-detail, viewer and anime-player sessions can reactivate after React's
  development setup/cleanup replay. Before the fix, a successful metadata request
  left the native detail screen on loading placeholders. Old results are discarded
  after reactivation, including old authentication restoration results.
- Background availability checks use four workers per batch instead of enqueueing
  all 30 titles. Under the unchanged shared gate, a foreground request behind a
  simulated 30-title batch started after 1,001 ms instead of 7,007 ms. Result order
  is preserved. This does not guarantee a one-second wait under provider cooldowns
  or multiple different concurrent batches; overall background completion can take
  longer. The goal is responsive foreground work, not increased request throughput.

## Network and For You reliability, 2026-09-12

Provider request deadlines now start before the shared request gate. Time waiting
for a provider cooldown therefore counts toward the same deadline as the HTTP
request. This prevents a rate-limited queue from leaving a renderer field loading
indefinitely while preserving the existing throttles, cooldowns, cancellation and
in-flight deduplication.

AniList request starts are spaced by 350 ms as conservative local policy for its
separate burst limiter; `ANISTREAM_ANILIST_MIN_INTERVAL_MS` accepts a development
override from 100 through 10,000 ms. A zero remaining-budget header pauses the queue
before another request can produce an avoidable 429. The built preload converts
Electron's remote-method wrapper into a short wait-and-retry message; a native hidden
window verified the exact reported `anilist:browse` failure without provider traffic.

For You has a 12-second budget for its complete main-process provider sequence and
a 14-second renderer deadline for stalled IPC. Concurrent automatic and manual
refreshes share one request. A failed refresh keeps the previous cards and restores
the Refresh button with a plain-language rate-limit, timeout, or connectivity
message. Candidate pages use 20 items, so its trailing Trending query can share the
Home Trending cache/in-flight key instead of issuing the former distinct 30-item
request.

The same error wording is used for Search, catalog fields, and AniList library
refreshes. Provider diagnostics remain in the main-process log; users receive a
specific next action without internal resolver or transport text.

Windows verification covered a never-resolving For You request in the running
Electron renderer: it recovered within the deadline, retained its cards, and
accepted another refresh. A bounded live delivery audit also found Frieren episode
1 SUB available and playing to 17.3 seconds with readyState 4 and trusted progress
events. Exact-ID MangaDex lookup completed in 457 ms and truthfully reported no
English chapters for the selected Frieren manga. AniList returned HTTP 429 during
startup; AniStream observed the cooldown and remained responsive without aggressive
retries.

Final verification: 395 tests in 60 files and 19 focused Windows Electron
refresh/control checks pass; strict TypeScript and the Electron production build
pass; lint reports zero errors and the existing Kitsu console warning. The latest
development app is running from this checkout. No installer or release was produced.

## Remaining performance work

Measure reader-first delivery from `MangaTitleModule`: its combined snapshot still
waits for optional MangaBaka enrichment. A progressive response should preserve
enrichment and cancellation while making ready chapters available sooner. Also
profile first visible manga pages and decoded/GPU memory with a readable chapter.
The existing page caches, viewport queue, and lazy image decoding remain intact.

MegaPlay buffering is owned by the remote embed. Do not extract media URLs, loosen
frame checks, spoof referrers or increase provider quotas to improve these timings.

The four-worker limit is application scheduling policy, not a provider limit.
The [official documentation](https://api.mangadex.org/docs/) and its rate-limit page
could not be retrieved through the research browser on 2026-09-09. The indexed
[official documentation repository](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/8183ee874c44693dfd71a4f1a8dff7c93f18d76b/rate-limits.md)
was an older source, not verification of current quotas. No endpoint, credential,
rate, cooldown, identity mapping, or image-delivery contract was changed.
