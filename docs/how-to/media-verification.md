# Playback and reader verification

Windows audit, updated 2026-09-13. Changes apply to the shared macOS/Windows renderer.

## Fixed

- Reader resume restoration could be canceled during development cleanup or a resume refresh. It now applies the saved position in the layout phase, before initial scroll notifications can replace the checkpoint.
- A downloaded image that could not decode previously remained a broken image without a retry action. It now releases its Blob URL and presents Retry page. An error from an older image cannot remove its replacement.
- Resuming deep into a chapter previously queued the first two pages before the pages around the checkpoint. It now starts near the checkpoint. The 120-page development fixture requested five nearby pages plus one explicit retry, without loading pages 1 and 2.
- A failed initial chapter feed previously remained as an indefinite skeleton. It now becomes a recoverable chapter state; retry reloads MangaDex chapter data without reloading AniList title metadata.
- Playback source resolution, episode catalog, chapter feed, empty chapter language, individual page delivery, and AniList profile failures now show recovery guidance without exposing IPC, GraphQL, HTTP-route, or embed error codes.
- Manga request cancellation no longer reads `Event.currentTarget`. Electron could clear that property and raise an uncaught main-process TypeError when a title request was replaced or closed. Cancellation now captures the originating signal and preserves its abort reason safely.

## Verification

All 407 tests in 60 files, strict TypeScript, and the production build pass. Lint has no errors and one existing Kitsu console warning. Native Windows fixtures cover 21 window/media interactions, nine provider-failure/recovery interactions, and five development reader regressions. The surrounding redesign fixture covers 43 interactions.

The development reader test reproduced the resume failure before the fix and verifies saved position, actual browser image decode failure, manual recovery, and bounded page requests. It uses synthetic data, React StrictMode, and blocks remote provider requests. The production fixture verifies embedded-player fullscreen, Escape, windowed defaults, chapter navigation, 960px layout, and native caption actions.

Live checks used production adapters in the main process and synthetic account/persistence data:

| Check                                        | Observation                                                                                                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frieren anime, AniList 154587, episode 1 SUB | Approved AniList embed route played through 20.7 seconds, with trusted time/watching-log messages.                                                                                            |
| Frieren manga, AniList 118586                | Exact MangaDex mapping; no readable English chapters returned.                                                                                                                                |
| Yotsuba&!, AniList 30104, chapter 1          | Exact MangaDex mapping with 131 chapters. Two data-saver pages decoded at 1080 × 1535 in the app reader.                                                                                      |
| Yotsuba page delivery                        | Final sample: two pages, 126,059 bytes total, 286 ms; repeated first-page read returned from cache in under 1 ms. Earlier sample was 645 ms. These are observations, not a speedup benchmark. |

The live renderer was limited to the two fetched manga pages. It does not verify an entire chapter, episode completion, AniList reconciliation, or native macOS. Screenshot capture raised Electron `UnknownVizError` after the successful playback/page observations; those reports retain the failure instead of claiming full harness completion. No media URLs were extracted, no source was changed, and no personal progress was modified. The earlier Re:Zero Season 4 episode 1 SUB error 233403 remains a separate unresolved provider observation.

## Repeat local checks

After `npm run build`, run the local working harnesses individually:

```powershell
node node_modules/electron/cli.js docs/superpowers/plans/windowed-media-smoke.cjs
node node_modules/electron/cli.js docs/superpowers/plans/reader-regression-smoke.cjs
node node_modules/electron/cli.js docs/superpowers/plans/provider-error-smoke.cjs
node node_modules/electron/cli.js docs/superpowers/plans/electron-abort-smoke.cjs
node node_modules/electron/cli.js docs/superpowers/plans/redesign-electron-smoke.cjs
```

The development reader harness starts disposable Vite and fixture servers on loopback ports 5191 and 5190. Working harnesses and JSON evidence remain in the repository's gitignored agent-notes folder.

## Next areas to measure

Ready manga chapters still wait on optional title enrichment in the combined snapshot. Measure and separate that work while retaining cancellation and exact-ID mapping. Also measure decoded/GPU image memory across long chapters with varied page ratios; retained Blob byte limits alone do not measure decoded memory. Extended SUB/DUB playback, completion, and native Mac checks remain separate verification tasks.
