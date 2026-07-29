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
- The encrypted session contains the access token plus a normalized profile snapshot. AniStream
  restores this before creating the renderer, so normal launches do not show the connection screen
  or depend on a successful startup request. Only explicit logout removes a valid saved session.
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
- Deduplicate identical in-flight GraphQL operations and cache bounded view data.
- Obey response headers over configured defaults.
- On 429, stop the queue until `Retry-After`/reset; do not send speculative retries.
- Keep list mutations serialized and update local state only after confirmed success.

### Degraded mode

- Previously cached/local library data remains visible and editable with a pending-sync marker.
- New discovery/search and remote details show an AniList-unavailable state.
- Queue user-owned mutations locally and require an explicit retry/reconciliation step; never silently discard them.

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
- Separate 35 requests/minute budget for AtHome allocation.
- A truthful AniStream `User-Agent` on requests.
- Stop immediately on 429/403 and honor headers/cooldown.
- Use personal-client OAuth only in the main process. Never send auth headers to image hosts.

### MangaDex@Home chapter flow

1. Obtain a chapter ID from the chapter feed.
2. Call `GET /at-home/server/{chapterId}`.
3. Keep the returned `baseUrl`, chapter hash, and ordered `data`/`dataSaver` filenames for no more than 15 minutes.
4. Construct each URL as `{baseUrl}/{quality}/{hash}/{filename}` using `baseUrl` exactly as returned.
5. Proxy the image through the main process without authentication headers.
6. For third-party MangaDex@Home nodes, report success/failure to the network report endpoint.
7. On an image `404` or `410`, discard the cached node, request a fresh chapter-scoped node, and
   retry exactly once. Other failures are surfaced without speculative retry.

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
30-minute cache refresh finds a new chapter. The title detail surface also loads the newest 100
configured-language chapters, allocates MangaDex@Home in the main process, and returns one requested
page at a time as a renderer-safe data URL. Expired image nodes are refreshed once on `404`/`410`.
Full archive paging/translation selection and authenticated account synchronization remain pending.

### Degraded mode

- Cached metadata, downloaded page cache, and local reading progress remain available.
- New chapter feeds/pages and account synchronization show a provider-unavailable state.
- Local read markers remain pending until a successful sync.

## Anime video-source adapters

| Item                   | Value                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Strategy               | Scraped/aggregator adapters similar to Zenshin                                            |
| Primary target         | Configurable AniWatch-compatible API returning direct HLS variants                        |
| Fallback targets       | AnimeTosho and Nyaa torrent indexes                                                       |
| Playback order         | HLS first; torrent fallback when HLS is unavailable or has no suitable variant            |
| Auth/cookies           | Provider-specific; must remain in the main process                                        |
| Features               | Search/mapping, episode availability, stream variants, subtitles, playback URL resolution |
| Architecture reference | [Zenshin `tosho-update`](https://github.com/hitarth-gg/zenshin/tree/tosho-update)         |

### Required adapter interface

A video-source adapter must hide site-specific IDs, HTML parsing, cookies, Cloudflare handling, embeds, and URL extraction. Its application interface should expose only:

- source health/capabilities;
- title mapping/search candidates;
- episode availability;
- resolved, short-lived playback variants;
- typed failures such as unavailable, blocked, changed markup, or authentication required.

The native TypeScript contracts are implemented in `src/shared/providers.ts` as the normalized
chain `AnimeTitleMapping → AnimeSeason → AnimeEpisode → AnimeHoster → AnimeVideoVariant`, plus the
`AnimeSourceAdapter` boundary. The installed main-process fallback uses Nyaa RSS and AnimeTosho JSON
feeds only to discover normalized magnet URIs; it never downloads, seeds, proxies, or exposes a
provider URL to the renderer. Selecting a release explicitly opens the user's macOS torrent handler.

The user explicitly approved and accepted the risk of `codex0555/Aniwatch-Api` and Zenshin-style
scraped playback on 2026-07-28. AniStream now clean-room implements the documented public HTTP
contract; it does not copy the unlicensed scraper. HLS manifests, nested playlists, encryption-key
URIs, initialization maps, and media segments are exposed through short-lived
`anistream-media://` handles and fetched by the trusted main process. SQLite stores the most recent
episode, position, duration, and timestamp for Continue Watching.

The public AniWatch deployment was online but unhealthy in the bounded implementation check:
search returned an empty catalog, episode/server calls timed out, and source resolution returned
HTTP 500. The adapter therefore remains configurable and kill-switchable and truthfully degrades to
torrents. AnimeTosho's official News Archive says new torrents ceased on 2026-05-09, so its feed is
retained only as a degrading historical index while Nyaa remains the active fallback. See
[`docs/research/approved-aniwatch-zenshin-runtime-2026-07-28.md`](docs/research/approved-aniwatch-zenshin-runtime-2026-07-28.md).

### AniWatch-compatible HLS API

| Item        | Value                                                                                |
| ----------- | ------------------------------------------------------------------------------------ |
| Default URL | `https://aniwatch-api-v1-0.onrender.com`                                             |
| Auth        | None documented                                                                      |
| Credentials | None                                                                                 |
| Config      | `ANISTREAM_ANIWATCH_ENABLED`, `ANISTREAM_ANIWATCH_API_URL`                           |
| Features    | Exact-title mapping, episode IDs, sub/dub hosters, direct HLS variants and subtitles |
| Source      | [`codex0555/Aniwatch-Api`](https://github.com/codex0555/Aniwatch-Api)                |

The documented sequence is
`GET /api/search/{query}/{page}` → `GET /api/episode/{id}` →
`GET /api/server/{episodeId}` → `GET /api/src-server/{sourceId}`. The README documents
`serverSrc[].rest[].file`; current source returns `restres.sources[].url`. AniStream strictly accepts
both observed shapes, HTTPS HLS URLs only, and bounded subtitle tracks. It makes at most 12
requests/minute as a conservative app policy, uses eight-second request timeouts, pauses five
minutes on 429/403, caches episode catalogs for ten minutes, and never retries aggressively.

No provider limit, SLA, or cache policy is published. The public deployment must not be treated as
reliable. Set `ANISTREAM_ANIWATCH_ENABLED=false` to disable it immediately. A compatible repaired or
self-hosted service can be selected with `ANISTREAM_ANIWATCH_API_URL`; localhost HTTP is accepted for
development, while non-local replacements require HTTPS.

### Zenshin episode mapping

| Item     | Value                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- |
| Mirrors  | `https://zenshin-supabase-api.onrender.com`, `https://zenshin-supabase-api-myig.onrender.com` |
| Auth     | None documented                                                                               |
| Config   | `ANISTREAM_ZENSHIN_API_URL` for a preferred mirror                                            |
| Features | Exact AniList-ID season/episode titles, summaries, runtime, artwork, and cross-site IDs       |
| Source   | [`hitarth-gg/zenshin-API`](https://github.com/hitarth-gg/zenshin-API)                         |

AniStream calls `GET /mappings?anilist_id={id}`, accepts numeric regular-episode keys only, groups
them by `seasonNumber`, and caches the normalized catalog for 24 hours. It tries at most four
requests/minute as an application policy and fails over between the two documented mirrors. Zenshin
does not provide HLS URLs; it enriches the episode drawer only.

### Guardrails

- No source domain, scraper, or endpoint may be added without explicit approval and current research.
- The approved runtime identities are an AniWatch-compatible HLS API plus AnimeTosho/Nyaa torrent
  indexes. Zenshin is approved for episode metadata only. Their current domains and response shapes
  must be re-verified before claiming live playback.
- A different or replacement target still requires explicit user approval.
- Metadata comes from AniList, not the scraped source.
- A source outage disables playback from that adapter but leaves discovery, lists, progress, and manga working.
- Parsing fixtures and contract tests are required because upstream markup will change.
- Never circumvent DRM, paywalls, or access controls.
- Do not redistribute or rehost media.

### Degraded mode

The title and library remain fully usable. Playback reports that the selected source is unavailable and may offer another approved adapter when one exists. Progress changes are not fabricated when playback never started.

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
