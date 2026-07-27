# AniStream agent instructions

## Golden rules

- This is a single-user, local-first application for one Apple Silicon Mac. Do not add tenants, server accounts, cloud deployment, team permissions, or distributed infrastructure.
- macOS is the only supported platform. Do not add Windows/Linux packaging or compatibility work unless the user asks.
- Never commit API keys, OAuth secrets, access tokens, passwords, cookies, or personal library data.
- Never expose secrets or unrestricted filesystem/network access to the Electron renderer.
- Approved targets are AnimePahe HLS first, then AnimeTosho/Nyaa torrent fallback. Re-verify their current behavior before implementation; never silently add or replace a target.
- Consumet is research material only. Do not add `@consumet/extensions`, depend on `api.consumet.org`, or copy its provider implementations without a new user-approved review of source availability, licensing, maintenance, and legal/ToS risk.
- Aniyomi is an architecture/UX reference. Do not load Android APK extensions; implement native TypeScript source contracts in the Electron main process.
- Do not scrape Netflix or MangaFire. They are visual references only.
- VidKing is an optional remote iframe experiment, not a native HLS source. Keep its origin and
  postMessage handling strictly validated, and never infer TMDB IDs from title text.
- Parse is an optional hosted episode-guide adapter. Keep its bearer key in the main process, do not
  assume the supplied endpoint schema is verified, and do not make it load-bearing without explicit
  target-site authorization and cost/ToS review.
- AniList is the primary metadata and tracker source. MangaDex owns manga/chapter delivery and its account state.
- AniList-to-MangaDex mappings may be accepted automatically only from an exact, unique
  `attributes.links.al` match. Never establish identity from title similarity alone.
- Keep MangaDex public reading independent from account sync. Its personal-client password flow is
  opt-in and must use macOS Keychain before implementation is considered usable.
- AniDB is deferred optional enrichment, not a load-bearing dependency.

## Before you start any session

1. Read `CONTEXT.md` in full before touching code.
2. Read `API.md` before changing any remote integration.
3. Inspect the current worktree and preserve unrelated user changes.
4. Verify current provider documentation when the task involves endpoints, auth, fields, rate limits, or terms.

## Before you end any session

Rewrite the non-log sections of `CONTEXT.md` to reflect reality after any meaningful change. A meaningful change includes:

- a feature becoming verified working or breaking;
- a new decision, dependency, integration, migration, or module seam;
- a discovered bug, provider limitation, blocker, or security issue;
- any change to setup, scripts, environment variables, or next priorities.

Append only short dated entries to the architectural decisions log. Do not turn the rest of `CONTEXT.md` into a changelog.

## Coding conventions

- TypeScript strict mode everywhere; avoid `any`. Validate untrusted remote data at the adapter edge.
- React files use `PascalCase.tsx`; hooks use `useThing.ts`; other files use `kebab-case.ts`.
- Main-process ownership: persistence, credentials, API throttling, scraping/extraction, filesystem access, and playback/source resolution.
- Renderer ownership: presentation, navigation, transient interaction state, and calls through the typed preload bridge.
- Shared ownership: serializable contracts only. Do not import Electron, Node, database, or provider implementations into `src/shared`.
- Keep provider response types inside their adapters. Application and UI callers receive normalized domain values.
- Prefer a small, deep module interface. Accept dependencies, return results, and keep provider quirks local.
- Use Prettier-compatible formatting and ESLint once configured.
- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## External API research

- Prefer official documentation and source repositories. A community index is a lead, not evidence.
- Record the verification date and direct source in `docs/research/` or `API.md`.
- Label each statement as verified fact, recommendation, or inference when the distinction matters.
- Do not invent a rate limit. If official limits are unavailable, make throttles configurable and state that the number is a conservative application policy.
- Re-check dynamic facts before implementation, especially auth flows, limits, provider domains, and extraction behavior.

## Decision-making boundary

Agents may decide autonomously:

- internal names, local folder placement, test structure, refactors that preserve behavior;
- normalized types, private helper functions, and implementation details behind an approved module interface;
- conservative caching, retry, and timeout details that remain within documented provider rules.

Agents must ask the user or record an open decision before:

- changing or adding a scraped/aggregator video target beyond the approved AnimePahe → AnimeTosho/Nyaa fallback order;
- accepting a paid API tier or recurring service cost;
- changing v1 scope, supported platform, or tracker ownership;
- introducing cloud storage, telemetry, remote accounts, or data sharing;
- making legal/ToS-adjacent tradeoffs or storing new classes of credentials;
- replacing Electron, React, TypeScript, or SQLite.

## Security and provider rules

- Keep OAuth client secrets, MangaDex credentials, cookies, and tokens in the main process and ultimately macOS Keychain.
- Use `contextIsolation: true`, `nodeIntegration: false`, a narrow preload interface, and validated IPC payloads.
- Add timeouts, cancellation, bounded retries, rate-limit queues, and circuit breakers where appropriate.
- Stop on 429/403 according to provider instructions; do not retry aggressively.
- MangaDex images must follow MangaDex@Home, use the returned base URL as-is, omit auth headers, and be proxied by the trusted process.
- Scraped adapters must be removable. A broken source may degrade playback, but must not break discovery, lists, or manga.

## Testing and verification

- “Compiles” is not equivalent to “works.”
- Run `npm run typecheck` and `npm run build` for structural changes.
- For UI work, run the desktop app and exercise the changed interaction.
- For integration work, test a representative success, empty result, timeout, 429/degraded case, and malformed response using fixtures or an injected transport.
- Never hit strict providers repeatedly in automated tests. AniDB tests must use fixtures unless the user explicitly authorizes a paced live check with a registered client.
- Update `CONTEXT.md` only with what was actually verified.
