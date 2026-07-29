# `keerthivasansa/animos` streaming-adapter evaluation

**Research date:** 2026-07-28  
**Repository inspected:** [`keerthivasansa/animos`](https://github.com/keerthivasansa/animos) at commit [`ff6a247`](https://github.com/keerthivasansa/animos/commit/ff6a24762c017f4fb081de89c2afd999f54d249c)  
**Scope:** source-level evaluation of Animos as a potential AniStream anime streaming adapter/API source. This is not a live playback test and does not authorize a provider integration.

## Executive conclusion

**Recommendation: do not adopt, copy, or execute Animos's provider code as an AniStream runtime adapter.**

That conclusion is based on verified facts: the project declares development paused, its latest source push is 2024-02-11, it has no repository-detected license while its README says CC BY-NC-ND 4.0, and its provider layer depends on brittle HTML extraction, an inactive Consumet public endpoint, a defunct Animos-operated HLS proxy, and third-party streaming sites. Its code also contains stale routes that call methods not present on the current service class. These conditions make it unsuitable as a maintainable, portable source for a local macOS app.

The useful part is **architectural reference only**: a provider boundary, an explicit mapping cache, local resume data, skip-time enrichment, and provider-failure isolation. AniStream already has the safer TypeScript contract shape for these ideas and should keep its approved AnimePahe → AnimeTosho/Nyaa strategy independent of Animos.

## Verified repository status

| Item                     | Verified fact                                                                                                                                                                                                               | Evidence                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository identity      | Public, non-archived, non-fork repository; GitHub describes it as an ad-free anime-streaming desktop application.                                                                                                           | [GitHub repository API](https://api.github.com/repos/keerthivasansa/animos)                                                                                                                                                                                                                                                                                                     |
| Maintenance              | The README explicitly says development is “paused indefinitely.” GitHub records the last pushed commit as 2024-02-11 (`ff6a247`).                                                                                           | [README](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/README.md), [commit API](https://api.github.com/repos/keerthivasansa/animos/commits?per_page=20)                                                                                                                                                                                |
| Releases                 | The newest published GitHub release is `v0.5.8` from 2023-01-02; it predates the final source changes.                                                                                                                      | [releases API](https://api.github.com/repos/keerthivasansa/animos/releases?per_page=20)                                                                                                                                                                                                                                                                                         |
| License                  | GitHub repository metadata reports no detected license and no `LICENSE` file is in the inspected tree. The README claims Creative Commons Attribution-NonCommercial-NoDerivatives 4.0.                                      | [repository API](https://api.github.com/repos/keerthivasansa/animos), [tree API](https://api.github.com/repos/keerthivasansa/animos/git/trees/main?recursive=1), [README license statement](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/README.md#license)                                                                           |
| License consequence      | CC BY-NC-ND 4.0 prohibits sharing adapted material and commercial use under its terms. That is incompatible with copying/adapting provider implementation into AniStream without separate permission from the rightsholder. | [Creative Commons legal code, sections 2(a)(1) and 3(a)](https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode.en)                                                                                                                                                                                                                                                        |
| Application architecture | Current source is a SvelteKit/Node web application with Prisma/PostgreSQL and server routes, not the Electron desktop implementation described in the README.                                                               | [`package.json`](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/package.json), [`prisma/schema.prisma`](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/prisma/schema.prisma), [`Dockerfile`](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/Dockerfile) |

**Inference:** the README/release claims describe an earlier desktop distribution, whereas the current default branch is a paused server-rendered web rewrite. It should not be assumed that the released desktop binaries correspond to the inspected provider code.

## What Animos actually uses for data and playback

The following are verified from source; they are not official APIs supplied by Animos.

| Role                      | Hardcoded dependency / provider                                                     | How the code uses it                                                                                                                                 | Assessment for AniStream                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata/search           | Jikan fork at `https://jikan.animos.cf/v4`, plus HTML scraping of `myanimelist.net` | Jikan retrieves title data/trending; `MALSearch` parses MyAnimeList search-result HTML.                                                              | Reject. AniStream already uses official AniList metadata; MyAnimeList HTML scraping conflicts with a stable API-first approach.                                        |
| Artwork/mapping           | Kitsu, plus `https://api.animos.cf/mappings/{malId}`                                | Kitsu supplies cover imagery; Animos's private mapping service supplies Kitsu/LiveChart IDs.                                                         | Reject. The private `animos.cf` mapping dependency is not a portable public contract.                                                                                  |
| Title-to-provider mapping | `https://api.malsync.moe/mal/anime/{malId}`                                         | Base `Provider` maps a MAL ID to provider-specific IDs and stores the result in PostgreSQL.                                                          | Pattern useful; endpoint is external runtime dependency. AniStream should retain its own normalized mapping layer and cache.                                           |
| Primary provider          | AnimePahe (`https://animepahe.ru` in this revision)                                 | Resolves MALSync ID, requests `/a/{id}`, `/api?m=release`, parses `#resolutionMenu`, then deobfuscates a Kwik host page to recover a source URL.     | Do not reuse. Markup/host/deobfuscation-specific extractor is stale and fragile.                                                                                       |
| Secondary provider        | GogoAnime (`https://gogoanime.cl` in this revision)                                 | Scrapes HTML, follows `vidcdn`, derives encrypted AJAX request parameters, decrypts returned source data, and uses a separate episode-list endpoint. | Do not reuse. This is exact site-specific scraping/extraction and its configured domain now redirects.                                                                 |
| Other providers           | Consumet public API for `9anime` and `zoro`                                         | Calls `https://api.consumet.org/anime/{provider}/info/{id}` and `/watch/{episodeId}`.                                                                | Reject. The endpoint currently redirects to Consumet self-hosting instructions, not a public runtime API. It is also explicitly prohibited by AniStream's `AGENTS.md`. |
| Playback proxy            | `https://hls.animos.cf/{base64-url}.m3u8`                                           | Rewrites every resolved stream to an Animos-owned remote proxy.                                                                                      | Reject. The hostname did not resolve during this research, so the code’s playback path cannot be treated as operational.                                               |
| Skip markers              | `https://api.aniskip.com/v2/skip-times/{malId}/{episode}`                           | Retrieves opening/ending markers and caches them alongside episode data.                                                                             | Potentially useful as a separately reviewed optional enrichment, not part of the streaming adapter.                                                                    |

Sources: [`providers/index.ts`](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/providers/index.ts), [`generic.ts`](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/providers/generic.ts), [AnimePahe adapter](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/providers/animepahe/index.ts), [Kwik extractor](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/providers/animepahe/kwik.ts), [Gogo adapter](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/providers/gogo/index.ts), [Consumet adapter](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/providers/consumet/index.ts), [provider utilities](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/providers/utils.ts), [Jikan adapter](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/common/jikan/index.ts), [MAL scraper](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/common/mal/search.ts), [mapping adapter](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/common/mapping/index.ts), [AniSkip adapter](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/common/aniskip/index.ts).

### Bounded live status checks (not playback tests)

On 2026-07-28, one bounded `HEAD` request per hardcoded origin found:

- `api.consumet.org/anime` returned `301` to Consumet's GitHub self-hosting instructions.
- `api.malsync.moe/mal/anime/1535` returned `200`.
- `animepahe.ru` reset the TLS connection from this environment; this does **not** establish that the site is down, only that the adapter cannot be considered verified here.
- `gogoanime.cl` returned `301` to `gogoanime.co.za`, proving the source's hardcoded base URL has changed.
- `hls.animos.cf` did not resolve, so Animos's encoded-proxy URL cannot work from this check.
- `api.aniskip.com` responded, but this was only a route-level check and does not validate episode data.

These observations are transient operational evidence, not a claim about any provider's rights or long-term availability.

## Provider design: what is reusable as an idea

### Good patterns

1. **Separation of title mapping from source lookup.** The abstract provider starts from a canonical MAL ID, resolves a provider ID, caches that mapping, retrieves episodes, then resolves an episode source. That sequence is sound as a high-level boundary. [Source](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/providers/generic.ts)
2. **Persisted source mapping and episode records.** The Prisma schema keeps provider IDs, per-provider episode IDs, resolved sources, durations, and resume records separately. This is a useful data-model reference for a local SQLite equivalent. [Schema](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/prisma/schema.prisma)
3. **Skip-time enrichment as non-blocking metadata.** `EpisodeService` attempts AniSkip after resolving a source and stores skip intervals. The principle—skip metadata must not determine playback availability—is good. [Episode service](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/services/episode/index.ts)
4. **Player lifecycle cleanup.** The Svelte player initializes HLS/Plyr and destroys both on component teardown. AniStream's React player should likewise release media and source resources on title/episode change. [Player component](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/components/composite/EpisodePlayer.svelte)

### Valuable user-facing features to consider separately

| Feature                                | Evidence                                                                | Recommendation                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Local resume timestamps                | `EpisodeHistory` has per-user `watchTime`; the service reads/writes it. | Implement in AniStream's local SQLite database, then reconcile coarse integer progress with AniList under a user-approved threshold.           |
| Opening/ending skip buttons            | AniSkip interval retrieval and persistence exist.                       | Consider only after playback works; use a fresh service/API review and fixture tests.                                                          |
| Episode list with title enrichment     | Watch page merges provider episode records with Jikan episode titles.   | Implement using AniList episode data where available and provider episode labels as a fallback.                                                |
| Provider-specific episode/source cache | Provider IDs and episode/source records are persisted.                  | Keep this idea, but cache short-lived URLs conservatively with expiry and failure state; never store provider cookies/secrets in the renderer. |
| Multiple-source fallback               | Registry lists four providers.                                          | Preserve AniStream's approved HLS-primary/torrent-fallback contract, but do not inherit the provider list or switching implementation.         |

## Verified engineering and security concerns

### Source correctness and maintainability

- The registered raw API routes call `anime.setProvider(...)`, `anime.getSource(...)`, and `anime.getEpisodes()`, while the current `AnimeService` does not define `setProvider` or `getSource`. The actual episode/source methods are on `EpisodeService`. This is a verified stale-code mismatch, not merely a missing test. [Watch route](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/routes/api/raw/%5BanimeId%5D/%5Bepisode%5D/watch/%2Bserver.ts), [episodes route](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/routes/api/raw/%5BanimeId%5D/episodes/%2Bserver.ts), [AnimeService](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/services/anime/index.ts), [EpisodeService](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/services/episode/index.ts)
- Provider selection is a static process-global value, not user/request-scoped. In a multi-user web server that can leak one selection into another user's request. This is less relevant to a single-user desktop app, but it shows the code should not be reused as-is. [UserService](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/services/user/index.ts)
- The code uses `@ts-nocheck` in the Kwik extraction module and logs resolved source-related values. This weakens type and operational safety around the most brittle integration. [Kwik extractor](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/providers/animepahe/kwik.ts)
- Resolved stream URLs are persisted in the database without a visible expiry/refresh model. **Inference:** because streaming URLs are commonly short-lived, cached resolved URLs risk staleness and should instead carry an explicit expiry and be refreshable.
- The app loads Plausible analytics from `analytics.animos.cf`. AniStream is single-user/local-first, so this is not a feature to adopt. [Root layout](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/routes/%2Blayout.svelte)

### Legal and terms risk

- AnimePahe, GogoAnime, 9anime, Zoro, Kwik deobfuscation, and proxying are not documented official media APIs in this repository; the code extracts/rewrites streams from third-party sites. This is a legal/ToS-adjacent mechanism and can be fragile or prohibited by source sites.
- The `hls.animos.cf` rewriting design can turn AniStream into a remote media relay. **Recommendation:** do not rehost, proxy through a third-party relay, or replicate that model. Keep source resolution in the trusted local main process and respect provider constraints.
- The README's CC BY-NC-ND statement blocks copying/adapting source even for a personal app when distribution or adaptation is involved. **Recommendation:** treat code as read-only reference; independently implement any general idea behind AniStream's existing interface.

### Credentials and application security

- The web app expects Google OAuth client credentials and a PostgreSQL URL as build-time/server environment values. [Google auth](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/server/auth/google.ts), [Dockerfile](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/Dockerfile)
- **Recommendation:** do not import its auth/database model. AniStream's Keychain-backed AniList model and narrow Electron preload bridge are the correct trust boundary for this project.

## Tests and verification

### What exists

- `package.json` declares `check`, `test`, and `coverage` scripts using `svelte-check` and Vitest. [Source](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/package.json)
- The inspected tree contains two provider-adjacent tests only: one makes live MALSync requests for Death Note mappings and one makes a live AniSkip request for Death Note episode 1 markers. [MALSync test](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/common/malsync/index.test.ts), [AniSkip test](https://github.com/keerthivasansa/animos/blob/ff6a24762c017f4fb081de89c2afd999f54d249c/src/lib/common/aniskip/index.test.ts)
- No fixtures, mocked transport tests, parser tests, end-to-end playback tests, or tests of the AnimePahe/Gogo/Consumet extractors were found in the tracked source tree. [Tree API](https://api.github.com/repos/keerthivasansa/animos/git/trees/main?recursive=1)

### What was not executed

I did **not** install dependencies or run the cloned project's scripts. That would execute untrusted third-party package/repository scripts, which is not necessary for a source inspection and was blocked by the workspace safety policy. Therefore, claims above about the stale route/service mismatch are static source findings, not a completed `svelte-check` result.

**Recommendation:** every future AniStream source adapter needs fixture-based tests for title mapping, episode parsing, hoster discovery, source normalization, malformed markup, 403/429, timeout, empty results, and short-lived URL expiry. Live strict-provider tests should remain manual, paced, and optional.

## Final decision for AniStream

| Candidate use                           | Decision                     | Reason                                                                                                                                                     |
| --------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import Animos provider files            | **Reject**                   | License uncertainty/CC BY-NC-ND restriction, paused maintenance, stale domains/hosted dependencies, brittle extraction, and no suitable tests.             |
| Use Animos as an API                    | **Reject**                   | It exposes no stable standalone anime API; the app's own proxy/mapping/Jikan origins are project-operated dependencies, not a documented service contract. |
| Add AnimePahe code from Animos          | **Reject**                   | It is an old specific scraper/deobfuscator; AniStream must re-verify the approved target and implement a removable adapter independently.                  |
| Add Gogo/9anime/Zoro/Consumet fallbacks | **Reject**                   | Not approved in AniStream's target order; Consumet runtime use is explicitly disallowed; these are legal/ToS-sensitive and stale.                          |
| Reuse architectural ideas               | **Accept as reference only** | Mapping → episodes → source boundary, local resume state, skip metadata, and cleanup are useful patterns to independently implement.                       |

No AniStream application code or `CONTEXT.md` was changed by this research task.
