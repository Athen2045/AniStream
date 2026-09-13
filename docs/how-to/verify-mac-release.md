# Verify an Apple Silicon release candidate

Use a Mac and the exact checkout that produced the candidate. A successful build or package check
does not establish that playback, account sync, or installation works. Record those results separately.

## Check the package

From the repository root:

```bash
npm ci
npm test
npm run package:mac
npm run check:mac-package
```

The last command checks the default `dist/mac-arm64/AniStream.app` and
`dist/AniStream-X.Y.Z-arm64.dmg`, with X.Y.Z from package.json. Explicit paths are supported:

```bash
npm run check:mac-package -- "/path/to/AniStream.app" "/path/to/AniStream-X.Y.Z-arm64.dmg"
```

The checker compares every main, preload, renderer and lazy-chunk file in the archive to `out/`,
checks package/bundle identity and the OAuth URL scheme, rejects known local environment/data/key
file extensions outside dependencies, checks the unpacked SQLite binary, and requires arm64 for
the app executable, Electron Framework and SQLite. It also runs the sandboxed CommonJS preload guard.
It verifies the DMG, mounts it read-only without opening Finder, repeats checks on its app, compares
the archive and those three native binaries with the unpacked candidate, then detaches the volume.

Run it after a fresh package build. Comparing with a different checkout or stale `out/` is not useful.
This detects known packaging mistakes; it is not an exhaustive scan for secret strings or a signature
verification. It does not launch the app, alter its library, remove quarantine, or install anything.

Record the JSON result, including the build digest and DMG SHA-256, in the candidate's validation
notes. `signing` and `nativeInteraction` are explicitly **not assessed** by this command. Both Mac
packaging workflows run the gate before uploading their artifacts. A failure prevents that upload.

If attachment times out, the checker leaves the temporary mount path and prints it. Inspect
`hdiutil info`, detach that exact volume if present, then remove only its empty temporary directory.
If detachment fails, resolve it before deleting the mount directory.

## Exercise the actual app

Use a separate macOS test user for fresh-profile tests. Keep your normal library intact; make an
export through **Profile → Local progress and backups** before testing a replacement app.

| Area             | Exercise                                                                                                                                                                           | Record as passed only when                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup          | Copy from the verified DMG and launch normally. Quit and reopen. Close the window, then reopen it from the Dock.                                                                   | The app paints, the preload works, and window recreation preserves the session.                                                                               |
| Updates          | Open Profile → App updates; repeat a check during its displayed cooldown. Disconnect networking for a later check, then reconnect and retry after the deadline.                    | Version and timestamps are truthful; failures never claim up-to-date; cooldown cannot be bypassed.                                                            |
| Update notice    | Test a candidate older than a real compatible published release. Dismiss, navigate, then reopen Profile.                                                                           | The link names the verified release, navigation works, and dismissal does not remove Profile access. Do not publish a dummy release for testing.              |
| Startup recovery | In the separate test user, run a previous stable version for over eight seconds. Replace it with a different candidate, quit twice before eight seconds, then launch a third time. | Guidance names the previous version, pauses update checks for that launch, and makes no automatic rollback. After a healthy run and restart, recovery clears. |
| Embedded startup | Open playback within eight seconds of the renderer loading, then allow the app to remain open.                                                                                     | Embedded navigation does not cause false incomplete-startup guidance on subsequent launches.                                                                  |
| Playback         | Watch representative sub and dub episodes through completion; exit partway through another, then resume.                                                                           | Episode/time checkpoints, completion, next episode and return-to-episodes work. Exact seeking remains provider-owned.                                         |
| Tracker          | With a deliberately connected test AniList account, finish an episode offline, reconnect, and retry sync.                                                                          | Local completion survives; the correct account advances without duplication.                                                                                  |
| Backups          | Export; cancel both dialogs; test overwrite; restore to a fresh test profile and resume watching/reading. Repeat the restore.                                                      | Counts match, existing progress survives, repeats add nothing, and imported activity does not write to AniList.                                               |
| Reading          | Read a long chapter, change width/fit, advance/backtrack, restart, and change image quality for the next chapter.                                                                  | Position and preferences persist; images reload correctly; recorded process memory remains usable.                                                            |
| Discovery/layout | Use a real history of five or more titles; dismiss a recommendation and restart. Test Latest grids at 1440px and 960px.                                                            | Exact-title navigation and feedback persist; pagination refreshes only its field; controls remain reachable.                                                  |
| OAuth            | Complete browser approval and return to the app, then cancel a separate attempt.                                                                                                   | The normal browser callback works and no credentials appear in app logs or validation notes.                                                                  |

For each row record the candidate version, DMG hash, macOS version, result, and a concise failure
description. Leave unexercised rows **not tested**. A fixture result does not substitute for these rows.

## Verify signing when a signed candidate exists

The current packaging workflow deliberately produces unsigned builds. Once a valid Developer ID
Application identity and notarization are configured, verify the actual distributed candidate:

```bash
codesign --verify --deep --strict --verbose=2 "/path/to/AniStream.app"
spctl --assess --type execute --verbose=2 "/path/to/AniStream.app"
xcrun stapler validate "/path/to/AniStream-X.Y.Z-arm64.dmg"
```

Keep these results separate from the integrity check. Apple's
[code-signing verification guidance](https://developer.apple.com/library/technotes/tn2206/) and
[notarization documentation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
describe the trust checks. Do not mark an unsigned candidate signed or notarized because its archive
and disk image checks pass.
