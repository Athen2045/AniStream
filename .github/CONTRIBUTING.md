# Contributing to AniStream

Thanks for your interest in AniStream. This is a one-person project, so contributions are welcome,
but please open an issue before starting large changes so we can agree on the approach first.

## Before you start

AniStream follows a few rules that decide what gets merged:

- **No ads**: The app shows no ads and blocks ads inside embedded players.
- **Privacy**: Personal data stays on the device. No telemetry, fingerprinting, or hidden
  identifiers.
- **No data selling**: Tracking that helps the user (history, progress, list sync,
  recommendations) is fine. Trackers that send data to outside parties are not.
- **User control**: Integrations stay optional and removable, and users can export their data.

Also:

- Never commit secrets, tokens, `.env` values, personal library data, or playback endpoints.
- Keep code, comments, docs, and UI copy neutral about playback sources ("the player",
  "the anime player").
- Match titles across providers by exact IDs only, never by title text.

## Development setup

You'll need [Node.js](https://nodejs.org/en/download) 22 or newer. Windows x64 is the primary
platform; Apple Silicon macOS is also supported.

```bash
git clone https://github.com/Athen2045/AniStream.git
cd AniStream
npm ci
cp .env.example .env
npm run dev
```

Discovery, lists, manga reading, and local progress work with the defaults.

- **Optional keys**: Add them to `.env`. Each variable is described in `.env.example`. Keys are
  read only by the main process and never reach the renderer.
- **Playback**: Endpoints are not part of this repository. Copy `providers.example.json` to
  `providers.local.json` (gitignored) and fill in endpoints you are permitted to use. Without it,
  the app runs normally and playback reports that it isn't configured.

## Branches

| Branch      | Purpose                                                       |
| ----------- | ------------------------------------------------------------- |
| `feature/*` | Your work. Branch from `develop`.                             |
| `develop`   | Integration branch. Every push builds a Windows preview.      |
| `main`      | Protected release branch. Only release merges from `develop`. |

## Making a change

1. Create a branch: `git switch -c feature/short-name develop`
2. Make your change and add or update tests.
3. Run the checks below.
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
   `docs:`, `refactor:`, `test:`, `chore:`, `ci:`.
5. Open a pull request against `develop` and fill in the template.

## Checks

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run check:product-slice
```

CI runs the same checks on every pull request, on Windows and macOS.

- For UI changes, run the app and try the change yourself. Passing checks don't prove a feature
  works.
- Add a focused test when you change a provider adapter, an IPC channel, stored data, or an error
  shown to the user.
- Tests use fixtures or an injected transport. Never call live services from automated tests.

## Code layout

| Path            | Owns                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `src/main/`     | Credentials, local database, provider traffic, and IPC handlers       |
| `src/preload/`  | The narrow, typed API the renderer is allowed to call                 |
| `src/renderer/` | React UI, navigation, and short-lived interaction state               |
| `src/shared/`   | Serializable contracts and validators only (no Electron or Node code) |
| `test/`         | Vitest suites and fixtures                                            |

Conventions:

- TypeScript strict mode. Avoid `any`, and validate remote data where it enters the app.
- React components use `PascalCase.tsx`, hooks use `useThing.ts`, other files use `kebab-case.ts`.
- Provider response types stay inside their adapter; the UI receives normalized values.
- Network calls need timeouts, cancellation, and bounded retries, and must stop on 429 and 403.

## Building installers

```bash
npm run package:win   # Windows x64 NSIS installer
npm run package:mac   # Apple Silicon DMG (run on a Mac)
```

Output goes to `dist/`. Both installers are unsigned. Building for Windows needs Visual Studio C++
build tools for the native SQLite module.

## Releases

Releases are made by the maintainer through GitHub Actions. Contributors don't need to bump
versions.

1. Bump the version in `package.json`, add `.github/releases/vX.Y.Z.md`, and add an entry to
   [CHANGELOG.md](../CHANGELOG.md) on `develop`.
2. Optionally run **Actions → Promote production release** from `develop` with **dry run** ticked
   to build and test both installers without publishing.
3. Merge `develop` into `main`.
4. Run **Promote production release** from `main` with the version. After approval, the workflow
   creates the `vX.Y.Z` tag and the GitHub Release with both installers and `SHA256SUMS.txt`.

Don't create release tags by hand; the workflow refuses a version whose tag already exists.

## Reporting bugs and security issues

- **Bugs and ideas**: use the [issue forms](https://github.com/Athen2045/AniStream/issues/new/choose).
- **Security problems**: report them privately as described in [SECURITY.md](SECURITY.md).
