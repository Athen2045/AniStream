# MangaDex runtime evaluation

Verified: 2026-07-28  
Scope: AniStream public manga metadata and chapter-availability adapter

## Conclusion

**Recommendation: proceed with a public, read-only MangaDex adapter.** It is a reasonable dependency
for a single-user macOS application when AniList remains the catalog/tracker authority and MangaDex is
treated as a removable source of MangaDex metadata, chapter availability, and reader pages.

Do **not** make MangaDex account sync a prerequisite for this adapter. Public reads need no account,
but MangaDex still documents public OAuth clients as unavailable. Account follows/read markers
therefore require a personal client tied to one MangaDex account, including the account username and
password flow. That is compatible with AniStream's one-user scope, but it is a separate,
security-sensitive opt-in feature—not a condition for public search or reading.

The minimum production posture is: exact AniList-ID mapping when available, conservative throttling,
main-process proxying, short-lived MangaDex@Home allocations, and a degraded state that never breaks
AniList discovery or local reading history.

## Evidence boundaries

- **Verified fact** means confirmed from a first-party MangaDex source during this review.
- **Project live evidence** means the user live-verified public title search,
  `attributes.links.al` exact matching, and the aggregate endpoint on 2026-07-28. These checks support
  runtime viability but are not substitutes for the published contract.
- This review was stopped at the user's request before every OpenAPI field could be independently
  re-read. The report therefore lists the stable, relevant query surface and avoids claiming an
  exhaustive parameter inventory.

## Verified facts

### Hosts and current status

- Production REST API: `https://api.mangadex.org`.
- Development REST API: `https://api.mangadex.dev`; its allowance is independent from production.
- Authentication host: `https://auth.mangadex.org`; personal-client tokens are issued at
  `/realms/mangadex/protocol/openid-connect/token`.
- MangaDex@Home page hosts are dynamic. The client must use the `baseUrl` returned for a chapter,
  rather than hardcoding a CDN host.
- On 2026-07-28, `GET https://api.mangadex.org/ping` returned HTTP 200 and `pong`.
- The official status summary reported **All Systems Operational**, with Website, API, CDN Core, and
  MangaDex@Home all operational and no active incidents. This is a point-in-time health signal, not
  an uptime guarantee.

Sources: [official API documentation repository](https://gitlab.com/mangadex-pub/mangadex-api-docs),
[official limitations and host requirements](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/2-limitations.md),
[official status page](https://status.mangadex.org/),
[official machine-readable status summary](https://status.mangadex.org/api/v2/summary.json).

### Public manga lookup and AniList mapping

- Manga collection lookup is `GET /manga`. The useful public search surface includes title search,
  IDs, author/artist IDs, year, publication status, original/available translation languages,
  demographic, content rating, included/excluded tags and tag-match mode, ordering, relationship
  includes, limit, and offset.
- Public title search was live-verified by the user on 2026-07-28.
- Manga `attributes.links` uses short external-database keys. The official enumeration defines `al`
  as AniList and says its value is stored as the AniList manga ID.
- The user also live-verified an exact `attributes.links.al` match.

Sources: [official manga search guide](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/03-manga/search.md),
[official MangaDex enumerations](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/3-enumerations.md).

### Chapter availability, feeds, and pagination

- The manga feed is `GET /manga/{mangaId}/feed`.
- Relevant feed controls include translated-language and content-rating filters, scanlation
  group/uploader exclusions, external/future/empty-page inclusion controls, relationship includes,
  ordering, limit, and offset.
- Chapter ordering supports `createdAt`, `updatedAt`, `publishAt`, `readableAt`, `volume`, and
  `chapter`, each ascending or descending. The documented default for those chapter order keys is
  ascending.
- Collection endpoints are offset-paginated. The official limitations page says requests beyond
  `offset + size > 10,000` are rejected and that collection page sizes are typically capped at 100,
  with a few feed endpoints allowing 500.
- `GET /manga/{id}/aggregate` provides volume/chapter availability structure and was live-verified by
  the user. Aggregate data is suitable for availability/navigation hints; the feed remains the source
  for concrete chapter resources and translations.

Sources: [official chapter-feed guide](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/04-chapter/feed.md),
[official chapter search guide](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/04-chapter/search.md),
[official enumerations](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/3-enumerations.md),
[official limitations](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/2-limitations.md).

### MangaDex@Home page flow

1. Select a concrete chapter resource from the manga feed.
2. Request `GET /at-home/server/{chapterId}`.
3. Keep the returned `baseUrl`, chapter hash, and ordered `data`/`dataSaver` filename arrays only for
   the allocation's short valid window.
4. Build each page URL as
   `{baseUrl}/data/{hash}/{filename}` or
   `{baseUrl}/data-saver/{hash}/{filename}`.
5. Fetch pages through AniStream's trusted main process. Do not hotlink them from the renderer and do
   not attach MangaDex authorization headers to image hosts.
6. Follow the current MangaDex@Home reporting contract for served/failed requests and reacquire a
   node after an allocation or node failure.

MangaDex explicitly says cross-origin API responses are not provided for third-party websites and
hotlinked images receive the wrong response; clients must proxy requests. It also says auth headers
must never be sent to `*.mangadex.network` or `uploads.mangadex.org`.

Sources: [official chapter retrieval guide](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/04-chapter/retrieving-chapter.md),
[official authentication overview](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/02-authentication/index.md),
[official limitations](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/2-limitations.md).

### Required headers and rate limits

- Requests **must** carry a truthful `User-Agent` and must not carry a `Via` header.
- The global production API allowance is approximately **5 requests/second/IP**. MangaDex calls this
  a guaranteed minimum rather than an exact ceiling.
- `GET /at-home/server/{id}` has an additional limit of **40 requests/minute**.
- `POST /chapter/{id}/read` has an additional limit of **300 requests/10 minutes**.
- Endpoint-specific responses expose `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
  `X-RateLimit-Retry-After`; the latter is the period-end UNIX timestamp.
- Continuing after HTTP 429 can trigger an undocumented temporary IP-wide HTTP 403 ban. Continuing
  after that can cause replies to be dropped, with every request extending the cooldown.
- MangaDex may apply undocumented restrictions to abusive/redundant request patterns.

Source: [official limitations and rate-limit policy](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/2-limitations.md).

### Authentication and account-sync caveats

- Public API clients using authorization-code OAuth are documented as **not yet available**.
- Personal clients are restricted to the MangaDex account that owns the client.
- A personal client must be registered in MangaDex settings and approved before use.
- Personal authentication uses an OAuth password grant with username, password, client ID, and client
  secret as `application/x-www-form-urlencoded`.
- The documented access-token lifetime is 15 minutes; a refresh token obtains replacement access
  tokens.
- MangaDex warns that the personal flow is less secure and bypasses the account's multi-factor
  settings.
- Auth headers should be sent only where needed because authenticated responses cannot be cached.

Sources: [official authentication overview](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/02-authentication/index.md),
[official public-client status](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/02-authentication/public-clients.md),
[official personal-client guide](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/02-authentication/personal-clients.md).

### Stability and maintenance evidence

- The API and MangaDex@Home were operational in the official status system at review time.
- The first-party documentation repository remains maintained: its visible history includes
  documentation/tooling updates during 2025–2026 and an API-spec update proposed for v5.13.1 in 2025.
- The official docs include explicit abuse controls, pagination ceilings, authentication guidance,
  and MangaDex@Home procedures, which is sufficient to design a bounded adapter.

This evidence supports active operation and maintenance. It does **not** guarantee endpoint
availability, schema immutability, chapter completeness, or permanent access to any individual title.

Sources: [official status page](https://status.mangadex.org/),
[official docs repository history](https://gitlab.com/mangadex-pub/mangadex-api-docs),
[official v5.13.1 specification merge request](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/merge_requests/79).

## Recommendations for AniStream

### Confidence-checked AniList → MangaDex mapping

1. Search MangaDex using AniList title variants and narrow by year/original language when useful.
2. Accept a mapping automatically only when exactly one candidate has
   `String(attributes.links.al) === String(anilistMediaId)`.
3. If zero candidates match, leave the title unmapped or ask for manual selection. Title/year
   similarity may rank candidates but must not silently establish identity.
4. If multiple candidates contain the same AniList ID, treat the result as ambiguous and ask for
   manual selection.
5. Persist the accepted AniList ID, MangaDex UUID, mapping method, and verification timestamp.
   Revalidate if MangaDex returns 404/410 or materially different metadata.

### Runtime policy

- Use one shared main-process queue capped at **4 requests/second**, leaving headroom below the
  documented approximate global allowance.
- Use a separate AtHome allocator budget of **35/minute**.
- Deduplicate identical searches/feeds, cache public metadata, and avoid auth headers for public reads.
- Stop the entire MangaDex queue on 429 and wait through `X-RateLimit-Retry-After`; stop on 403 rather
  than probing the ban.
- Cancel stale searches, bound retries, and never paginate toward the 10,000-result ceiling without
  narrowing filters.
- Validate every remote response at the adapter boundary and keep MangaDex DTOs out of shared UI
  contracts.

### Account sync

Implement public search, chapter feeds, aggregate availability, and page reading first. Treat account
follows/read markers as a later opt-in module requiring:

- an approved personal MangaDex client;
- username/password/client secret stored only in macOS Keychain;
- refresh-token rotation and explicit logout/revocation handling;
- serialized read-marker writes and reconciliation with AniStream's local state;
- clear disclosure that MangaDex's current personal-client flow bypasses MFA.

AniStream should not imply “Continue Reading from MangaDex account” until that authenticated path has
been live-tested. AniList `READING` state can continue to drive the product rail independently.

## Degraded behavior and risks

- API/search unavailable: show cached AniList metadata and a MangaDex-unavailable message; do not
  block Manga, Profile, or local reading history.
- Feed unavailable: keep the mapped title but report chapter availability as unknown, not zero.
- MangaDex@Home unavailable: preserve chapter metadata and retry only after cooldown/node
  reacquisition; never mark a chapter read merely because page loading began.
- Account auth unavailable: public reading still works; queue local read state with an explicit
  pending-sync marker.
- Mapping absent/ambiguous: require manual confirmation; never select by title alone.
- Removed/external/unavailable chapters, duplicate scanlations, delayed publication times, language
  variants, and missing chapter numbers must be represented explicitly.
- Shared VPN/proxy IP traffic can consume the same rate allowance.
- MangaDex is a non-profit service with limited infrastructure and may add undocumented anti-abuse
  limits. The adapter must remain replaceable and must not become AniStream's sole metadata source.

## Decision

**Go for the public adapter:** public metadata, exact AniList-ID mapping, aggregate availability,
chapter feeds, and MangaDex@Home reading are appropriately scoped and operationally reasonable for
AniStream.

**Conditional go for account sync:** technically possible for this one-user app through an approved
personal client, but defer it behind explicit credential setup and Keychain-backed implementation.
Public authorization-code OAuth cannot currently be promised from MangaDex's published documentation.
