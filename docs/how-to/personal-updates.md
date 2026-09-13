# Continue and personal updates

Continue Watching and Continue Reading use the same portrait horizontal layout as Trending.
Select Watch or Read to continue the saved title, or Info to open its details. Continue, Trending,
and For You expose left/right arrows whenever content extends beyond the visible rail. Focus the
rail and use the arrow keys for keyboard navigation; reduced motion is respected.

The navbar bell, between Search and Refresh, combines anime airing updates and manga chapter
availability. It uses the unread icon while updates remain. Click it to see four rows, then scroll
for more. Select a title to open its details. The check button marks just that update as seen;
it does not change watch/read progress. Escape returns focus to the bell; clicking outside closes it.

## Automatic refresh

Checks run while the app is visible, using a 30-minute freshness window. Returning to the app checks
whether cached results are due for refresh. Opening the bell reuses fresh results; its Refresh button
has a 60-second minimum between provider checks. Main-process caches and provider cooldowns still
apply. Progress events update the local view after a short debounce and do not repeat remote checks
unless the relevant title candidates change. Manga preference changes invalidate manga availability.

Continue and the bell share one session across Anime/Manga navigation. Requests already in progress
are reused. Failed checks preserve usable results and display a warning. An aired episode notice is
metadata, not confirmation that the playback source has that episode.

## Verification

Verified on 2026-09-09 in the Windows Electron dev app: both portrait Continue layouts, a working
Continue Watching arrow with eight real titles, visible Trending arrows, correct navbar placement,
and the notification dropdown's empty state.

The current production renderer was also exercised with a local synthetic bridge: all six rail
arrows moved their horizontal viewport; 24 notifications produced a 320px viewport of four 80px
rows and scrolled to later entries. Mark-as-seen reduced the count, preserved Continue progress,
remained saved after reload, and switched to the read icon when empty. Escape restored bell focus;
outside clicks dismissed the panel. Fixtures did not access providers or change the personal library.

The full suite passes 374 tests across 57 files. Strict TypeScript and the production build pass.
Lint reports no errors and one existing Kitsu console warning. Native Mac testing and installer
rebuilding were not performed for this UI change; both platforms use the shared renderer.
