# Update check & startup crash rollback guidance — design

Status: approved (2026-07-28)

## Purpose

AniStream is unsigned (no Apple Developer ID certificate — see CONTEXT.md), which rules out
`electron-updater`'s silent auto-install flow on macOS: Squirrel.Mac refuses to update an app that
isn't code-signed. This design covers the scope that's achievable without signing:

1. Tell the user a newer version exists, with a link to go get it themselves.
2. If a freshly-installed version crashes on startup, tell the user which version to go back to.

No silent download or install of any kind. The user always does the actual re-install by hand,
same as today.

## Non-goals

- Signed, silent, `quitAndInstall()`-style auto-update. Revisit only if the project enrolls in the
  Apple Developer Program.
- Detecting crashes that happen after a stable startup (mid-session crashes). Only crashes at/near
  launch are covered — see "Known limitation" below.
- Any UI for browsing update history beyond linking to the relevant GitHub Release page.

## Architecture

New main-process module, same shape as `src/main/anilist/`: a small deep module with one entry
point per concern.

```
src/main/update-check/
  index.ts           # re-exports below
  check-release.ts    checkLatestRelease(currentVersion, fetchImpl?) + compareVersions(a, b)
  launch-state.ts      nextLaunchState(persisted, currentVersion) — pure crash-loop state machine
  store.ts             readLaunchState(db) / writeLaunchState(db, state) — app_meta I/O wrapper
```

- `checkLatestRelease` calls `GET https://api.github.com/repos/Athen2045/AniStream/releases/latest`,
  compares `tag_name` (leading `v` stripped) against `currentVersion` via `compareVersions`, and
  returns `{ status: "up-to-date" }` or `{ status: "update-available", version, releaseUrl }`. Any
  network/parse failure is swallowed and treated as `up-to-date` (fail silent — this is a convenience
  feature, not something that should ever show an error state).
- `nextLaunchState` is the crash-loop state machine, pure and independently testable (no SQLite, no
  Electron APIs) — same reasoning as extracting `normalize.ts` out of the AniList client earlier.
- `store.ts` is the only piece that touches `anistream.sqlite`'s `app_meta` table. Two keys, namespaced
  to avoid collision with any future `app_meta` use:
  - `update_check_last_clean_version` — plain string, the last version that reached "stable."
  - `update_check_pending_attempts` — JSON `{ version: string, attempts: number }`.

## IPC contract

One new channel, `app:update-status`, handled once in `src/main/index.ts` and cached for the
session (computed once at startup, not re-queried per renderer call):

```ts
export type UpdateStatus =
  | { kind: "up-to-date" }
  | { kind: "update-available"; version: string; releaseUrl: string }
  | { kind: "crash-detected"; lastGoodVersion: string; lastGoodReleaseUrl: string };
```

Added to `src/shared/contracts.ts` (serializable, no Electron/Node imports, matching the existing
rule for that file) and to the `AniStreamBridge` interface / preload bridge as
`getUpdateStatus(): Promise<UpdateStatus>`, following the exact pattern `getAppInfo()` already uses.

## Data flow

**Startup sequence in `src/main/index.ts`, inside `app.whenReady()`, before `createWindow()`:**

1. Read persisted launch state via `store.readLaunchState(database)`.
2. Compute `nextLaunchState(persisted, app.getVersion())` → `{ report, nextPersisted }` where
   `report` is `"normal"` or `"crash-detected"`.
3. Persist `nextPersisted` immediately via `store.writeLaunchState`.
4. If `report === "crash-detected"`: cache
   `{ kind: "crash-detected", lastGoodVersion, lastGoodReleaseUrl }` as the session's update status
   and **skip the GitHub update check entirely** for this launch — crash guidance takes priority over
   "a new version exists," since in this scenario the new version is the _broken_ one.
5. Otherwise: call `checkLatestRelease(app.getVersion())` in the background (does not block
   `createWindow()`) and cache whichever result comes back as the session's update status.
6. ~8 seconds after `createWindow()`, if the process is still running, call
   `nextLaunchState`'s "mark stable" transition and persist it: `last_clean_version` becomes the
   current version, `pending_version_attempts` is cleared.

**`nextLaunchState` transition table:**

| Persisted state                                                                        | Current version                      | Transition                                                                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| No `last_clean_version` (fresh install)                                                | any                                  | Treat as first launch of this version: `pending = {version, attempts: 1}`, report `"normal"`        |
| `last_clean_version == current`                                                        | same                                 | Normal continued use of an already-stable version: report `"normal"`, no attempt bookkeeping needed |
| `last_clean_version != current`, `pending.version != current`                          | new                                  | First launch of a new version: `pending = {version: current, attempts: 1}`, report `"normal"`       |
| `last_clean_version != current`, `pending.version == current`, `pending.attempts < 2`  | new, seen once before                | `pending.attempts += 1`, report `"normal"` (give it one retry before flagging)                      |
| `last_clean_version != current`, `pending.version == current`, `pending.attempts >= 2` | new, seen 2+ times, never stabilized | Report `"crash-detected"` using the existing `last_clean_version` as the rollback target            |

Worked example: launch 1 of a new version sets `attempts: 1` (report `"normal"`). If it never
stabilizes, launch 2 bumps to `attempts: 2` (still `"normal"` — one free retry). If it _still_ never
stabilizes, launch 3 reports `"crash-detected"`. So a version needs to fail to stabilize on three
consecutive launches before the banner appears.

**Renderer:**

- `App.tsx` calls `window.anistream.getUpdateStatus()` once on mount (same pattern as
  `getAppInfo`/`getAniListAuthState`), stores the result in state.
- New `UpdateBanner.tsx` renders above the navbar when status is `update-available` or
  `crash-detected`; renders nothing for `up-to-date`. Styled like the existing `.error-banner`.
- The banner's action is a plain `<a href={releaseUrl} target="_blank" rel="noreferrer">` — reuses
  the same external-link pattern already used in `MediaDetailModal`'s external links section, which
  `src/main/index.ts`'s `setWindowOpenHandler` already permits (https-only) and routes through
  `shell.openExternal`. No new IPC method needed for "open the release page."
- Dismissing the banner is in-memory only (`useState`, no persistence) — reappears next launch,
  per the earlier decision.

**Banner copy:**

- `update-available`: "AniStream v{version} is available." → link labeled "View release"
  → `https://github.com/Athen2045/AniStream/releases/tag/v{version}`
- `crash-detected`: "AniStream crashed after updating to v{current} — v{lastGoodVersion} is
  available here." → link labeled "View v{lastGoodVersion}"
  → `https://github.com/Athen2045/AniStream/releases/tag/v{lastGoodVersion}`

## Error handling

- GitHub API unreachable / rate-limited / malformed JSON → `checkLatestRelease` catches internally,
  returns `up-to-date`. Never surfaces an error banner for this background convenience check.
- `app_meta` read/write failure → treated as absent state (equivalent to fresh install). Worst case
  is one extra "first launch of this version" cycle; never throws out of the startup sequence.
- `crash-detected` and `update-available` never both show in the same session — see step 4 above.

## Testing

All Vitest, matching existing `test/main/` conventions; no live network calls in the permanent suite.

- `compareVersions`: fixture table — equal, older, newer, `v`-prefixed vs bare, malformed strings.
- `checkLatestRelease`: injected fake `fetch` — newer available, already up to date, network error,
  non-2xx response, malformed JSON body.
- `nextLaunchState`: pure function, fixture per row of the transition table above — fresh install,
  continued normal use, first launch of new version, second failed launch (triggers crash-detected),
  successful stabilization after a prior crash-detected episode.

## Known limitation

Startup-crash detection only. A crash after the ~8-second "stable" mark (e.g., an hour into a
session) will not trigger rollback guidance — that needs persistent session-health tracking, which
is out of scope for this pass. Confirmed acceptable by the user for now.

The "positive confirmation" heuristic (mark stable after ~8s alive, rather than trying to catch the
crash itself) also means quitting the app manually within that window three launches in a row would
be indistinguishable from three real crashes, and would show the same banner. Considered an
acceptable false-positive rate for a single-user app — catching real crash loops without needing
fragile process-level crash-signal handling is worth this tradeoff.
