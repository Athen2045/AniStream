# Check for AniStream updates

Open **Profile → App updates → Check for updates**. You do not need to connect AniList.

Packaged Windows x64 and Apple Silicon Mac builds check once in the background when the app starts. If a
newer stable release includes the installer for your platform, a notice links to its GitHub release
page. Dismissing the notice hides it for the current session; the Profile checker remains available.

Use **View release** to read the release notes and choose the download yourself. AniStream does
not download, install, restart, or replace itself. Before replacing the application, you can save
your local progress using [Local progress and backups](local-backups.md).

## Understand the result

- **Up to date** means a successful check found no newer compatible stable release.
- **Checking** means a request is in progress. Browsing, watching and reading remain available.
- A failed, timed-out, malformed, or rate-limited check reports that updates could not be checked.
  It does not mean your version is current.
- A release without the expected Windows installer or Mac DMG for your platform is reported as unavailable.
- Development builds and other platforms do not perform update checks or startup bookkeeping.

## Enable update checks for a release

There is no renderer setting or API key to turn on. The packaged main process enables checks only
for supported release targets (`win32/x64` and `darwin/arm64`). Publish a stable GitHub Release
with these exact asset names (or the asset for the platform you support):

- `AniStream Setup X.Y.Z.exe`
- `AniStream-X.Y.Z-arm64.dmg`

Use **Actions → Promote production release** after the version and `docs/releases/vX.Y.Z.md` are
merged to `main`. That workflow builds both artifacts from the same commit, verifies them, waits for
the protected production approval, and publishes the tag/release. Once public, the next installed
build checks GitHub automatically and the Profile button can check on demand.

The checker shares an in-flight request and waits at least a minute before making another one.
GitHub may require a longer wait. The displayed check/retry times distinguish the cached result
from a fresh request; repeated clicks do not bypass the wait. There are no automatic retries or
periodic checks during the session.

## If an updated version repeatedly fails to start

AniStream remembers the last version whose renderer loaded and remained healthy for eight seconds.
On the third attempt to start a different version after two unconfirmed attempts, it offers that
previous version's release page. This guidance takes priority over newer-release notices.

An incomplete startup does not prove that the app crashed: quitting early can produce the same
signal. Crashes after the stabilization window are not covered. The old release page may no longer
have a downloadable artifact. Recovery remains your choice; no app or database rollback occurs.
