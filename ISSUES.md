# AniStream issue board

This file is a lightweight starting point for users and contributors. It is not a substitute for
the project’s GitHub Issues page, but it makes the current work visible while the project is still
in preview.

## Report a bug

Before opening a report:

1. Check the [latest release](https://github.com/Athen2045/AniStream/releases).
2. Search existing [GitHub Issues](https://github.com/Athen2045/AniStream/issues).
3. Confirm whether the issue happens with a fresh app profile and without local provider overrides.

Include:

- Operating system and version
- AniStream version and architecture (for example, Windows x64 or Apple Silicon)
- The page, title, episode, or chapter involved
- Exact steps to reproduce
- Expected behavior and what happened instead
- A screenshot or short screen recording when the issue is visual
- Relevant error text, without access tokens, cookies, secrets, or personal library data

Do not paste AniList tokens, client secrets, `.env` contents, session files, database files, or
private provider credentials into an issue.

## Current opportunities

### Release and platform

- Add Developer ID signing and notarization for the Apple Silicon DMG.
- Add Authenticode signing and SmartScreen reputation for the Windows installer.
- Run release smoke tests against the published artifacts on clean macOS and Windows machines.

### Product and UX

- Test hero-image fallback behavior against slow, expired, and missing provider CDN URLs.
- Review keyboard navigation and focus restoration across detail, playback, and profile flows.
- Measure rail hover behavior on low-power Windows hardware before adding richer previews.
- Add a small user-facing diagnostics export that omits credentials and personal library data.

### Engineering

- Add focused startup-failure tests with injected renderer-server and database failures.
- Add visual regression coverage for reduced-motion and normal-motion catalog states.
- Keep provider adapters removable and document any endpoint or terms-of-service change before
  implementation.

## Contributor checklist

- Read `AGENTS.md`, `CONTEXT.md`, and `API.md` locally before provider or architecture work.
- Keep secrets in the trusted main process and never commit populated environment files.
- Preserve the Anikoto → MegaPlay playback boundary and MangaDex reading ownership.
- Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, and
  `npm run build` before submitting changes.
- Add or update a focused test when changing a provider contract, IPC boundary, persistence rule,
  or user-visible failure path.
