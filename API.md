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
7. On failure, report it and request a new node.

### Account synchronization

Full MangaDex account sync is in v1. The local database remains the UI’s immediate state, while follows and read markers synchronize with MangaDex. Conflicts must be surfaced rather than blindly overwriting newer remote state.

### Degraded mode

- Cached metadata, downloaded page cache, and local reading progress remain available.
- New chapter feeds/pages and account synchronization show a provider-unavailable state.
- Local read markers remain pending until a successful sync.

## Anime video-source adapters

| Item                   | Value                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Strategy               | Scraped/aggregator adapters similar to Zenshin                                            |
| Primary target         | AnimePahe-style HLS extraction                                                            |
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
`AnimeSourceAdapter` boundary. No provider implementation or scraped domain is connected yet, so
the Watch surface reports a truthful unavailable state.

### Guardrails

- No source domain, scraper, or endpoint may be added without explicit approval and current research.
- The three approved target identities are AnimePahe, AnimeTosho, and Nyaa. Their current domains, request shapes, cookies, and extraction behavior must be re-verified immediately before implementation.
- A different or replacement target still requires explicit user approval.
- Metadata comes from AniList, not the scraped source.
- A source outage disables playback from that adapter but leaves discovery, lists, progress, and manga working.
- Parsing fixtures and contract tests are required because upstream markup will change.
- Never circumvent DRM, paywalls, or access controls.
- Do not redistribute or rehost media.

### Degraded mode

The title and library remain fully usable. Playback reports that the selected source is unavailable and may offer another approved adapter when one exists. Progress changes are not fabricated when playback never started.

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
