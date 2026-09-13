# Use and verify the redesigned interface

The shared Windows/macOS renderer implements the approved Home and Profile direction: charcoal
surfaces, restrained green actions, bundled Plus Jakarta Sans, and consistent portrait covers.
Section headings use 700, titles and controls 600, body text 400, and small labels 500.

## Navigate and manage titles

Home features the first Trending title in a 280px band, followed by Continue, Trending, For You,
and Latest Updates. Continue resumes the saved episode or chapter; its information action opens
details. Heading arrows scroll one visible group and disable at the boundaries. Latest Updates
retains independent 21-item pages, with seven columns at 1440px and five at 960px.

Use Ctrl+K on Windows or Command+K on macOS to focus search. Suggestions start at two characters
after 250ms and contain up to four titles of each type. Arrow keys select a suggestion; Enter
opens it. View all results opens the dedicated Search view. All searches Anime and Manga with
separate pagination; selecting a type requests that type only. Query, genre, and sort changes
reset pagination. A failed category leaves the successful category available and offers Retry.

The bell shows four updates before scrolling. Opening it does not acknowledge updates; the
individual check action marks an update seen without changing progress. Refresh library updates
the connected AniList library. The avatar opens Profile or the existing sign-in guidance.

Profile combines media type, list, filter, sort, and Add title in one toolbar above a six-column
library at the default width. Add title reuses Search, restricted to the selected media type.
Plus adds to Planning; the check or pencil opens the centered editor. Failed saves retain the
draft, canceled removal keeps the editor open, and successful removal closes it. Backup and
application-update utilities are collapsed below the library.

Large title overlays put episodes or chapters before secondary information and restore focus
when dismissed. Player surroundings and reader controls share the theme. MegaPlay still owns
embedded playback controls; existing source validation, reader loading bounds, checkpoints,
provider caches, throttles, and exact-ID mappings remain in place.

## Implementation seams

- `ProfileView.tsx`, `LibraryCard.tsx`, and `EntryEditor.tsx` own extracted Profile presentation.
- `SearchView.tsx` and `search-session.ts` share typed search state, independent result groups,
  stale-response protection, and failed-page retry through the existing `browseAniList` bridge.
- `CatalogCard.tsx` shares details, playback/reading, and library actions. `App.tsx` coordinates
  navigation and the account-scoped editor. Search leaves Home unmounted to avoid duplicate reads.
- `styles/redesign.css` is loaded after the existing renderer styles. Detail, player, and reader
  modules remain lazily loaded. There is no new dependency, database migration, or remote service.

## Verification — 2026-09-11

The existing suite passes: **381 tests in 58 files**. Typecheck and production build pass. Lint
has zero errors and one existing development Kitsu logging warning. Focused tests cover search
pagination, stale responses, partial failures, failed-page retry, and detail state after editing.

A disposable native Windows Electron window passed **43 fixture assertions** against the built
renderer. Coverage includes both media types' six rail controls, the four-row notification panel,
long titles and missing artwork, populated/empty/guest libraries, add/save/remove failures,
canceled removal, focus restoration, Ctrl+K and suggestion selection/submission, independent
search pages, genre clearing, partial/stale/empty searches, chapter reading, Escape closing reader
settings before the reader, reduced motion, and 1440×900 / 960×640 geometry.

The local harness and screenshots are under the ignored `docs/superpowers/plans/` working notes:
`redesign-ui-fixture.mjs`, `redesign-electron-smoke.cjs`, and `redesign-verification/results.json`.
After building, run `node node_modules/electron/cli.js docs/superpowers/plans/redesign-electron-smoke.cjs`
from this checkout. The harness uses a temporary Electron profile and blocks all external requests;
its mutations affect synthetic fixtures only. Screenshot capture brings its test window forward.

The normal Windows development app was also launched from this checkout, with successful
main/preload/renderer startup and no logged startup errors. Existing installed binaries were not
updated. macOS traffic-light spacing was checked by switching the renderer's platform CSS in the
Windows fixture; **native macOS verification remains open**. Fixture coverage does not establish
live provider throughput, a complete MegaPlay episode, native macOS fullscreen behavior, or real
account mutation success. No installer was created or published for this redesign.

## Windowed playback and reading — 2026-09-12

Watch, Read, episode rows, and chapter rows now open below the navbar inside the current app
window. Anime uses the embedded player's own fullscreen button. The reader has an explicit Enter fullscreen / Exit fullscreen control.
Leaving fullscreen keeps the active episode or chapter open. The embedded player's own fullscreen
button remains available, and returning from it keeps the same iframe. Episodes/back returns to
the episode list; Close reader returns to chapters. Reader settings receive Escape first when open.
Previous/next chapter preserves an explicitly selected fullscreen mode.

The native Windows minimize, maximize/restore and close controls occupy a transparent overlay on
the navbar. Mac traffic lights use the same row with an explicit position. These remain native OS
controls, configured in `src/main/window-chrome.ts`; no extra window-control bridge is exposed.
The implementation follows Electron's [custom title-bar options](https://www.electronjs.org/docs/latest/api/base-window)
(checked 2026-09-12). Windows maximize and macOS fullscreen retain their native platform behavior.

The follow-up passed **21 native Windows window/media checks**, plus the existing **43 UI checks**
and **381 tests in 58 files**. Typecheck, production build, product guard and lint pass, with one
existing Kitsu logging warning. Native tests cover windowed defaults, both fullscreen paths,
iframe preservation, chapter navigation in fullscreen, Escape, 960px layout, and native
minimize/restore/maximize/unmaximize/close via Electron's window APIs. Caption placement was also
captured from the native test window. Mac-specific native rendering remains unverified.

Run `node node_modules/electron/cli.js docs/superpowers/plans/windowed-media-smoke.cjs` after building
to repeat the local check. Its report and screenshots are in
`docs/superpowers/plans/windowed-media-verification/`. It uses the actual window-chrome options,
a temporary user-data directory, a local iframe/page fixture, and blocks external requests. It
does not establish live MegaPlay delivery or full-episode completion. The refreshed Windows dev
app is running from this checkout; this follow-up did not build or publish an installer.

A live check of Re:Zero Season 4, episode 1 SUB reproduced provider error 233403 (HTTP 403 media request). The app keeps the provider controls visible with a compact error notice and manual Retry player action. This episode was not verified playing; details are in docs/research/megaplay-playback-2026-09-12.md.
