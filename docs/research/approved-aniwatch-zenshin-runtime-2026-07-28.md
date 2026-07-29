# Approved Aniwatch/Zenshin runtime research

**Verified:** 2026-07-28  
**Scope:** Research only. No scraper implementation was copied and no AniStream application code,
`API.md`, or `CONTEXT.md` was changed.

The user explicitly approved using `codex0555/Aniwatch-Api` and Zenshin-style scraped/aggregator
sources and accepted their legal, terms-of-service, reliability, and maintenance risks. That approval
changes AniStream's product decision boundary; it does not make an unavailable provider operational
or grant a license to copy unlicensed code.

## Executive finding

- **Aniwatch public API:** deployed and answering requests, but not usable for playback in the
  bounded check. Search returned an empty result for a documented title, episode and server requests
  timed out after 25 seconds, and source resolution returned HTTP 500.
- **Zenshin mapping API:** both documented mirrors were healthy and returned a useful exact
  AniList-ID episode mapping. It can supply season/episode titles, descriptions, runtime, images, and
  cross-site IDs. It does not resolve video streams.
- **Manga enrichment:** MangaBaka provides a stable exact AniList-ID route. MangaUpdates provides a
  rich series-by-ID route but no AniList-ID lookup in the supplied OpenAPI document.

## Bounded live checks

Only the following representative requests were made:

1. One Aniwatch search request.
2. One request at each remaining documented Aniwatch stage: episodes, servers, and source.
3. One exact AniList-ID mapping request against each Zenshin mirror.

No endpoint was polled or load-tested.

## `codex0555/Aniwatch-Api`

### Repository and deployment

| Item                | Verified fact                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository          | [`codex0555/Aniwatch-Api`](https://github.com/codex0555/Aniwatch-Api)                                                                             |
| Inspected commit    | `9aebe4a57d70b3fe7e04bdb978a450991239a987`, dated 2024-07-31                                                                                      |
| Documented base URL | `https://aniwatch-api-v1-0.onrender.com/api`                                                                                                      |
| License             | No `LICENSE` or `COPYING` file exists in the repository.                                                                                          |
| Implementation      | Express/Axios/Cheerio routes scrape `aniwatchtv.to`; source resolution then targets MegaCloud.                                                    |
| Maintenance signal  | Open issue [#6](https://github.com/codex0555/Aniwatch-Api/issues/6), filed 2026-03-22, reports the same source-resolution HTTP 500 observed here. |

### Documented and implemented pipeline

The repository describes this unauthenticated `GET` sequence:

```text
/search/:query/:page
  -> /episode/:animeId
  -> /server/:episodeId
  -> /src-server/:sourceId
```

The success contracts in the README/source are:

```json
{
  "nextpageavailable": true,
  "searchYour": [
    {
      "name": "Your Name",
      "jname": "Kimi no Na wa.",
      "format": "Movie",
      "duration": "106m",
      "idanime": "your-name-10",
      "sub": "1",
      "dubani": "1",
      "totalep": false,
      "img": "https://…",
      "pg": false
    }
  ]
}
```

```json
{
  "episodetown": [
    {
      "order": "1",
      "name": "Episode title",
      "epId": "hunter-x-hunter-128?ep=3661"
    }
  ]
}
```

```json
{
  "sub": [{ "server": "megacloud", "id": "1", "srcId": "411986" }],
  "dub": [{ "server": "megacloud", "id": "1", "srcId": "2720" }]
}
```

The README documents `serverSrc`, but the current route implementation actually returns:

```json
{
  "restres": {
    "tracks": [],
    "intro": { "start": 0, "end": 0 },
    "outro": { "start": 0, "end": 0 },
    "sources": [{ "url": "https://…/master.m3u8", "type": "hls" }]
  }
}
```

That contract mismatch is a verified source-level fact.

### Live observations

| Request                            | Result on 2026-07-28                                   |
| ---------------------------------- | ------------------------------------------------------ |
| `GET /search/your%20name/1`        | HTTP 200, `{"nextpageavailable":null,"searchYour":[]}` |
| `GET /episode/hunter-x-hunter-128` | No response bytes before the 25-second client timeout  |
| `GET /server/ep=3662`              | No response bytes before the 25-second client timeout  |
| `GET /src-server/636137`           | HTTP 500, `{"error":"Internal Server Error"}`          |

The deployment sent `Access-Control-Allow-Origin: *` on the completed search and source responses. It
published no rate-limit headers, cache policy, version/SLA, or stability guarantee.

### HLS headers, referrer, and CORS

**Verified source behavior:** the resolver calls MegaCloud's source endpoint with `Referer`,
`X-Requested-With`, and browser-like headers. It returns only each final source's `url` and `type`;
it does not proxy the HLS manifest or segments and does not return playback-request headers.

**Not verified:** because source resolution failed, no current manifest or segment URL could be
tested. Therefore manifest CORS, segment CORS, token lifetime, required `Origin`/`Referer`, cookies,
and redirect behavior are unknown.

**Recommendation:** do not hand an unverified source URL directly to the renderer. Any future adapter
should remain main-process-owned and disabled by a kill switch. After a source succeeds, inspect the
manifest and one segment with bounded requests. If either requires headers or lacks compatible CORS,
use a narrowly allow-listed Electron protocol/main-process proxy that forwards only verified
provider hosts and required headers. The API's permissive CORS header does not make a different HLS
origin browser-playable.

### Reliability and licensing assessment

- Search, episode, and server routes have no outbound timeout and several catch blocks log without
  sending an error response. The observed client timeouts are consistent with that implementation.
- Source extraction regexes a remote player script and decrypts a provider-specific payload. This is
  fragile by design and is already failing.
- There are no tests, response validators, rate-limit controls, or provider abstraction.
- With no repository license, AniStream must not copy the implementation. A clean-room client for
  the documented public HTTP contract is the only acceptable reuse boundary.

**Recommendation:** the public deployment should be considered **currently unhealthy for
playback**. The user's risk approval supports an opt-in, replaceable adapter, but implementation
should require a configurable base URL so a repaired/self-hosted compatible service can replace the
broken public deployment. Discovery, tracker sync, manga, and torrent fallback must remain
independent.

## Zenshin and `zenshin-API`

### Repository status

| Item                  | Verified fact                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zenshin branch        | [`hitarth-gg/zenshin` `tosho-update`](https://github.com/hitarth-gg/zenshin/tree/tosho-update), commit `9ee5f0cb2e64563d1b5a51e3f8c5aa8595d6dc75`, dated 2026-05-25 |
| Zenshin license       | GPL-3.0                                                                                                                                                             |
| Mapping repository    | [`hitarth-gg/zenshin-API`](https://github.com/hitarth-gg/zenshin-API), commit `e3243de91fee0012918d037dc054cc69f15fdf7a`, dated 2026-07-18                          |
| Mapping-repo contents | README plus database dumps/examples; the deployed service implementation is not present.                                                                            |
| Mapping-repo license  | No license file is present. Do not redistribute its dumps without permission.                                                                                       |

Zenshin keeps AniList metadata, episode mappings, and media acquisition separate. Its renderer calls
the mapping service by AniList ID, turns the `episodes` object into episode cards, then uses AniDB
anime/episode IDs to query its separate torrent source. The mapping API is not a streaming API.

### Current endpoints and health

The current mapping README documents two mirrors:

- `https://zenshin-supabase-api.onrender.com`
- `https://zenshin-supabase-api-myig.onrender.com`

Both returned HTTP 200 for:

```text
GET /mappings?anilist_id=170942
```

The two bodies were the same size and contained the same 29 episode records. Completed responses
included `Access-Control-Allow-Origin: *`, but no explicit cache-control or rate-limit headers.

The current top-level response shape is:

```json
{
  "mainTitle": "Ao no Hako",
  "title": { "main": "Ao no Hako", "en": "Blue Box", "ja": "アオのハコ" },
  "date": { "startDate": "2024-10-03", "endDate": null },
  "episodes": {
    "1": {
      "episode": "1",
      "anidbEid": "286674",
      "type": "Regular Episode",
      "length": "25m",
      "airdate": "2024-10-03",
      "title": { "en": "Chinatsu Senpai" },
      "nameTvdb": "Chinatsu Senpai",
      "seasonNumber": 1,
      "episodeNumber": 1,
      "absoluteEpisodeNumber": 1,
      "runtime": 24,
      "overview": "…",
      "image": "https://artworks.thetvdb.com/…",
      "airDate": "2024-10-03"
    }
  },
  "mappings": {
    "anilist_id": 170942,
    "mal_id": 57181,
    "anidb_id": 18278,
    "tvdb_id": 429934,
    "themoviedb_id": 207347,
    "season": "fall",
    "type": "TV"
  }
}
```

The live property is `title` (singular). Some older Zenshin client code checks `titles` (plural), so
AniStream must validate the live contract rather than copy that client assumption. Non-regular keys
such as `OP1` and specials may appear beside numeric episodes.

The README says data is generally refreshed every two days and warns that hosted Supabase egress is
limited. It explicitly asks clients to cache and avoid repeated requests.

**Recommendation:** Zenshin is suitable as optional episode-detail enrichment keyed by exact AniList
ID. Use mirror failover, strict parsing, a long bounded cache (24–48 hours is reasonable given the
documented update cadence), and separate regular episodes from specials/openings. Do not treat it as
the source of playback URLs, and do not import its GPL application code or unlicensed database
dumps.

## MangaBaka and MangaUpdates exact-ID enrichment

This section is based only on the user-provided OpenAPI files:

- `/Users/allanmathewjohn/Downloads/api-1.json` — MangaBaka API 1.0
- `/Users/allanmathewjohn/Downloads/openapi.json` — MangaUpdates API 1.0.0

### MangaBaka

Base URL: `https://api.mangabaka.org`

The supplied document labels this route stable:

```text
GET /v1/source/anilist/{id}
```

It accepts an AniList numeric ID and defaults to `with_series=true`. Optional flags include
`with_internal`, `with_merged_series`, and `with_source_response`. The normalized `series` items
include MangaBaka ID/state, titles, description, cover, type, status, year, authors/artists,
publishers, genres/tags, ratings/popularity, total chapters, relationships, links, and per-source
IDs/ratings.

Most importantly, the normalized source object includes:

```json
{
  "source": {
    "anilist": { "id": 85737, "rating": 8.8 },
    "manga_updates": { "id": "3qzxncc", "rating": 7.65 }
  }
}
```

Useful exact follow-up routes are:

```text
GET /v1/series/{mangabakaId}
GET /v1/series/{mangabakaId}/full
GET /v1/series/{mangabakaId}/links
GET /v1/source/manga-updates/{mangaUpdatesId}
```

The MangaBaka document has no global security requirement and these `GET` operations do not declare
route authentication. It defines API-key/OIDC schemes for protected features, but not for the
routes above.

### MangaUpdates

Base URL: `https://api.mangaupdates.com/v1`

The supplied document provides:

```text
GET /series/{id}
```

Its `SeriesModelV1` includes title, description, type/year/status, authors, publishers, genres,
categories, Bayesian rating/votes, latest chapter, completion/licensing state, relations,
recommendations, ranking/list counts, and last-updated time.

There is no AniList-ID route in this OpenAPI document. It declares `/series/{id}` as an integer ID,
while MangaBaka's normalized MangaUpdates source ID is an opaque string. Those identifiers must not
be assumed interchangeable. The OpenAPI description says most functions are public, but the
document also declares a global bearer requirement and does not explicitly override it on this
`GET`; authentication is therefore ambiguous from the supplied file. Release search is explicitly
bearer-authenticated.

**Recommendation:** use MangaBaka's exact AniList-ID route as the safe enrichment entry point. Do
not title-match. Prefer MangaBaka's normalized series data. Use direct MangaUpdates
`GET /series/{id}` only after a canonical numeric MangaUpdates API ID and its authentication behavior
have been independently verified. MangaBaka's `with_source_response=true` may expose upstream data,
but its own schema warns that the raw response has no stability guarantee.

## Recommended AniStream boundary

1. Adopt Zenshin mapping as optional, cached episode metadata keyed by exact AniList ID.
2. Keep Aniwatch behind an explicit enable flag, configurable base URL, strict validators, short
   timeouts, circuit breaker, and immediate fallback. The public deployment is not a working HLS
   source as of this check.
3. Treat all Aniwatch IDs as provider-local; never infer an AniList identity from a title-only match
   without user confirmation.
4. Resolve and test HLS manifests/segments in the trusted main process before exposing a playback
   handle to the renderer.
5. Use MangaBaka's exact AniList mapping for manga enrichment. Keep AniList as metadata/tracker
   authority and MangaDex as chapter/image authority.

## Sources

- [Aniwatch API repository and README](https://github.com/codex0555/Aniwatch-Api)
- [Aniwatch source-resolution issue #6](https://github.com/codex0555/Aniwatch-Api/issues/6)
- [Zenshin `tosho-update` branch](https://github.com/hitarth-gg/zenshin/tree/tosho-update)
- [Zenshin mapping API repository/README](https://github.com/hitarth-gg/zenshin-API)
- Live bounded requests described above, performed 2026-07-28
- User-provided MangaBaka and MangaUpdates OpenAPI documents listed above
