# How to ship an AniStream update

AniStream now uses a two-stage release flow: `develop` creates a testable Windows preview, and a
manually promoted `main` release creates the macOS DMG, Windows installer, tag, and GitHub Release.

## 1. Test new work on `develop`

Push the feature branch into `develop`:

```bash
git push origin develop
```

The **Develop Windows preview** workflow runs the checks and creates an artifact named after the
commit SHA. Download it from the workflow run, install it on the test machine, and exercise the
changed feature. Preview installers are not GitHub Releases and expire after 14 days.

## 2. Merge into protected `main`

Open a pull request from `develop` to `main`. Merge only after CI passes and the change has been
reviewed. Keep the package version unchanged for ordinary development work.

## 3. Prepare a release commit

On the branch that will merge into `main`:

1. Bump `package.json` and `package-lock.json` to the new version.
2. Add `docs/releases/vX.Y.Z.md`.
3. Run the local checks and merge the pull request into `main`.

The release workflow refuses a version mismatch, missing release notes, reused tag, or version that
is not newer than the latest tag.

## 4. Promote the release

In GitHub, open **Actions → Promote production release → Run workflow**, choose `main`, and enter
the exact package version, such as `0.1.4`.

The workflow then:

1. Validates the version and release notes.
2. Runs the complete source checks and production build.
3. Builds Windows and macOS packages from the same `main` commit.
4. Verifies both packaged outputs, including host native binaries and the Windows installer lifecycle.
5. Pauses at the protected `production` environment for approval.
6. Creates `vX.Y.Z` and publishes the release from the already-built artifacts. The exact installer
   filenames are what the in-app update checker uses to identify compatible releases.

## Repository settings to configure once

- Protect `main`; block direct pushes and force pushes.
- Require pull requests, at least one approval, conversation resolution, and the CI checks.
- Enable “Require branches to be up to date” for the required checks.
- Create a `production` environment with required reviewers.
- Restrict the production environment to `main` and version tags.
- Keep signing secrets out of ordinary CI; add them only to the production environment when signing
  is ready.

Do not approve a production run until the development installer has been tested. Passing automation
is necessary, but it does not replace a short manual smoke test of the changed user experience.

The platform package workflows are build/verify/upload jobs and do not run again when the production
workflow creates the release tag. They can be dispatched manually; the Mac job also runs on `develop`
when packaging or icon inputs change. Neither workflow publishes releases, which avoids duplicate
release builds and asset uploads. For Apple Silicon candidates, the Mac package job runs
`npm run check:mac-package` before uploading. Follow
[Verify an Apple Silicon release candidate](verify-mac-release.md) for the exact package checks,
native interaction matrix, and separate signing/notarization verification.
