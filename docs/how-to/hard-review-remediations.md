# Hard-review remediation guide

This guide is for maintainers preparing AniStream for a local development build or an unsigned
release artifact. It documents the fixes from the 2026-08-11 hard review and the checks that prove
the fixes are still present.

## Before changing code

Use Node.js 22 and npm. The repository uses `package-lock.json`; `.npmrc` records the peer-dependency
policy required by the lockfile, so a clean checkout should use `npm ci` rather than a hand-edited
`node_modules` tree.

```powershell
npm ci
```

Do not copy local `.env` files, session files, SQLite databases, or packaged output into the repo.
AniList credentials and tokens belong to the main process and the platform credential store, never
to renderer code or GitHub artifacts.

## 1. Startup and IPC ordering

`src/main/index.ts` starts the renderer server and database concurrently, but it does not create a
`BrowserWindow` until the renderer origin is available, SQLite has opened, and all typed IPC domain
handlers have been registered. This closes the startup race where a fast renderer could invoke a
preload method before its `ipcMain.handle` existed.

Startup is wrapped in one rejection path. A renderer/database failure is logged, shown as a native
error dialog when Electron is ready, and followed by a clean quit instead of leaving a half-open app.

When adding a new IPC domain, register it before `createWindow(rendererUrl)`, keep its argument
validation at the trusted boundary, and make startup failures reject rather than silently logging
and continuing.

## 2. Logout must be transactional from the user’s point of view

The renderer clears its visible session immediately so the UI feels responsive, then asks the main
process to delete the stored AniList session. If that IPC call fails, the renderer restores the
previous auth/dashboard state and shows the actual error. This prevents a misleading signed-out UI
while a token is still stored.

The regression test is in `test/renderer/viewer-session.test.ts`. If logout persistence changes,
keep tests for both successful logout and credential-store failure.

## 3. Hero image resilience

Catalog heroes prefer a wide banner, then retry with the cover URL when the banner fails. If both
URLs fail, a stable gradient placeholder preserves the hero geometry and prevents a broken image
from changing the page layout. Keep hero images eager/high-priority and keep rail artwork lazy.

If a provider adds another image source, keep the fallback local to `CatalogView` and do not expose
provider response objects to the rest of the renderer.

## 4. Release workflow permissions

The Windows and macOS package jobs now have `contents: read`. Each workflow uploads its build as an
artifact, and a separate tag-only release job downloads that artifact with `contents: write` before
calling `softprops/action-gh-release`. This keeps release mutation permission away from build,
test, and packaging steps.

Run the workflow manually first. For a tag, confirm the release job is the only job with write
permission and that the attached files came from the successful package job.

## 5. Verification checklist

Run the structural checks from a clean dependency install:

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test -- --run
npm run build
npm run check:product-slice
npm run check:anilist-oauth
npm run check:packaged-preload -- dist/win-unpacked/resources/app.asar
```

For a release review, also run `npm audit --omit=dev --json`. If the npm advisory service is
unreachable, record that the audit is unavailable instead of treating a failed network request as
a clean result.

## 6. Security review after implementation

Review the diff for secrets and verify that searches only return expected variable names or test
fixtures—not actual credentials:

```powershell
rg -n -i "client_secret|access_token|refresh_token|password|api[_-]?key|secret" src .github scripts package.json README.md --glob '!*.lock'
rg -n "dangerouslySetInnerHTML|eval\(|new Function|nodeIntegration|contextIsolation|sandbox|webviewTag|allowRunningInsecureContent|setWindowOpenHandler|will-navigate" src
git diff --check
```

The Electron security baseline remains `contextIsolation: true`, `nodeIntegration: false`, renderer
sandboxing, a narrow preload bridge, origin-validated IPC, and denied untrusted windows/navigation.

## Why these choices

Electron’s BrowserWindow lifecycle and IPC documentation support waiting for app readiness and
registering handlers before renderer calls. npm’s `ci` contract requires a lockfile-consistent
install, and GitHub recommends least-privilege workflow permissions. See the primary references:

- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron ipcMain](https://www.electronjs.org/docs/latest/api/ipc-main)
- [npm ci](https://docs.npmjs.com/cli/v8/commands/npm-ci/)
- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)
