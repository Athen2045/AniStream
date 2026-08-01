# AniStream external integrations

Verified against the sources in `docs/research/phase-0.md` on 2026-07-26. Application throttles below are recommendations unless explicitly described as provider limits.

## Shared integration policy

- All provider traffic originates in the Electron main process.
- Renderer code receives normalized, serializable values through a narrow preload bridge.
- Each provider has its own queue, timeout, cache policy, and circuit state.
- A provider failure degrades only the features that depend on it.
- Credentials belong in environment variables during development and macOS Keychain in the usable application.

## AniList

| Item            | Value                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL        | `https://graphql.anilist.co`                                                                                                                                    |
| OAuth authorize | `https://anilist.co/api/v2/oauth/authorize`                                                                                                                     |
| OAuth token     | `https://anilist.co/api/v2/oauth/token`                                                                                                                         |
| Auth            | None for public reads; OAuth 2 authorization-code grant for this desktop client                                                                                 |
| Credentials     | Public client ID built into the personal app; client secret in macOS Keychain; encrypted access token stored under app data using Keychain-backed `safeStorage` |
| Redirect        | `anistream://auth/anilist`                                                                                                                                      |
| Features        | Unified catalog search, discovery, details, relations, profile, anime/manga lists, score/status/progress sync                                                   |
| Official docs   | [AniList API documentation](https://docs.anilist.co/)                                                                                                           |

### Implemented authentication and profile flow

- The trusted main process opens AniList's authorization page with `response_type=code`, then exchanges the callback code at the official token endpoint.
- On first connection, a native macOS hidden-input dialog stores the client secret in Keychain under service `dev.anistream.desktop.anilist-client`; it is not written to `.env`, sent to the renderer, or packaged. `npm run configure:anilist` remains a terminal fallback.
- The macOS application bundle registers the `anistream` URL scheme and handles the OAuth result through Electron's `open-url` event.
- The returned token is verified immediately with `Viewer`, encrypted using asynchronous Electron `safeStorage`, and stored with owner-only file permissions.
- The encrypted session contains the access token plus a normalized profile snapshot. Session
  restoration starts during main-process initialization, while the BrowserWindow is allowed to
  paint its local shell without waiting for a possible legacy-session profile request. The auth
  IPC waits for restoration before resolving. Only explicit logout removes a valid saved session.
- The renderer receives normalized profile/list values through typed IPC and never receives the access token.
- Public `Page` and `Media` queries power unified search, paginated browse, summaries, title data,
  episode/chapter counts, studios, cast, staff, relations, recommendations, external links, and
  list-entry context.
- `MediaListCollection` is fetched for both anime and manga, preserving status and custom list groups.
- Status, score, progress, notes, “+1” progress, and removal are sent to AniList using authenticated mutations.
- AniList currently documents one-year access tokens and no refresh-token support; an expired or revoked session requires browser authorization again.

The official documentation still described implicit authorization during the 2026-07-27 review, but
the live authenticated authorization request returned `unsupported_grant_type` for
`response_type=token`. AniStream therefore uses the live-supported authorization-code flow. This is
a verified compatibility decision, not an assumption that the documentation has already caught up.

### Verified limits

AniList documents 90 requests/minute normally, with a current degraded-state warning of 30 requests/minute, plus burst limiting. Responses expose rate-limit headers and 429 responses can include retry timing.

### Client strategy

- Start at 25 requests/minute while the degraded warning remains.
- Deduplicate identical in-flight GraphQL operations. Cache public browse/search for two minutes,
  the signed-in dashboard for 30 seconds, viewer-scoped media details for five minutes, Latest
  Anime pages for five minutes, and exact manga-kind hints for 24 hours.
- Persist the last verified dashboard in SQLite. On launch the renderer may show that snapshot
  immediately after the saved account is restored, then refresh it in the background. Successful
  mutations and logout invalidate both memory and SQLite viewer caches.
- Obey response headers over configured defaults.
- On 429, stop the queue until `Retry-After`/reset; do not send speculative retries.
- Keep list mutations serialized and update local state only after confirmed success.
- Latest Anime uses `airingSchedules(sort: TIME_DESC)` in independently cached pages, normalizes at
  most 21 unique titles per UI page, and carries AniList `pageInfo` through the preload bridge.
- Manga publication classification may batch exact AniList IDs and read `countryOfOrigin`; this is
  supplemental metadata and failure falls back to MangaDex's original-language signal.

### Degraded mode

- The last verified SQLite dashboard remains visible when a refresh fails.
- New discovery/search and remote details show an AniList-unavailable state.
- Mutations currently require a live AniList response and surface failure to the user. AniStream
  does not yet claim an offline mutation queue or pending-sync reconciliation.

## MangaDex

| Item                     | Value                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| REST base URL            | `https://api.mangadex.org`                                                               |
| OAuth/token host         | `https://auth.mangadex.org`                                                              |
| MangaDex@Home report URL | `https://api.mangadex.network/report`                                                    |
| Auth                     | Public reads without auth; OAuth 2 personal client for this one-user app                 |
| Credentials              | `MANGADEX_CLIENT_ID`, `MANGADEX_CLIENT_SECRET`, `MANGADEX_USERNAME`, `MANGADEX_PASSWORD` |
| Features                 | Manga metadata, chapter feeds, page delivery, follows/lists, read markers                |
| Official docs            | [MangaDex API documentation](https://api.mangadex.org/docs/)                             |

### Verified limits

- Approximately 5 API requests/second/IP globally.
- `GET /at-home/server/{chapterId}`: 40 requests/minute.
- Persisting after 429 can escalate to a temporary 403 ban and eventually dropped replies.
- Endpoint-specific rate-limit headers expose limits, remaining budget, and retry time.

### Client strategy

- Shared 4 requests/second token bucket for `api.mangadex.org`.
- Public availability mapping searches by AniList title but accepts a result only when MangaDex
  exposes the exact AniList ID in `attributes.links.al`; title similarity is never enough.
- `GET /manga/{id}/aggregate?translatedLanguage[]=<language>` supplies the latest numeric chapter
  currently available in the configured language. Results are cached for 30 minutes.
- Reader feeds page through `GET /chapter` in ascending order with 100-row provider pages and a
  2,000-row application ceiling. AniStream exposes only chapters with positive page counts and no
  `attributes.externalUrl`; externally hosted publisher entries are not MangaDex@Home content.
- Latest Manga requests 21 rows using `order[latestUploadedChapter]=desc` plus `offset`, fetches the
  referenced chapter IDs in one bounded batch for chapter number/publish time, and caches each UI
  page for five minutes.
- Latest covers use MangaDex's cover CDN path at `.512.jpg`, retry the original image URL once on
  failure, send no auth header, and use `no-referrer` in the renderer.
- Publication tags use `attributes.originalLanguage` as the primary Manga/Manhwa/Manhua signal,
  batch exact `attributes.links.al` IDs against AniList country, and consult MAL `media_type` only
  for a maximum of six exact-ID gaps/disagreements per page. No title matching is permitted.
- Separate 35 requests/minute gate for AtHome allocation, in addition to the shared API gate.
- A truthful AniStream `User-Agent` on requests.
- Stop immediately on 429/403 and honor headers/cooldown.
- Use personal-client OAuth only in the main process. Never send auth headers to image hosts.

### MangaDex@Home chapter flow

1. Obtain a chapter ID from the chapter feed after excluding any record with a non-empty
   `attributes.externalUrl`.
2. Call `GET /at-home/server/{chapterId}`.
3. Keep the returned `baseUrl`, chapter hash, and ordered `data`/`dataSaver` filenames for no more than 15 minutes.
4. Construct each URL as `{baseUrl}/{quality}/{hash}/{filename}` using `baseUrl` exactly as returned.
5. Proxy the image through the main process without authentication headers.
6. For third-party MangaDex@Home nodes, report success/failure to the network report endpoint.
7. On an image `404` or `410`, discard the cached node, request a fresh chapter-scoped node, and
   retry exactly once. Other failures are surfaced without speculative retry.

An `/at-home/server/{chapterId}` 404 is treated as an unavailable/external chapter, not retried
aggressively. This distinction was live-verified on 2026-07-30 against a Manga Plus-linked chapter
that reported one page but had no MangaDex@Home allocation.

### Account synchronization

Full MangaDex account sync remains planned for v1, but it is not part of the public adapter.
MangaDex still documents public OAuth clients as unavailable; a one-user personal client requires
an approved client plus username/password authentication and bypasses MFA. Implement it only as an
explicit opt-in after moving every credential and refresh token to macOS Keychain. The local
database remains the UI’s immediate state, while follows and read markers synchronize with
MangaDex. Conflicts must be surfaced rather than blindly overwriting newer remote state.

### Current implementation status

Public title mapping and translated chapter-availability lookup are integrated in the Electron main
process. Continue Reading compares AniList `CURRENT` progress with the latest numeric MangaDex
chapter when an exact mapping exists, so caught-up titles disappear and can return after the
30-minute cache refresh finds a new chapter. The title detail surface pages through the
configured-language chapter archive up to 2,000 rows, filters external publisher links, allocates
MangaDex@Home in the main process, and returns one requested page at a time as a structured-clone
binary `ArrayBuffer` plus MIME type. The renderer creates a short-lived Blob URL instead of paying
the memory/IPC cost of base64. Expired image nodes are refreshed once on `404`/`410`; 18 recent page
buffers and 20 chapter-scoped nodes are bounded in memory for 15 minutes.

The renderer presents a chapter-only detail view and an `AnimatePresence` fullscreen vertical
reader. Local SQLite state stores chapter ID, numeric chapter, scroll ratio, and update time; the
reader checkpoints every eight seconds and on exit. Read resumes that state, advances after 90%,
then falls back to AniList progress or the first available chapter. Pages enter a two-request
viewport queue through `IntersectionObserver`; only the opening/resume neighborhood is prefetched,
and off-screen page containers use `content-visibility`. AniList remains the tracker; MangaDex
account read-marker/follow synchronization is still pending.

The Latest Manga field is a separately paged 21-title grid with chapter timestamps, resilient cover
fallbacks, and Manga/Manhwa/Manhua tags. Translation/group selection and authenticated account
synchronization remain pending.

### Degraded mode

- Cached metadata and local SQLite reading progress remain available.
- New chapter feeds/pages and account synchronization show a provider-unavailable state.
- Local read markers remain pending until a successful sync.

## MyAnimeList supplemental indexing

| Item          | Value                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| REST base URL | `https://api.myanimelist.net/v2`                                                         |
| Auth          | `X-MAL-CLIENT-ID` for the public reads used here                                         |
| Credentials   | `ANISTREAM_MAL_CLIENT_ID`, main-process-only                                             |
| Features      | Supplemental score, Trending fallback, bounded manga publication-kind ambiguity fallback |
| Official docs | [MyAnimeList API v2 reference](https://myanimelist.net/apiconfig/references/api/v2)      |

AniStream joins MAL only through AniList `idMal` or MangaDex `attributes.links.mal`; it never
matches titles. The app uses a conservative 30-requests/minute queue because this review did not
establish a stable official service-wide numeric limit. Score/ranking data is optional. For Latest
Manga, MAL `media_type` is requested only when MangaDex language and AniList country are missing or
disagree, is capped at six IDs per page, and is cached for 24 hours. If MAL is unconfigured or
unavailable, AniList/MangaDex remain functional and the primary MangaDex classification wins.

## Anime video-source adapters

| Item           | Value                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------- |
| Catalog URL    | `https://anikotoapi.site`                                                                 |
| Player origin  | `https://megaplay.buzz`                                                                   |
| Auth           | None documented                                                                           |
| Credentials    | None                                                                                      |
| Config         | `ANISTREAM_ANIKOTO_ENABLED`, `ANISTREAM_ANIKOTO_API_URL`                                  |
| Features       | Recent exact AniList-ID mapping, episode rows, sub/dub embedded playback, progress events |
| Official docs  | [Anikoto API](https://anikotoapi.site/), [MegaPlay API](https://megaplay.buzz/api)        |
| Runtime status | Integrated; replaces AniWatch, Zenshin, AnimeTosho, and Nyaa                              |

### Required adapter interface

A video-source adapter must hide provider IDs, response validation, queues, cooldowns, embed URL
construction, and degraded behavior. Its application interface exposes only:

- normalized episode catalogs;
- normalized embedded playback choices;
- typed unavailable/rate-limited/blocked outcomes.

The native TypeScript contracts are implemented in `src/shared/providers.ts` as the normalized
chain `AnimeTitleMapping → AnimeSeason → AnimeEpisode → AnimeHoster → AnimeVideoVariant`. The active
main-process adapter is `src/main/anikoto.ts`. It validates all untrusted JSON before returning
normalized values through IPC.

### Verified routes and limits

- `GET /recent-anime?page={page}&per_page={count}` returns catalog rows and pagination.
- `GET /series/{id}` returns one `anime` plus `episodes`; each episode may provide
  `episode_embed_id` and sub/dub embed URLs.
- Anikoto publishes 60 requests per IP every 120 seconds. Live responses expose
  `X-RateLimit-Limit`, remaining budget, and reset time.
- MegaPlay documents `/stream/s-2/{episodeEmbedId}/{sub|dub}`,
  `/stream/mal/{malId}/{episode}/{sub|dub}`, and
  `/stream/ani/{aniListId}/{episode}/{sub|dub}`.
- MegaPlay is embed-only and documents `postMessage` events for time, completion, error, and
  watching logs. It does not publish a direct HLS contract.

### Client strategy

- Call Anikoto only from the Electron main process.
- Serialize requests at one every 2.1 seconds, use a 12-second timeout, and make no automatic retry.
- Cache the first 100 recent rows for 15 minutes and up to 100 exact `/series/{id}` responses for
  30 minutes. Deduplicate equal in-flight URLs so concurrent title views share one provider call.
- Stop on 429/403. Honor `Retry-After`/`X-RateLimit-Reset`; otherwise cool down for two minutes on
  429 and ten minutes on 403.
- Accept a provider series only when its normalized `ani_id` exactly matches the requested AniList
  ID. Never map by title similarity.
- The API has no documented full-catalog search route. AniStream does not crawl all catalog pages.
  When a title is absent from the recent page, the episode list comes from AniList and playback uses
  MegaPlay's documented direct AniList-ID route.
- Accept iframe progress only from exact origin `https://megaplay.buzz` and the current iframe
  window. Persist validated time/duration events locally; completion advances AniList.
- The MegaPlay iframe intentionally omits the HTML `sandbox` attribute because the live player
  reported itself blocked when sandboxed. This is an explicit compatibility tradeoff approved on
  2026-07-29. Electron's renderer sandbox, context isolation, denied child windows/external
  navigation, strict HTTPS source validation, and exact `event.origin`/`event.source` checks remain.
- `ANISTREAM_ANIKOTO_ENABLED=0` is the immediate local kill switch. API URL overrides must be HTTPS.

### Embedded player origin

MegaPlay rejected direct requests and iframe requests without an HTTP referrer with its error 410
during the bounded live check. It accepted the documented embed when the referrer was a truthful
loopback HTTP origin. Packaged AniStream therefore serves only its built renderer assets from an
ephemeral `127.0.0.1` port and loads the app from that origin instead of `file://`. This lets the
normal browser iframe request carry AniStream's real local origin; AniStream does not spoof another
website's referrer or extract media URLs. Fingerprinted Vite assets receive immutable one-year
cache headers; `index.html` is never immutable, preventing an update from pointing at stale chunks.

See
[`docs/research/anikoto-megaplay-runtime-2026-07-29.md`](docs/research/anikoto-megaplay-runtime-2026-07-29.md).

### Guardrails

- No source domain, scraper, or endpoint may be added without explicit approval and current research.
- The approved runtime identities are Anikoto for episode data and MegaPlay for embedded playback.
- The removed AniWatch, Zenshin, AnimeTosho, Nyaa, HLS-proxy, and magnet paths must not be restored
  without a new explicit decision.
- Metadata comes from AniList, not the scraped source.
- A source outage disables playback from that adapter but leaves discovery, lists, progress, and manga working.
- Parsing fixtures and contract tests are required because upstream markup will change.
- Never circumvent DRM, paywalls, or access controls.
- Do not redistribute or rehost media.

### Degraded mode

The title, AniList library, episode-number list, and manga features remain usable. A missing
Anikoto series mapping falls back to AniList episode numbers and the direct AniList embed route. If
the embed itself is unavailable, the player reports the provider error and no watched progress is
fabricated.

## MangaBaka manga enrichment

| Item        | Value                                                                                  |
| ----------- | -------------------------------------------------------------------------------------- |
| Base URL    | `https://api.mangabaka.org`                                                            |
| Auth        | None declared for the integrated stable public read route                              |
| Credentials | None                                                                                   |
| Features    | Exact AniList-ID author, artist, publisher, chapter-total, and MangaUpdates enrichment |
| Source      | User-provided MangaBaka OpenAPI document                                               |

AniStream calls stable `GET /v1/source/anilist/{id}` with processed series enabled and raw/internal
responses disabled. It accepts only one active series whose normalized `source.anilist.id` exactly
matches the requested ID, uses a conservative six requests/minute application throttle, and caches
the result for 24 hours. The MangaUpdates source ID/rating may be displayed from MangaBaka's
normalized response; AniStream does not call MangaUpdates directly because the supplied
MangaUpdates specification has no AniList lookup and leaves its identifier/auth relationship
ambiguous.

If MangaBaka is unavailable or the match is ambiguous, the MangaDex reader and AniList metadata
continue normally; only supplemental author/artist/publisher/MangaUpdates fields are omitted.

## MangaUpdates release metadata

| Item          | Value                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Base URL      | `https://api.mangaupdates.com/v1`                                                                                                   |
| Auth          | Public exact-series and scanlation-group reads; release search requires a bearer session according to the supplied OpenAPI document |
| Credentials   | None for the integrated public reads; no MangaUpdates bearer token is stored                                                        |
| Features      | Exact series status/latest chapter and scanlation-group metadata from MangaBaka's canonical MangaUpdates ID                         |
| Official docs | Supplied `openapi.json` (`MangaUpdates API`, version `1.0.0`)                                                                       |

AniStream calls `GET /series/{id}` and `GET /series/{id}/groups` only after MangaBaka has returned
one canonical numeric MangaUpdates ID for the requested AniList title. Responses are normalized in
the main process, cached for 24 hours, and requested through a conservative six-requests-per-minute
gate because the supplied document asks clients to space requests and cache results but does not
publish a numeric service-wide limit.

The documented `POST /releases/search` endpoint is not integrated: its OpenAPI security declaration
requires bearer authentication, and AniStream has no approved MangaUpdates account/session flow.
MangaUpdates does not provide chapter page images in this specification. MangaDex remains the only
page-delivery provider through MangaDex@Home.

## VidKing remote player (optional, explicitly labeled)

| Item          | Value                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Base URL      | `https://www.vidking.net`                                                                                                         |
| Auth          | No API key or OAuth parameter is documented on the reviewed player page; this is not proof that operational controls do not exist |
| Features used | Remote movie/TV iframe, autoplay, next episode, episode selector, parent-window progress events                                   |
| Credentials   | None currently; the renderer must never receive a VidKing credential because none is required by the documented embed examples    |
| Official docs | [VidKing documentation](https://www.vidking.net/#documentation)                                                                   |

### Verified routes and limits

VidKing documents `GET`-style embed URLs for `movie/{tmdbId}` and `tv/{tmdbId}/{season}/{episode}`. The documented query parameters include `color`, `autoPlay`, `nextEpisode`, and `episodeSelector`. The reviewed documentation does not publish a numeric request quota, native anime endpoint, direct HLS API, or AniList-ID mapping.

AniStream therefore treats VidKing as a removable remote-player experiment, not as the primary
anime source. It is not active in the current native player. If it is re-enabled later, it may be
used only when AniList details contain a TMDB external link; AniList title text must never be used
to guess a TMDB ID. A title without a verified mapping must stay in the truthful unavailable state.

The retained iframe bridge accepts only `PLAYER_EVENT` messages from `https://www.vidking.net` and
validates the documented progress/ended signal. VidKing remains an external service; its
availability, source rights, and behavior are not controlled by AniStream.

### Degraded mode

If the iframe fails, has no verified TMDB mapping, or changes its message shape, AniList discovery, lists, ratings, and local progress remain available. AniStream does not fabricate watched progress when no valid playback event was received.

## Parse episode-guide adapter (optional)

| Item             | Value                                                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL         | `https://api.parse.bot`                                                                                                                                                                                              |
| Auth             | `X-API-Key` bearer header                                                                                                                                                                                            |
| Credentials      | `PARSE_API_KEY`, loaded only by the Electron main process                                                                                                                                                            |
| Default scraper  | `57fd33bc-2965-4c61-9741-68e60a184d8b`                                                                                                                                                                               |
| Default endpoint | `get_show_episodes`                                                                                                                                                                                                  |
| Features used    | Episode-guide lookup by normalized show slug                                                                                                                                                                         |
| Official docs    | [Parse introduction](https://docs.parse.bot/introduction), [execution reference](https://docs.parse.bot/api-reference/execute/execute-an-api-endpoint-post), [authentication](https://docs.parse.bot/authentication) |

The user-supplied request uses a `GET` endpoint with `slug` in the query string. Parse's generic current execution reference documents `POST` with endpoint parameters in JSON, so the supplied endpoint method and response fields remain unverified until its generated scraper specification is retrieved with a valid Parse account. AniStream accepts only validated episode-number/title fields from the response and never assumes it contains HLS URLs, subtitles, or stable AniList mappings.

No numeric Parse service-wide rate limit was found in the reviewed official docs. AniStream uses a 20-second timeout and bounds normalized episode results to 500; this is local safety policy, not a provider limit. Parse failures return an unavailable episode-guide state and do not affect AniList or other app surfaces.

Parse is a hosted scraping service. Its use requires separate review of the target site's authorization/terms, account cost, generated-schema drift, and any media redistribution implications. Do not add target-site login credentials, bypass anti-bot controls, or make Parse a load-bearing playback dependency without explicit approval. See [`docs/research/vidking-parse-cineby.md`](docs/research/vidking-parse-cineby.md).

## AniDB

| Item               | Value                                                                   |
| ------------------ | ----------------------------------------------------------------------- |
| Status             | Deferred from v1                                                        |
| HTTP base URL      | `http://api.anidb.net:9001/httpapi`                                     |
| Auth               | Registered HTTP client name/version parameters                          |
| Potential features | Optional ID mapping and niche anime enrichment                          |
| Official docs      | [AniDB HTTP API definition](https://wiki.anidb.net/HTTP_API_Definition) |

AniDB is not a primary dependency. If enabled later, it requires a registered client, at most one request every 2.5 seconds as an application policy, at least 24-hour per-anime caching, no HTML scraping, and a kill switch.

## Discovery-index candidates

The `public-apis` list is not a runtime dependency. Jikan is alive and documents 3 requests/second and 60/minute, but it scrapes MyAnimeList and duplicates AniList’s role. Kitsu also duplicates the primary catalog and publishes no numeric rate limit in the reviewed docs. Neither belongs in v1 without a concrete data gap.

## Evaluated provider frameworks

### Consumet

| Item            | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Status          | Rejected as a runtime dependency or hosted API; architecture reference only    |
| Public API      | Withdrawn; the historical project requires self-hosting                        |
| Package         | `@consumet/extensions` — not approved for installation in AniStream            |
| Role considered | Scraped anime/manga provider framework                                         |
| Research        | [`docs/research/consumet-evaluation.md`](docs/research/consumet-evaluation.md) |

Consumet is a scraper/extractor collection rather than an authoritative anime or manga database. Its public API is no longer available, and the two core GitHub repositories were named in a March 2026 DMCA notice and were unavailable to fresh clones during verification. The published package also has unresolved license metadata: npm declares MIT while cached GitHub repository pages identify GPL-3.0.

AniStream may adapt Consumet's general provider-interface pattern, but must not use `api.consumet.org`, self-host the historical API, install `@consumet/extensions`, or copy its provider code unless a later review confirms restored authoritative source, an unambiguous license, active maintenance, and acceptable provider-specific behavior.

### Aniyomi

| Item            | Value                                                                        |
| --------------- | ---------------------------------------------------------------------------- |
| Status          | Architecture and product-behavior reference only                             |
| Runtime         | Kotlin/Android; not compatible with Electron plug-in loading                 |
| Extensions      | Android APKs from user-supplied repositories                                 |
| Role considered | Source contracts, local library, migration, reader/player behavior           |
| Research        | [`docs/research/aniyomi-evaluation.md`](docs/research/aniyomi-evaluation.md) |

AniStream will adapt Aniyomi's separation of manga details/chapters/pages from anime seasons/episodes/hosters/video variants, plus its source migration and local-media patterns. It will not load Aniyomi APK extensions or trust unofficial extension catalogs. The official Aniyomi extension list was removed, and Aniyomi now describes a bring-your-own-content model.
