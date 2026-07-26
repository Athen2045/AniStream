# Consumet evaluation for AniStream

Research date: 2026-07-27  
Scope: Consumet documentation, official repositories, the published `@consumet/extensions` package, and suitability for AniStream's macOS Electron + TypeScript architecture.

## Executive conclusion

**Recommendation: reject Consumet as a runtime dependency or hosted API; adapt only its provider-interface pattern.**

Consumet is not an anime/manga database comparable to AniList or MangaDex. It is primarily a collection of TypeScript scrapers and extractors, optionally exposed through a self-hosted REST API. Its separation of provider-specific parsers from common result types is useful architectural precedent for AniStream. Its current distribution and legal state, however, make direct adoption too risky:

- the official public API was already withdrawn in favor of self-hosting;
- GitHub currently blocks both core repositories following a March 2026 DMCA notice;
- the last npm artifact remains installable, but its source repository is unavailable;
- license declarations conflict between the npm artifact and GitHub's repository labels;
- upstream scraper behavior, authentication, and rate limits remain provider-specific and fragile.

AniStream should retain AniList as its primary metadata/tracker source and MangaDex as its manga/chapter/account source. For approved video targets, AniStream should own a small removable adapter interface and implement or independently validate each adapter. Do not install, vendor, or copy Consumet code into AniStream in its present state.

## Source availability

| Source checked on 2026-07-27 | Result |
| --- | --- |
| [Consumet documentation](https://docs.consumet.org/) | Reachable with a normal HTTP client. The site says its documentation is undergoing reconstruction. The research browser received HTTP 403, so individual pages were checked with read-only HTTP requests instead. |
| [Consumet API repository](https://github.com/consumet/api.consumet.org) | GitHub's cached web view was readable, but a fresh clone returned HTTP 403 with “Repository unavailable due to DMCA takedown.” |
| [Consumet TypeScript library](https://github.com/consumet/consumet.ts) / historical alias [`consumet/extensions`](https://github.com/consumet/extensions) | A fresh clone returned the same DMCA response. Some cached GitHub page content remained visible. |
| [`@consumet/extensions` on npm](https://www.npmjs.com/package/@consumet/extensions) | Registry metadata and version `1.8.8` remained available. The package tarball installed successfully in an isolated temporary directory. |
| [GitHub DMCA notice dated 2026-03-12](https://github.com/github/dmca/blob/master/2026/03/2026-03-12-dramacool.md) | Reachable. It names `consumet/consumet.ts` and `consumet/api.consumet.org`; GitHub's clone response links directly to this notice. |
| [Consumet provider-status repository](https://github.com/consumet/providers-status) | Cached repository page was reachable, but it did not provide sufficiently current evidence to treat individual provider status flags as verified. |

## Verified facts

### Product and architecture

- The [official API README](https://github.com/consumet/api.consumet.org) describes Consumet as scraping multiple entertainment websites and exposing the results through APIs. It explicitly warns that Consumet is unaffiliated with the scraped providers and calls out legal risk.
- The documentation describes two consumption modes:
  - a REST API historically based at `https://api.consumet.org`; and
  - the Node/TypeScript package `@consumet/extensions`.
- The published `@consumet/extensions@1.8.8` artifact contains compiled CommonJS JavaScript and TypeScript declaration files. Its exports group providers under categories including `ANIME`, `MANGA`, and `META`.
- Its type declarations expose base provider/parser classes and normalized result interfaces. Anime providers implement operations such as search, title information, episode lists, server discovery, and episode-source resolution.
- Version `1.8.8` includes anime provider classes for AnimePahe, HiAnime, AnimeKai, KickAssAnime, AnimeSaturn, AnimeUnity, and AnimeSama. It also includes manga and metadata adapters, including MangaDex and AniList-related classes.
- The API repository used TypeScript and Fastify and wrapped `@consumet/extensions`. Its checked `package.json` declared Node `>=12.5.0`, `ts-node`, Fastify, WebSocket support, and Redis through `ioredis`.

### Maintenance and current availability

- npm registry metadata shows `@consumet/extensions@1.8.8` was published on 2026-01-20. This proves a release occurred shortly before the takedown; it does **not** prove active maintenance after the takedown.
- On 2026-07-27, fresh Git clones of both official core repositories failed because GitHub marked them unavailable following the [2026-03-12 DMCA notice](https://github.com/github/dmca/blob/master/2026/03/2026-03-12-dramacool.md).
- The official API README states that the public Consumet API is no longer available and self-hosting is required.
- A direct check of `https://api.consumet.org/` redirected to the unavailable GitHub API repository and ended with HTTP 451. It is therefore not a usable public instance.
- The documentation website still presents `https://api.consumet.org` as its REST base URL. This conflicts with the repository README and the live HTTP result, so that documentation is stale on this point.

### Runtime and self-hosting

- Historical official instructions supported local Node execution (`npm install`, then `npm start`) and Docker, with additional deployment templates for hosted platforms.
- The historical Docker example exposed the service on local port `3000`.
- The published library package itself has no native macOS dependency in its manifest. Its declared runtime dependencies are JavaScript packages such as Axios, Cheerio, `got`, `got-scraping`, `node-fetch`, `form-data`, and `crypto-js`.
- In an isolated test on 2026-07-27, `@consumet/extensions@1.8.8` installed with scripts disabled and loaded successfully under Node `v22.23.1` on the current Apple Silicon Mac. Its AnimePahe provider could be instantiated. No live scraping or stream extraction was performed, so provider functionality was not verified.
- A fresh self-host from the official API repository is presently blocked because the repository is unavailable and its checked manifest depended on the Consumet library through GitHub.

### Authentication and rate limits

- The published Node package does not require a Consumet API key or Consumet account; it executes provider requests directly.
- The reviewed official REST getting-started page published a base URL but did not document an API-key or user-authentication scheme.
- No current official, numeric, service-wide Consumet rate limit was found in the accessible documentation.
- Consumet's adapters call different upstream websites and APIs. Authentication, cookies, anti-bot behavior, request ceilings, and blocking therefore vary by provider. A “no Consumet auth” result must not be interpreted as “no upstream access constraints.”
- The published package does not provide enough evidence of a centrally enforced, provider-aware rate-limit policy. AniStream would still need its own per-provider queues, caching, timeouts, bounded retries, and 403/429 circuit handling.

### License

- The npm registry and the downloaded `@consumet/extensions@1.8.8` `package.json` declare `MIT`.
- Cached GitHub pages label both the TypeScript library and API repositories as `GPL-3.0`; an older checked API `package.json` displayed `MIT`.
- Because the current repository license files cannot be retrieved after the takedown, this conflict could not be resolved from authoritative current source.
- The separate `consumet/consumet.org` website repository is labeled MIT, but that license does not establish the license for the scraper library or API.

**Verified conclusion:** Consumet's reusable-code license is currently ambiguous. Treating the package as safely MIT-licensed would be an unsupported assumption.

## Recommendations and inferences

The following are engineering judgments, not claims made by Consumet.

### What AniStream can use

- **Adapt the shape, not the implementation.** Consumet validates the usefulness of category-specific provider classes behind normalized search/info/episode/source contracts. This matches AniStream's existing decision to isolate metadata and media-source adapters.
- Keep provider IDs and response models private to each AniStream adapter. Normalize only the fields the application needs.
- Preserve independent failure boundaries: a broken anime source must not disable AniList discovery, tracker sync, MangaDex reading, or the local library.
- Use Consumet's published provider list only as a research lead. Re-verify an approved target's current domain, terms, request flow, and extraction behavior from scratch before implementation.

### What AniStream should not use

- **Do not use Consumet as the anime/manga database.** Its meta adapters duplicate AniList and its MangaDex wrapper obscures capabilities AniStream needs directly, especially MangaDex account sync, official rate-limit headers, and MangaDex@Home reporting.
- **Do not depend on `api.consumet.org`.** There is no functioning public instance.
- **Do not self-host the old REST API.** It adds a second local server, Redis-oriented complexity, and another normalization layer without helping a one-user Electron app. Direct main-process adapters are simpler.
- **Do not add `@consumet/extensions` as a production dependency.** The source is unavailable, maintenance continuity is unknown, provider behavior is unverified, and the license conflict is unresolved.
- **Do not vendor or reconstruct the package from npm.** Besides the licensing uncertainty, doing so would inherit DMCA-targeted code and a broad set of unrelated providers that AniStream does not need.

### Electron fit

Technically, the Node library's JavaScript-only runtime can execute in Electron's main process on Apple Silicon. That is only a compatibility result, not an adoption argument. If the project were restored with a clear license and narrowed provider scope, a future spike could wrap one approved provider behind AniStream's own interface. Until then, the safer design is a first-party adapter in the trusted main process with:

- no provider code or secrets in the renderer;
- explicit headers/cookies scoped to that adapter;
- typed validation at the remote boundary;
- provider-specific throttling and circuit state;
- fixture-based parser tests;
- a kill switch and clean removal path.

## Adopt / adapt / reject matrix

| Candidate use | Decision | Reason |
| --- | --- | --- |
| Primary anime/manga database | **Reject** | It is a scraper/extractor collection, not a reliable source of record; AniList and MangaDex already own these roles. |
| Public REST API | **Reject** | Officially withdrawn; live URL is unusable. |
| Self-hosted REST API | **Reject** | Core repository unavailable, dependency chain broken, unnecessary local-service complexity. |
| `@consumet/extensions` package in production | **Reject for now** | Source unavailable, maintenance uncertain, license conflict unresolved, provider functionality unverified. |
| Consumet provider architecture | **Adapt** | Its replaceable parser/provider concept aligns with AniStream's approved modular-source design. Reimplement the small interface independently. |
| Consumet provider list | **Adapt as research leads only** | Useful discovery index, but every target requires current independent verification and user approval. |

## Final recommendation

Use Consumet as evidence that AniStream's removable-provider architecture is the right shape, but do not make AniStream operationally or legally dependent on Consumet. Revisit only if the official source repositories return, the license is unambiguous, post-takedown maintenance resumes, and a narrowly scoped provider passes live and fixture-based verification.
