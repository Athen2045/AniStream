# AniStream agent instructions

## Golden rules

- This is a single-user, local-first application for one Apple Silicon Mac. Do not add tenants, server accounts, cloud deployment, team permissions, or distributed infrastructure.
- macOS is the only supported platform. Do not add Windows/Linux packaging or compatibility work unless the user asks.
- Never commit API keys, OAuth secrets, access tokens, passwords, cookies, or personal library data.
- Never expose secrets or unrestricted filesystem/network access to the Electron renderer.
- The approved anime runtime is Anikoto catalog/episode data plus MegaPlay embedded playback. The
  former AniWatch, Zenshin, AnimeTosho, Nyaa, HLS-proxy, and magnet paths were explicitly removed.
  Keep Anikoto removable and configurable; never silently restore an old source or add another target.
- Consumet is research material only. Do not add `@consumet/extensions`, depend on `api.consumet.org`, or copy its provider implementations without a new user-approved review of source availability, licensing, maintenance, and legal/ToS risk.
- Aniyomi is an architecture/UX reference. Do not load Android APK extensions; implement native TypeScript source contracts in the Electron main process.
- Do not scrape Netflix or MangaFire. They are visual references only.
- VidKing is an optional remote iframe experiment, not the active anime source. Keep its origin and
  postMessage handling strictly validated, and never infer TMDB IDs from title text.
- Parse is an optional hosted episode-guide adapter. Keep its bearer key in the main process, do not
  assume the supplied endpoint schema is verified, and do not make it load-bearing without explicit
  target-site authorization and cost/ToS review.
- AniList is the primary metadata and tracker source. MangaDex owns manga/chapter delivery and its account state.
- MangaBaka may enrich manga only through its exact AniList-ID route. MangaUpdates data may be
  displayed from that normalized mapping, but do not call MangaUpdates directly until its canonical
  numeric ID and ambiguous auth contract are verified.
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

- changing or adding a video target beyond the approved Anikoto → MegaPlay embed flow;
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
- Keep `ANISTREAM_ANIKOTO_ENABLED` as a kill switch and
  `ANISTREAM_ANIKOTO_API_URL` configurable for verified HTTPS-compatible deployments.
- Anikoto permits 60 requests per IP per 120 seconds. Stop on 429/403, honor its rate headers, and
  never crawl every catalog page to find one AniList title.
- MegaPlay is embed-only. Keep `event.origin` and `event.source` checks strict, keep the packaged
  renderer on its truthful loopback HTTP origin, and do not spoof a third-party referrer or extract
  media URLs. The approved MegaPlay iframe intentionally has no HTML `sandbox` attribute because the
  provider rejected sandboxed playback. Do not weaken Electron's own `sandbox: true`,
  `contextIsolation`, navigation allowlist, window-open denial, or message validation.
- Latest Updates are fixed 21-item provider pages rendered as a static seven-column grid at the
  1440px default window. Do not put these fields back inside `ContentCarousel`; their pagination
  must reload only the Latest Updates field.
- Latest manga publication tags use exact provider IDs only: MangaDex original language is primary,
  AniList country is the batch cross-check, and MAL `media_type` is a bounded ambiguity fallback.

## Testing and verification

- “Compiles” is not equivalent to “works.”
- Run `npm run typecheck` and `npm run build` for structural changes.
- For UI work, run the desktop app and exercise the changed interaction.
- For integration work, test a representative success, empty result, timeout, 429/degraded case, and malformed response using fixtures or an injected transport.
- Never hit strict providers repeatedly in automated tests. AniDB tests must use fixtures unless the user explicitly authorizes a paced live check with a registered client.
- Update `CONTEXT.md` only with what was actually verified.
