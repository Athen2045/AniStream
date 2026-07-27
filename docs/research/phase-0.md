# AniStream Phase 0 research

Verified on 2026-07-26. “Verified” means the claim was found in an official documentation page or the referenced project’s source. Recommendations are explicitly labeled.

## AniList

### Verified facts

- AniList API v2 is GraphQL. Requests are `POST` requests to `https://graphql.anilist.co` with `query` and `variables`. [Official GraphQL guide](https://docs.anilist.co/guide/graphql/)
- Public anime, manga, character, and public/unlisted user data do not require authentication. Private data and mutations require authentication. [Official authentication guide](https://docs.anilist.co/guide/auth/)
- AniList uses OAuth 2. It supports Authorization Code and Implicit grants, does not support scopes or refresh tokens, and documents one-year access-token validity. A desktop application may register a custom URI scheme. [Official authentication guide](https://docs.anilist.co/guide/auth/)
- List writes use authenticated GraphQL mutations such as `SaveMediaListEntry`. [Official mutation guide](https://docs.anilist.co/guide/graphql/mutations)
- The documented normal limit is 90 requests/minute, but the current documentation warns that the API is temporarily degraded to 30 requests/minute. Responses expose rate-limit headers; a 429 response may include `Retry-After` and reset information. AniList also uses a burst limiter. [Official rate-limit guide](https://docs.anilist.co/guide/rate-limiting)
- AniList warns that limits may be lowered or the API suspended during severe outages. [Official considerations](https://docs.anilist.co/guide/considerations)
- AniList prohibits mass collection/hoarding and use as a backup datastore. [Official terms](https://docs.anilist.co/guide/terms-of-use)

### Recommendation

Use AniList as AniStream’s primary metadata, discovery, identity, and list-sync provider. Start with a 25 requests/minute application budget while the official degraded-state warning remains, deduplicate requests, cache bounded view data, and always obey response headers over configured defaults. This is a recommendation, not an AniList requirement.

## MangaDex

The official documentation repository was cloned and inspected at commit [`60a3bb3`](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/commit/60a3bb3c9f25675435a479c925d857015201739e), dated 2025-12-08.

### Verified facts

- The REST base URL is `https://api.mangadex.org`. Public catalog/chapter reads do not require AniStream to authenticate; authenticated account operations use OAuth 2. For a one-user client, MangaDex documents a personal-client flow registered from MangaDex settings. [Official authentication docs](https://api.mangadex.org/docs/02-authentication/)
- Requests must use TLS and a truthful `User-Agent`. MangaDex does not provide cross-origin responses for arbitrary sites and requires clients to proxy requests/images where relevant. Direct image hotlinking returns the wrong response. [Official limitations](https://api.mangadex.org/docs/2-limitations/)
- The current official repository documents an approximate global limit of 5 requests/second/IP for `api.mangadex.org`. Continuing after 429 responses can escalate to a temporary 403 ban and eventually dropped replies. [Official limitations](https://api.mangadex.org/docs/2-limitations/)
- `GET /at-home/server/{chapterId}` has an additional limit of 40 requests/minute. Endpoint-specific responses include `X-RateLimit-*` headers. [Official limitations](https://api.mangadex.org/docs/2-limitations/)
- Chapter pages must use MangaDex@Home: call `GET /at-home/server/{chapterId}`, then construct each page URL from the returned `baseUrl`, chapter hash, quality (`data` or `data-saver`), and ordered filename. The returned base URL is dynamic and guaranteed for 15 minutes; it must not be hardcoded. [Official chapter retrieval guide](https://api.mangadex.org/docs/04-chapter/retrieving-chapter/)
- Authentication headers must never be sent to image hosts. For third-party MangaDex@Home nodes, clients are expected to report image success/failure and request a new node after a failure. [Official chapter retrieval guide](https://api.mangadex.org/docs/04-chapter/retrieving-chapter/)

### Recommendation

Route MangaDex API and page-image requests through the desktop main process/local backend. Use a shared 4 requests/second token bucket, a separate 35 requests/minute budget for AtHome allocation, response-header overrides, and a hard stop on 429/403 until the documented reset/cooldown. Cache chapter metadata only within its validity window. These values are conservative client choices, not MangaDex-published limits.

## AniDB HTTP API

### Verified facts

- AniDB describes its HTTP API as read-only and limited to a small subset of the database, mainly non-file/non-episode information for a specific anime. [AniDB API overview](https://wiki.anidb.net/API)
- Every HTTP client must be registered and send its registered lowercase `client`, integer `clientver`, and `protover=1`. A lookup is by AniDB anime ID (`aid`). [HTTP API definition](https://wiki.anidb.net/HTTP_API_Definition)
- AniDB requires heavy local caching, says the same dataset requested multiple times in one day can cause a ban, and says not to exceed one page every two seconds. It does not publish a numeric daily request cap on the HTTP API page. [HTTP API definition](https://wiki.anidb.net/HTTP_API_Definition)
- The HTTP API docs warn that flooding or attempts to download the database can cause bans. [HTTP API definition](https://wiki.anidb.net/HTTP_API_Definition)
- AniDB’s API overview asks clients not to parse AniDB HTML directly and warns that too many HTTP requests cause bans. The accessible official wording does not say “manual or automated, no exceptions”; that stronger formulation was not verified. [AniDB API overview](https://wiki.anidb.net/API)
- Silent packet dropping is explicitly documented for AniDB’s UDP flood protection. The HTTP documentation warns of bans but does not explicitly say HTTP bans are silent. [UDP API definition](https://wiki.anidb.net/UDP_API_Definition)

### Recommendation

Defer AniDB from v1 and treat it as optional enrichment/mapping data only. AniList already covers the load-bearing catalog and list use cases, while direct AniDB integration adds registration, XML parsing, strict pacing, and ban risk. If enabled later, enforce a global queue of at most one request every 2.5 seconds, cache each anime response for at least 24 hours, require a registered client identifier, and expose a kill switch.

The current `AniDbProvider` in `src/api/index.ts` is not production-safe: it defaults to an unregistered `anistream` identifier and has not been tested against the live service. It must not be treated as working.

## `public-apis` anime index

### Verified facts

- The current index lists AniAPI, AniDB, AniList, Jikan, Kitsu, MangaDex, MyAnimeList, and others. Its table is a directory, not authoritative service documentation. For example, it labels MangaDex as `apiKey`, while MangaDex’s own docs describe public reads and OAuth/personal clients for authenticated operations. [Current raw index](https://raw.githubusercontent.com/public-apis/public-apis/master/README.md#anime)
- Jikan v4 is alive: a live request to `https://api.jikan.moe/v4/anime/1` returned data during this research. Jikan’s own docs call it an unofficial MyAnimeList API that scrapes MyAnimeList and document 3 requests/second, 60/minute, unlimited daily, with no authentication for public reads. [Jikan official docs](https://docs.api.jikan.moe/)
- Kitsu’s official JSON:API documentation is reachable and documents `https://kitsu.io/api/edge`, public GET requests without auth, and OAuth 2 for authenticated actions. The documentation reviewed did not publish a numeric rate limit, so none should be assumed. [Kitsu official API docs](https://hummingbird-me.github.io/api-docs/)

### Recommendation

Do not add Jikan or Kitsu to v1. They duplicate AniList’s metadata role and increase normalization and failure handling. Keep Jikan as a possible read-only fallback only if a concrete AniList data gap appears. Kitsu should be reconsidered only for a specific feature that AniList cannot supply.

## Zenshin (`tosho-update`)

The referenced branch was cloned and inspected at commit [`9ee5f0c`](https://github.com/hitarth-gg/zenshin/commit/9ee5f0cb2e64563d1b5a51e3f8c5aa8595d6dc75), dated 2026-05-25.

### Verified facts

- Zenshin’s active desktop implementation uses Electron, React, electron-vite, TanStack Query, an Electron main/preload/renderer split, and a local Express server. [Package manifest](https://github.com/hitarth-gg/zenshin/blob/tosho-update/Electron/zenshin-electron/package.json)
- Metadata and discovery requests go to AniList, while mappings use a separate Zenshin API and media acquisition uses separate Tosho/Nyaa/AnimePahe paths. [API utility](https://github.com/hitarth-gg/zenshin/blob/tosho-update/Electron/zenshin-electron/src/renderer/src/utils/api.js)
- The separate `zenshin-API` maps AniList, MAL, AniDB, TVDB, and other IDs to episode information. Its README says data is typically updated every two days, exposes Render-hosted endpoints, warns about free-tier egress, and asks clients to cache. [zenshin-API README](https://github.com/hitarth-gg/zenshin-API)
- Zenshin’s README says the original Tosho source was shutting down and the branch moved to a `tosho-xyz` alternative, directly demonstrating provider churn. [Zenshin README](https://github.com/hitarth-gg/zenshin/tree/tosho-update)
- AnimePahe support is implemented as a local extension/router that calls site endpoints, parses HTML, manages cookies, and handles 403/Cloudflare behavior. This is scraping/extraction, not a stable official provider API. [AnimePahe router](https://github.com/hitarth-gg/zenshin/blob/tosho-update/Electron/zenshin-electron/src/main/animepahe/routes/search.js)
- Torrent media is handled by a local Express/WebTorrent server that accepts magnets, selects files, and serves HTTP byte ranges. [Local server](https://github.com/hitarth-gg/zenshin/blob/tosho-update/Electron/zenshin-electron/src/main/server.mjs)

### Recommendation

Copy the separation pattern—catalog metadata, ID/episode mapping, and media sources as distinct adapters—but do not copy a scraping target or Zenshin’s implementation wholesale. A source adapter must be removable without affecting discovery, lists, progress, or manga reading.

## Netflix and MangaFire design references

### Verified/observed patterns

- Netflix officially documents a “Continue Watching” row, removing titles from that row, a “My Netflix” hub for saved/downloaded/in-progress/recent items, and configurable preview autoplay. [Continue Watching help](https://help.netflix.com/en/node/115312), [My Netflix announcement](https://about.netflix.com/en/news/introducing-my-netflix-a-one-stop-shop-for-series-and-movies-you-want-to-watch), [preview autoplay help](https://help.netflix.com/en/node/2102)
- MangaFire is a dynamic website and offers no official integration API relevant to AniStream. It is a visual reference only. Current reader-related pages/search results expose single-page and long-strip terminology, right-to-left navigation, a progress bar, chapter controls, and reader preferences. These are observations, not an integration contract. [MangaFire](https://mangafire.to/)

### Design notes (recommendation)

- Browse: a large current/featured hero, horizontally scrollable rails, a prominent Continue Watching/Reading rail with progress, compact hover/focus actions, and one global search returning anime and manga.
- Lists/profile: dense status tabs, score/progress editing without leaving the list, filters/sort, and separate anime/manga summaries under one profile surface.
- Reader: distraction-free content, sticky/auto-hiding toolbar, chapter selector, single-page/double-page/long-strip modes, left-to-right/right-to-left controls, click/keyboard page-turn zones, zoom/fit controls, and persistent per-series reading preferences.
- Avoid forced autoplay. If previews are added later, make them opt-in and honor reduced-motion settings.
- Netflix and MangaFire must not be scraped or used as data providers.

## Unverified or intentionally unresolved

- No numeric AniDB HTTP daily cap was found in the official docs.
- “Silent HTTP bans” were not confirmed; silent dropping is explicit in UDP documentation.
- No numeric Kitsu rate limit was found in the official docs reviewed.
- The legal/ToS acceptability and maintenance cost of any specific anime streaming source remain product decisions.
- No video source is selected for AniStream.
