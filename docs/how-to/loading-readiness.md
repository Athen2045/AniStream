# Loading readiness

AniStream uses one renderer loading surface at application launch and while opening Profile. The
screen uses the bundled `chromevt-vtuber.gif` on the same near-black background as the application.
Its progress bar reports completed work; a timer never advances the percentage or marks a provider
healthy.

## Launch checks

Launch starts four checks together:

| Check           | Weight | Completion evidence                                                                                   |
| --------------- | -----: | ----------------------------------------------------------------------------------------------------- |
| Local data      |    15% | The typed app-info call reports that the database opened.                                             |
| Saved session   |    25% | The existing viewer session finishes restoring AniList state and cached profile data.                 |
| AniList catalog |    40% | The exact Anime Trending page used by Home settles through the shared AniList cache and request gate. |
| Anime playback  |    20% | Anikoto's cached recent index returns a valid readiness response.                                     |

The Anikoto check reuses its 15-minute recent-index cache and existing provider queue. It does not
open MegaPlay, start a video, crawl the catalog, or retry automatically. A disabled Anikoto adapter
is reported as disabled and does not block launch.

## Profile checks

Profile checks account state, matching cached profile data, and the current AniList library. It uses
the existing viewer-session refresh rather than issuing a second dashboard request. The current
Anime/Manga selection, list, local filter, and sort remain mounted behind the loading layer. A signed-
out user enters the existing connection view without a library request.

If a refresh fails after a verified dashboard was restored, **Use saved profile** opens that data.
Retry reruns only the failed check. Repeated activation while a check is running shares the active
readiness session.

## Failure behavior

- A required provider outage shows an apology, names the provider, and offers Retry.
- A temporary rate limit keeps its wait-and-retry wording instead of being described as a general
  outage.
- An optional Anikoto outage offers Retry and Continue browsing because discovery, lists, and manga
  do not depend on anime playback.
- A connectivity/DNS failure shows the reserved offline state and Retry. Offline mode is intentionally
  not implemented in this iteration.
- A local database/preload failure gives restart guidance and does not blame a remote provider.

Raw Electron IPC wrappers, HTTP response bodies, filesystem paths, and provider payloads are not
rendered on the loading screen.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. The renderer build must
contain one fingerprinted `chromevt-vtuber-*.gif` asset of about 119.5 KB. Provider-state tests use
injected responses and must not generate repeated live traffic.

For a Windows smoke check, launch `npm run dev` and verify the launch screen, then open Profile from
the navbar. Confirm the bar only jumps when a check completes, the destination does not replace the
current screen early, the GIF remains centered at 1440×900 and 960×640, and keyboard focus reaches
the Profile heading after a successful transition. Native macOS behavior remains a separate check;
macOS honors reduced motion while Windows retains the application motion policy.
