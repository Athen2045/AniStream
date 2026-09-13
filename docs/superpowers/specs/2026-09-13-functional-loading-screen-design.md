# Functional loading screen design

**Date:** 2026-09-13
**Status:** Approved for planning

## Goal

Add a branded loading surface at application launch and while opening Profile. The surface must
report real readiness work rather than advance on a decorative timer. It uses the user-supplied
`chromevt-vtuber.gif`, a functional progress bar, and AniStream's Windows near-black background.
The same renderer implementation serves Windows and macOS, while retaining the established
platform reduced-motion policy.

## Chosen approach

Use one renderer overlay backed by a small readiness session. It coordinates existing startup,
viewer, catalog, and provider operations and publishes a normalized snapshot to React. Existing
main-process caches, request deduplication, throttles, cooldowns, and timeouts remain authoritative.
The loading flow must not run an independent polling loop or bypass a provider queue.

The alternatives were rejected:

- A second native splash window would duplicate lifecycle and accessibility state across two
  BrowserWindows and complicate focus handoff.
- A timed progress animation would misrepresent readiness and could hide a stalled or failed task.

## Presentation

`ReadinessScreen` is a fixed, full-window renderer layer above the application shell. It uses the
active Windows ink token (`#070807`) and the shared semantic ink token on macOS. The supplied GIF is
bundled under renderer assets and displayed in the center without remote loading. Inspection of the
source confirms a transparent corner pixel, so the artwork can sit directly on the black surface
without a light rectangular frame.

Below the GIF, the screen shows:

1. A concise current step such as `Preparing your library` or `Checking playback availability`.
2. A determinate progress element with `aria-valuemin`, `aria-valuemax`, and the real weighted value.
3. A percentage and compact list of completed, active, and failed checks for assistive technology.

Progress changes animate monotonically during one attempt. A step contributes its assigned weight
only when it completes. Concurrent steps may finish in either order, but the displayed percentage
never moves backward. The screen may remain visible briefly after reaching 100% to avoid a single-
frame flash, but no timer may advance the bar or declare a check successful.

The successful screen fades away and restores focus to the intended destination. Windows keeps
motion enabled under the existing policy. macOS honors reduced motion and removes the fade/animated
bar transition while preserving the same readiness behavior.

## Launch readiness flow

The application shell mounts behind the overlay so its established sessions can perform their real
work. It is inert and hidden from assistive technology until readiness resolves.

Launch uses four weighted stages:

| Stage | Weight | Evidence |
| --- | ---: | --- |
| Local runtime | 15% | `getAppInfo()` confirms the typed preload bridge and opened database. |
| Saved session | 25% | The existing viewer session finishes auth restoration and cached-dashboard lookup. |
| AniList catalog | 40% | The initial Anime Trending request settles through the existing AniList client/cache. |
| Playback service | 20% | A new bounded Anikoto readiness operation validates its cached recent index through the existing Anikoto queue. |

The Anikoto readiness call reuses the adapter's fifteen-minute recent-index cache. It does not probe
MegaPlay, create an iframe, start playback, crawl catalog pages, or retry automatically. When the
Anikoto kill switch is disabled, the stage reports `disabled` rather than pretending the provider is
healthy.

Signed-out users still complete session restoration normally. A valid cached AniList catalog may
satisfy the catalog stage while a background refresh remains governed by the current cache policy.

## Profile readiness flow

Opening Profile raises the same overlay without unmounting the navbar. Its weighted stages are:

| Stage | Weight | Evidence |
| --- | ---: | --- |
| Account state | 30% | The viewer session has resolved signed-in, signed-out, or actionable auth error state. |
| Saved profile | 30% | A matching cached dashboard is available, or the user is confirmed signed out. |
| Current library | 40% | The existing dashboard refresh settles through AniList cache/deduplication. |

Profile navigation retains the selected media type, list, filter, and sort state. A cached dashboard
can render after readiness even when the live refresh fails; the failure is still reported honestly.
Repeated Profile clicks share the viewer session's active request and do not create parallel refreshes.

## Result and failure model

Readiness produces one of these outcomes:

- `ready`: required work completed; enter the requested route.
- `degraded`: an optional capability such as Anikoto is unavailable; show the apology and allow
  `Continue browsing` because discovery, library, and manga remain usable.
- `provider-error`: AniList or another required provider responded but could not serve the request.
  Show: `Sorry, AniStream can't reach <provider> right now. We're working on the issue. Please try
  again later.` Include `Retry` and, when cached data is safe, `Use saved data`.
- `offline`: requests failed for network/DNS/connectivity reasons and the runtime reports no usable
  connection. Show a clear offline message and `Retry`. The state and action boundary are retained
  for the later offline-mode project; this iteration does not implement or imitate offline mode.
- `local-error`: database or preload readiness failed. Explain that AniStream could not finish
  opening local data and provide restart guidance rather than blaming a provider.

Rate limits retain their current cooldown wording and must not be labelled as a general outage.
Timeouts name the affected provider and offer Retry. An expired AniList session routes to Profile
sign-in guidance. Raw HTTP codes, GraphQL payloads, Electron IPC wrappers, filesystem paths, and
provider response bodies never appear in this surface.

Retries rerun only failed or incomplete stages. Successful stages remain complete, cached provider
work remains cached, and a retry cannot create overlapping requests.

## State boundaries

- `startup-readiness.ts` in the renderer owns weighted progress, attempts, stale-result rejection,
  and normalized outcomes.
- `ReadinessScreen.tsx` owns presentation, accessibility, retry actions, and transition behavior.
- The existing viewer and catalog sessions remain the source of auth/dashboard/catalog truth.
- A narrow shared `ProviderReadiness` contract and validated IPC channel expose Anikoto's bounded
  availability result. The main-process adapter owns the actual request and error classification.
- App route state decides whether the shell is inert and when Profile readiness begins. It does not
  contain provider-specific parsing.

Closing the app cancels renderer work through normal teardown. Results from an earlier attempt or
route are ignored by generation ID. The loading layer never receives credentials, cookies, raw
provider data, or unrestricted network access.

## Verification

Add focused tests for:

- weighted progress and monotonic publication when stages finish out of order;
- startup success for signed-in and signed-out users;
- cached AniList success with a failed background refresh;
- Anikoto disabled, unavailable, timeout, rate limit, and malformed response;
- network failures classified as `offline` rather than provider outages;
- provider failures using the approved apology and scoped Retry;
- retry deduplication and stale-attempt rejection;
- Profile state retention and focus restoration;
- reduced-motion behavior on macOS and enforced motion on Windows;
- the bundled GIF being present in the production renderer output.

Run the full Vitest suite, typecheck, lint, production build, and a Windows Electron fixture covering
launch, Profile navigation, offline, provider outage, Retry, cached-data continuation, keyboard
focus, and 1440×900 / 960×640 layouts. Native macOS verification remains a separate Mac-host task.

## Acceptance criteria

- Launch and Profile navigation display the centered supplied animation and real progress bar.
- Every percentage increase corresponds to completed readiness work.
- No readiness check bypasses provider caching, pacing, timeout, or cooldown rules.
- AniList and Anikoto failures receive distinct, friendly guidance without exposing internals.
- Anikoto failure does not disable browsing, library management, or manga.
- Connectivity failures enter the reserved offline result without claiming offline mode exists yet.
- Retry is scoped, deduplicated, and cannot regress completed progress.
- The underlying shell cannot be focused or announced while the blocking loading state is active.
