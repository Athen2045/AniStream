# Contributing to AniStream

Thanks for your interest in AniStream. This guide takes you from a fresh computer to a running
copy of the app, your first change, and, if you want it, your own fork that builds its own
installers. It assumes no prior Electron experience.

AniStream is a one-person project. Small fixes are welcome straight away; for anything larger,
please [open an issue](https://github.com/Athen2045/AniStream/issues/new/choose) first so we can
agree on the approach before you spend time on it.

**Contents**

1. [What you need](#1-what-you-need)
2. [Get the code running](#2-get-the-code-running)
3. [Optional keys and what they unlock](#3-optional-keys-and-what-they-unlock)
4. [Playback](#4-playback)
5. [How the code is organised](#5-how-the-code-is-organised)
6. [Make your first change](#6-make-your-first-change)
7. [Checks and tests](#7-checks-and-tests)
8. [Build an installer](#8-build-an-installer)
9. [Run your own fork](#9-run-your-own-fork)
10. [Troubleshooting](#10-troubleshooting)
11. [Project rules](#11-project-rules)
12. [Releases (maintainer)](#12-releases-maintainer)
13. [Reporting bugs and security issues](#13-reporting-bugs-and-security-issues)

---

## 1. What you need

| Tool                                                          | Why                                        | Check it with   |
| ------------------------------------------------------------- | ------------------------------------------ | --------------- |
| [Node.js](https://nodejs.org/en/download) 22+                 | Runs the build tools and installs packages | `node -v`       |
| [Git](https://git-scm.com/downloads)                          | Gets the code and tracks your changes      | `git --version` |
| A code editor, e.g. [VS Code](https://code.visualstudio.com/) | Editing, with TypeScript help              | –               |

Platforms: **Windows 10/11 x64** is the main platform; **Apple Silicon macOS** is also supported.

The app stores its data in SQLite through a native module (`better-sqlite3`). It normally
installs a ready-made copy for you. If installing fails while building it, you also need:

- **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  with the **Desktop development with C++** workload.
- **macOS**: the Xcode command-line tools (`xcode-select --install`).

## 2. Get the code running

### Step 1: Fork and clone

If you only want to try the code, you can clone this repository directly. If you plan to send
changes back, **fork** it first (the **Fork** button on GitHub), then clone your fork:

```bash
git clone https://github.com/<your-username>/AniStream.git
cd AniStream
git remote add upstream https://github.com/Athen2045/AniStream.git
```

`upstream` lets you pull in new changes later (see [step 6](#6-make-your-first-change)).

### Step 2: Install

```bash
npm ci
```

`npm ci` installs the exact package versions in `package-lock.json`, downloads Electron, and
prepares the SQLite module for it. The first run takes a few minutes.

### Step 3: Create your settings file

```bash
cp .env.example .env
```

On Windows PowerShell use `Copy-Item .env.example .env`. The defaults are enough to start; the
file is gitignored, so nothing you put in it is committed.

### Step 4: Keep your development data separate (recommended)

During development the app uses the same data folder as an installed AniStream on the same
computer, so a test run could change your real library, progress and sign-ins. Point development
runs at a folder of their own instead:

```bash
# macOS / Git Bash
export ANISTREAM_TEST_USER_DATA="$HOME/anistream-dev-profile"
```

```powershell
# Windows PowerShell
$env:ANISTREAM_TEST_USER_DATA = "$HOME\anistream-dev-profile"
```

This lasts for the current terminal window, so set it again in each new one. The folder sits
outside the project, so it is never committed; delete it whenever you want a fresh start.

### Step 5: Start the app

```bash
npm run dev
```

The AniStream window opens. Edits to the interface (`src/renderer`) appear straight away. Edits to
the main process or the bridge (`src/main`, `src/preload`) need a restart: press `Ctrl+C` in the
terminal and run `npm run dev` again.

Without any keys you can already browse anime and manga, keep lists and progress, read manga and
sign in to AniList. The next two sections switch on the rest.

## 3. Optional keys and what they unlock

Add these to `.env`, then restart `npm run dev`. Keys are read only by the main process and never
reach the window's code.

| Variable                      | Unlocks                                                 | Where to get it                                                                             |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ANISTREAM_TMDB_ACCESS_TOKEN` | The **More** section (movies and shows)                 | A free [TMDB](https://www.themoviedb.org/settings/api) account: the "API Read Access Token" |
| `ANISTREAM_MAL_CLIENT_ID`     | MyAnimeList scores, and a fallback when AniList is down | [MyAnimeList API config](https://myanimelist.net/apiconfig): create a client, copy its ID   |
| `ANISTREAM_MANGABAKA_TOKEN`   | Higher MangaBaka rate limits (works without it)         | Your MangaBaka account                                                                      |
| `MANGADEX_LANGUAGE`           | Default manga language: `en` or `ja`                    | –                                                                                           |

AniList sign-in needs no key: the app uses its own public sign-in client. Leave the `MANGADEX_*`
account fields empty; that sync is not finished yet.

Without a TMDB token, the More section says "Configure TMDB" instead of loading.

## 4. Playback

The code never contains streaming addresses. Video players are configured in a local file that
only you have:

1. Copy `providers.example.json` to `providers.local.json` (it's gitignored).
2. Replace the `.example` addresses with players you are permitted to use. Each entry's shape is
   shown in the example; the app checks every address is HTTPS when it starts.
3. Restart the app.

Without this file, everything else works and playback says it isn't configured. To switch anime
playback off quickly without deleting the file, set `ANISTREAM_ANIME_SOURCE_ENABLED=0` in `.env`.

## 5. How the code is organised

AniStream is an [Electron](https://www.electronjs.org/) app: a trusted **main process** (Node.js)
and a sandboxed **window** (React), joined by a small typed bridge.

| Path            | What lives here                                                                       |
| --------------- | ------------------------------------------------------------------------------------- |
| `src/main/`     | Everything trusted: the database, sign-ins, network requests, downloads, IPC handlers |
| `src/preload/`  | The bridge: the only functions the window may call (`window.anistream.*`)             |
| `src/renderer/` | The interface: React components, styles, navigation                                   |
| `src/shared/`   | Types and validators used by both sides (no Electron or Node code)                    |
| `test/`         | Unit tests (`test/main`, `test/renderer`) and UI tests (`test/ui`) with fixtures      |
| `scripts/`      | Build and verification helpers                                                        |

**How a feature travels**, for example "load my downloads":

1. The window calls `window.anistream.getDownloads()` (declared in `src/shared/contracts.ts`,
   exposed in `src/preload/index.ts`).
2. The call goes over an IPC channel named in `src/shared/ipc.ts`; its input is checked in
   `src/main/ipc-validation.ts`.
3. A handler in `src/main/domains/` does the work and returns plain data.

New features usually touch all three layers. Data from the internet is validated where it enters
the main process, and the interface only ever receives tidy, typed values.

Conventions:

- TypeScript strict mode. Avoid `any`.
- React components use `PascalCase.tsx`, hooks use `useThing.ts`, other files use `kebab-case.ts`.
- Network calls need timeouts, cancellation and limited retries, and stop on HTTP 429 and 403.
- Match titles across services by exact IDs only, never by comparing titles.

## 6. Make your first change

1. **Update and branch.** Work happens on `develop`:

   ```bash
   git fetch upstream
   git switch -c feature/short-name upstream/develop
   ```

2. **Make the change**, and add or update a test (see [section 7](#7-checks-and-tests)).
3. **Try it in the app** with `npm run dev`. Passing checks don't prove a feature works.
4. **Run the checks** in section 7.
5. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
   `docs:`, `refactor:`, `test:`, `chore:`, `ci:`. For example:

   ```bash
   git commit -m "fix: keep the chosen episode while the list loads"
   ```

6. **Push and open a pull request** against `develop`, and fill in the template:

   ```bash
   git push -u origin feature/short-name
   ```

| Branch      | Purpose                                                       |
| ----------- | ------------------------------------------------------------- |
| `feature/*` | Your work. Branch from `develop`.                             |
| `develop`   | Integration branch. Every push builds a Windows preview.      |
| `main`      | Protected release branch. Only release merges from `develop`. |

## 7. Checks and tests

Run these before you push. CI runs the same ones on Windows and macOS for every pull request.

| Command                       | What it checks                                                |
| ----------------------------- | ------------------------------------------------------------- |
| `npm run typecheck`           | TypeScript types across the main process and window           |
| `npm run lint`                | Code problems ESLint can spot (`npm run lint:fix` fixes many) |
| `npm run format:check`        | Formatting (`npm run format` fixes it)                        |
| `npm test`                    | Unit tests (Vitest); `npm run test:watch` re-runs as you edit |
| `npm run test:ui`             | Builds the app and drives the real window (Playwright)        |
| `npm run build`               | The production build                                          |
| `npm run check:product-slice` | That required parts of the app are still wired up             |

About tests:

- Add a focused test when you change a network adapter, an IPC channel, stored data, or an error
  message shown to people.
- Tests never call real services. They use fixtures (`test/ui/fixtures/`) or a fake `fetch`
  passed into the code under test. UI tests run on a throwaway profile, so they never touch your
  data.

## 8. Build an installer

```bash
npm run package:win   # Windows x64 installer (NSIS), run on Windows
npm run package:mac   # Apple Silicon DMG, run on a Mac
```

The installer appears in `dist/`. Installers are unsigned, so Windows SmartScreen and macOS
Gatekeeper will warn the first time they run.

What goes into an installer:

- `providers.local.json`, if you have one (section 4).
- The TMDB token and MyAnimeList ID from your `.env`, written to `app-keys.local.json` by
  `scripts/write-app-keys.mjs`, so the installed app works without its own `.env`. Only those two
  read-only keys are ever included.

## 9. Run your own fork

You can build and share your own version from a fork. A few things point at this project and are
worth changing so your copy behaves as its own app:

| What               | Where                                                                       | Why change it                                                    |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Update source      | `RELEASE_REPOSITORY` and `RELEASE_ENDPOINT` in `src/main/update-release.ts` | Otherwise your builds offer this project's releases as updates   |
| App identity       | `appId` and `productName` in `electron-builder.yml`                         | So your app installs beside the original instead of replacing it |
| Links in the app   | `src/renderer/src/App.tsx` (bug reports) and `src/renderer/src/legal.ts`    | So "Report a bug" and legal links go to your repository          |
| User-Agent contact | `src/main/update-check.ts`, `src/main/anime-tmdb-links.ts`                  | Services see who is calling                                      |

If you also change the `anistream://` link scheme (in `electron-builder.yml` under `protocols`),
AniList sign-in stops working until you register your own
[AniList API client](https://anilist.co/settings/developer) with your new redirect address and put
its ID in `ANILIST_CLIENT_ID` (`src/main/anilist/client.ts`).

**Building in GitHub Actions.** The workflows read three repository secrets (**Settings → Secrets
and variables → Actions**):

| Secret                        | Contents                                         |
| ----------------------------- | ------------------------------------------------ |
| `ANISTREAM_PROVIDERS_JSON`    | The full text of your `providers.local.json`     |
| `ANISTREAM_TMDB_ACCESS_TOKEN` | Your TMDB token (release builds fail without it) |
| `ANISTREAM_MAL_CLIENT_ID`     | Your MyAnimeList client ID                       |

Pushes to `develop` build a Windows preview (**Develop Windows preview**). The release workflow
publishes through a `production` environment; create one under **Settings → Environments** and
add yourself as a reviewer. The **Website** workflow is optional.

## 10. Troubleshooting

| Problem                                                       | Fix                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm ci` fails while building `better-sqlite3`                | Install the build tools from [section 1](#1-what-you-need), delete `node_modules`, run `npm ci` again               |
| `npm ci` hangs or fails downloading Electron                  | Check your connection or proxy, then run `npm ci` again                                                             |
| The app opens with your real library                          | Set `ANISTREAM_TEST_USER_DATA` ([step 4](#step-4-keep-your-development-data-separate-recommended)) in that terminal |
| More says "Configure TMDB"                                    | Add `ANISTREAM_TMDB_ACCESS_TOKEN` to `.env` and restart                                                             |
| Playback says it isn't configured                             | Expected without `providers.local.json` ([section 4](#4-playback))                                                  |
| A `.env` change does nothing                                  | Restart `npm run dev`; settings are read at start                                                                   |
| `npm run format:check` lists files you didn't touch (Windows) | Usually line endings: run `npm run format`                                                                          |
| `npm run test:ui` fails on a fresh clone                      | It builds first; run `npm run build` on its own to see the real error                                               |

Still stuck? Open an issue with what you ran, what you expected, and the error output.

## 11. Project rules

These decide what gets merged:

- **No ads**: the app shows no ads and blocks ads inside embedded players.
- **Privacy**: personal data stays on the device. No telemetry, fingerprinting or hidden
  identifiers.
- **No data selling**: tracking that helps the user (history, progress, list sync,
  recommendations) is fine. Trackers that send data to outside parties are not.
- **User control**: integrations stay optional and removable, and users can export their data.

Also:

- Never commit secrets, tokens, `.env` values, personal library data, or playback addresses.
- Keep code, comments, docs and interface text neutral about playback sources ("the player",
  "the anime player"); never name them.

## 12. Releases (maintainer)

Releases are made by the maintainer through GitHub Actions. Contributors don't need to bump
versions.

1. Bump the version in `package.json`, add `.github/releases/vX.Y.Z.md`, and add an entry to
   [CHANGELOG.md](../CHANGELOG.md) on `develop`. `npm run check:release-version X.Y.Z` confirms
   they match.
2. Optionally run **Actions → Promote production release** from `develop` with **dry run** ticked
   to build and test both installers without publishing.
3. Merge `develop` into `main`.
4. Run **Promote production release** from `main` with the version. After approval, the workflow
   creates the `vX.Y.Z` tag and the GitHub Release with both installers and `SHA256SUMS.txt`.

Don't create release tags by hand; the workflow refuses a version whose tag already exists.

## 13. Reporting bugs and security issues

- **Bugs and ideas**: use the [issue forms](https://github.com/Athen2045/AniStream/issues/new/choose).
- **Security problems**: report them privately as described in [SECURITY.md](SECURITY.md).
