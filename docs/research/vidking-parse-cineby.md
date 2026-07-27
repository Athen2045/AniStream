# VidKing, Parse, and Cineby research

Research date: 2026-07-27  
Scope: official VidKing and Parse documentation, a read-only inspection of the supplied Cineby site, and the AniList documentation needed for progress, score, and list mutations. No application code was changed.

## Executive conclusion

**Recommendation: do not add VidKing or Parse to AniStream’s approved playback chain yet.** VidKing is a convenient remote iframe player with TV/movie routes, configurable player controls, and parent-window progress events. The reviewed documentation does not expose a native anime catalog, a direct HLS API, an authentication model, or numeric request limits. Parse is a general hosted website-to-API scraper: it could produce a normalized episode-list response, but it introduces a paid/service credential, target-site authorization and ToS questions, an additional failure point, and an undocumented supplied endpoint shape.

Use Cineby only as a visual reference. Its current anonymous page demonstrates a strong hero, dark gradient treatment, compact top navigation, primary/secondary actions, and spaced content rails. AniStream can implement Continue Watching and interest-based rails from AniList plus local playback state without scraping Cineby.

## Source status and limitations

- [VidKing’s official documentation](https://www.vidking.net/#documentation) was checked through its published documentation page and live page metadata. The page is JavaScript-rendered, so the documented routes, parameters, and event payload were cross-checked against the official search-indexed text for the same page.
- [Parse’s official documentation](https://docs.parse.bot/) was available as structured documentation. The supplied `get_show_episodes` request was not executed because no Parse API key was provided; its generated API specification and response cannot be independently confirmed from the example alone.
- [Cineby](https://www.cineby.at/) was inspected read-only in a browser. The page displayed an anti-bot confirmation dialog during inspection; no CAPTCHA or login was completed, and no content was scraped or integrated.
- [AniList’s official documentation repository](https://github.com/AniList/docs) and the live [AniList mutation guide](https://docs.anilist.co/guide/graphql/mutations) and [mutation reference](https://docs.anilist.co/reference/mutation) were used for the tracker section.

## 1. VidKing

### Verified facts

| Area            | Finding                                                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product shape   | The official page describes VidKing as an embeddable video player integrated with one iframe.                                                                                                                                                                                      |
| Movie route     | `https://www.vidking.net/embed/movie/{tmdbId}`                                                                                                                                                                                                                                     |
| TV route        | `https://www.vidking.net/embed/tv/{tmdbId}/{season}/{episode}`                                                                                                                                                                                                                     |
| Configuration   | Documented URL parameters are `color`, `autoPlay`, `nextEpisode`, and `episodeSelector`; the latter two are described for TV.                                                                                                                                                      |
| Player behavior | The page describes HLS.js-based playback, autoplay, next-episode navigation, and an episode selector.                                                                                                                                                                              |
| Progress events | The player can send `PLAYER_EVENT` messages to the parent window. The documented event names include `timeupdate`, `play`, `pause`, `ended`, and `seeked`; the payload includes content ID, media type, current time, duration, percentage, and TV season/episode when applicable. |
| Auth            | The documented iframe examples contain no API key, OAuth flow, or required authorization parameter. This is **not proof that no commercial or operational controls exist**; it means no auth model was documented on the reviewed page.                                            |
| Limits          | No numeric request quota or client-side rate limit was documented. “99.9% uptime,” catalog counts, and 4K availability are marketing claims on the page, not an SLA or a verified quota.                                                                                           |
| Anime support   | No anime-specific route or AniList-ID endpoint is documented. The TV route uses a TMDB ID. Anime could work only when the title is represented in the expected TV/movie catalog and has a matching TMDB mapping; that is an inference, not a documented guarantee.                 |

### Suitability for AniStream

VidKing is technically compatible with a narrow **remote-player fallback**: the main process could resolve an AniList-to-TMDB mapping, the renderer could display a sandboxed iframe, and a validated `postMessage` handler could update local playback state. It is not a fit for the existing native contract as the primary provider because the docs do not expose title mapping, episode discovery, hosters, direct HLS variants, subtitles, or request headers as application data. It also gives AniStream less control over playback failure handling and source provenance than a main-process adapter.

If it is ever tested, pin the iframe origin to `https://www.vidking.net`, validate every message against a strict schema, and keep the remote player behind a removable adapter. Store only AniList IDs as canonical identity and require an explicit, confidence-checked TMDB mapping; do not infer IDs from title text alone.

## 2. Parse API and the supplied episode-list example

### Verified facts from official Parse docs

- Parse’s base URL is `https://api.parse.bot`; its product turns a website URL and a natural-language extraction task into a generated API. The official flow is dispatch a task, poll until completion, then call the generated endpoint. [Parse introduction](https://docs.parse.bot/introduction) · [Parse quickstart](https://docs.parse.bot/quickstart)
- REST calls require an `X-API-Key` header. The key is shown once, one key is allowed per account, and rotation requires deleting and regenerating it. API-key management endpoints themselves require JWT authentication. [Parse authentication](https://docs.parse.bot/authentication)
- The generated specification contains an execution base URL, endpoint names, HTTP methods, input parameters, and a return schema. That generated specification is the authority for a particular scraper; the generic docs are not enough to infer an endpoint’s fields. [Create an API](https://docs.parse.bot/api-reference/dispatch/create-a-new-api-from-a-url)
- The official execution reference documents `POST /scraper/{scraper_id}/{endpoint_name}` with endpoint parameters in a JSON body. Its response envelope contains `status`, `data`, `raw_output`, `scraper_id`, and `execution_time`; documented statuses are `success`, `error`, and `timeout`. [Execute an endpoint](https://docs.parse.bot/api-reference/execute/execute-an-api-endpoint-post)
- Parse also documents authenticated scraper sessions. A login endpoint can return `session_id` and `encryption_key`, which must be retained for subsequent protected calls. [Authenticated APIs](https://docs.parse.bot/authenticated-apis)
- No numeric service-wide Parse rate limit was found in the reviewed official docs. Treat any local throttle as AniStream policy, not a provider fact, until Parse supplies account-specific limits.

### Supplied `get_show_episodes` request

The supplied reference calls a fixed scraper endpoint with `GET`, a `slug` query parameter, and `X-API-Key: $PARSE_API_KEY`. That differs from the official generic execution reference, which documents `POST` and a JSON body. The endpoint may have a generated GET specification or may be an older/specialized endpoint, but this cannot be confirmed without retrieving that scraper’s generated spec using a valid Parse account.

Therefore the response shape is **not verified**. The safe adapter boundary should accept the documented Parse envelope first and validate the endpoint-specific `data` value against a fixture/schema before mapping it to AniStream’s `AnimeSeason → AnimeEpisode` contracts. Do not assume that the endpoint returns AniList IDs, stable episode numbers, stream URLs, HLS variants, subtitles, or a durable availability guarantee.

### Security and operational concerns

- `PARSE_API_KEY` is a bearer credential. It must remain in the Electron main process and ultimately macOS Keychain; never expose it to React, preload, logs, packaged assets, or a URL.
- If the generated scraper requires target-site login, target credentials and returned session material are a second secret class and need the same treatment.
- A hosted scraper means AniStream depends on Parse availability, billing/account policy, generated-schema drift, target-site changes, and Parse’s handling of the target’s anti-bot controls.
- Parse’s documentation says how to create and execute a scraper, not that a target website has granted AniStream permission to automate access or redistribute its data/media. That permission must be assessed per target.

**Recommendation:** use Parse only for a time-boxed, fixture-first research spike if the user explicitly accepts its cost and target-site ToS risk. Do not make it a default runtime dependency, and do not let a Parse failure affect AniList discovery, lists, MangaDex reading, or local media playback.

## 3. Cineby UI reference

### Verified observations from the supplied site

The live anonymous page presents:

- an edge-positioned dark navigation bar with branding, Home/Browse controls, search, and account actions;
- a large hero banner with a dark image gradient, oversized title, metadata row, description, and clear **Play** plus **See More** actions;
- separated discovery rails including **TOP 10 Today**, **Trending Today**, **Top rated**, **Only on Netflix**, and genre sections such as Comedy;
- poster/card links with direct Play and detail actions;
- small interaction transitions in the rendered UI, including approximately 300 ms image hover scaling and approximately 200 ms control transitions.

The anonymous state inspected did **not** visibly expose a `Continue Watching` or `Based on your interest` heading. Those are requested AniStream features, not verified Cineby page features. The page also displayed a robot-confirmation dialog during inspection, reinforcing that it must not be treated as a scrape target.

### Recommendations for AniStream

- Keep Continue Watching near the top after the hero. Order it by most recently played local records, with the next episode/chapter derived from the AniList entry.
- Keep Top Rated as a real AniList query, e.g. anime/manga `Page.media` sorted by score with a bounded page size. Do not copy Cineby’s catalog or ranking.
- Build Based on Your Interest from AniList genres/tags, the user’s completed/current scored entries, and AniList `Media.recommendations`. This is an AniStream recommendation algorithm, not a fact about Cineby or AniList’s internal ranking algorithm.
- Use a shared card treatment and rail spacing, but keep Anime and Manga details semantically distinct. Hover can reveal Play, Add/Status, and More actions; it should not load or scrape a remote reference site.
- Prefer CSS transforms/opacity, short transitions, reduced-motion handling, and virtualization for long list rails. This is an implementation recommendation based on the observed interaction style.

## 4. AniList operations for progress, ratings, and completion

### Verified API capabilities

AniList requires authenticated requests for mutations. Its GraphQL requests are sent as `POST` requests to `https://graphql.anilist.co`. [Getting started](https://docs.anilist.co/guide/graphql/) · [Authenticated requests](https://docs.anilist.co/guide/auth/authenticated-requests)

Use these operations:

| Operation                                  | Purpose in AniStream                                                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Viewer`                                   | Restore the authenticated user and read their list score format/preferences.                                                                                          |
| `MediaListCollection(type: ANIME)`         | Load the user’s anime lists, status groups, entry progress, scores, and media.                                                                                        |
| `MediaListCollection(type: MANGA)`         | Load the user’s manga lists, chapter/volume progress, scores, and media.                                                                                              |
| `Media(mediaListEntry: ...)` / `MediaList` | Read the authenticated entry for a title when a detail view needs current tracker state.                                                                              |
| `Page.media`                               | Search/browse/top-rated discovery; the reference documents `perPage` max 50 for `Page` and media filters/sorts.                                                       |
| `Media.recommendations`                    | Candidate source for interest-based recommendations.                                                                                                                  |
| `SaveMediaListEntry`                       | Create/update a list entry with `mediaId`, `status`, `score`, `progress`, `progressVolumes`, `repeat`, `priority`, `notes`, custom lists, and start/completion dates. |
| `UpdateMediaListEntries`                   | Batch-update multiple entries when a deliberate bulk action is added.                                                                                                 |
| `DeleteMediaListEntry`                     | Remove an entry from the user’s list.                                                                                                                                 |
| `ToggleFavourite`                          | Needed for AniList-style favourite actions if that feature is included.                                                                                               |

The documented `MediaListStatus` values are `CURRENT`, `PLANNING`, `COMPLETED`, `DROPPED`, `PAUSED`, and `REPEATING`. `progress` means consumed episodes for anime or chapters for manga; `progressVolumes` is available for manga. [MediaListStatus](https://docs.anilist.co/reference/enum/medialiststatus) · [MediaList](https://docs.anilist.co/reference/object/medialist) · [Mutation reference](https://docs.anilist.co/reference/mutation)

AniList’s `score` uses the user’s configured scoring method. The documented formats include 100-point, 10-point decimal, 10-point, 5-point, and 3-point scales. Read the user’s preference and convert a UI rating deliberately; do not assume that a five-star click should be sent as a raw `5` for every account. [ScoreFormat](https://docs.anilist.co/reference/enum/scoreformat)

### Progress-sync recommendation

1. Resolve the played item to a canonical AniList media ID and an episode/chapter identity.
2. Persist local playback state in SQLite: media ID, source ID, season/episode or chapter, timestamp, duration, last played time, and completion flag.
3. On meaningful episode progress, debounce a `SaveMediaListEntry` mutation that advances AniList `progress`. On an ended episode, mark that episode consumed and offer the next one.
4. When the known AniList total is reached, set `status: COMPLETED` and the final progress. For an airing/ongoing title, do not mark completed merely because the last currently released episode was watched.
5. When the user submits a rating, send the chosen AniList score in the account’s configured format and refresh the returned list entry before updating UI state.

The local timestamp is necessary for a true Continue Watching rail: the documented AniList list entry stores integer episode/chapter progress, not an in-episode playback timestamp. This is an implementation inference from the documented fields, not a claim that AniList cannot store additional data elsewhere.

## 5. Legal, ToS, and product risks

- VidKing’s documentation establishes an embed/player interface, not rights to any particular anime or stream. A remote iframe can change behavior, expose user context to a third party, and make source provenance difficult to audit.
- Parse is a scraping service. Its docs explain the mechanism but do not grant permission to scrape arbitrary sites, bypass access controls, or redistribute copyrighted media. The target site’s terms, robots policy, copyright status, and Parse account terms require separate review.
- Cineby and the referenced streaming pages are UI references only. AniStream must not scrape Cineby, copy its content, or use it as a source registry.
- Do not bypass CAPTCHA, DRM, paywalls, geo-restrictions, authentication gates, or anti-bot controls. Preserve a local-media/legal-source fallback for a durable personal-use path.

## Open decisions

1. **VidKing role:** reject for now, or permit as a clearly labeled iframe fallback behind the existing HLS-first provider chain? Adding it would require explicit approval because it changes the approved source strategy.
2. **Parse adoption:** is a paid/hosted scraper acceptable for this personal app, and which target site is authorized for automated access? No implementation should proceed without an answer.
3. **Canonical mapping:** how will AniList IDs be mapped to TMDB IDs for VidKing—curated mappings, a verified mapping API, or user confirmation? Never infer mappings from titles alone.
4. **Sync cadence:** what local threshold should trigger AniList progress writes so that the UI feels immediate without generating unnecessary mutation traffic?
5. **Remote versus local playback:** retain the existing legally sourced/local-media fallback if a remote source becomes unavailable or its terms are unsuitable.

## Sources

- [VidKing documentation](https://www.vidking.net/#documentation)
- [Parse introduction](https://docs.parse.bot/introduction)
- [Parse quickstart](https://docs.parse.bot/quickstart)
- [Parse authentication](https://docs.parse.bot/authentication)
- [Parse endpoint execution reference](https://docs.parse.bot/api-reference/execute/execute-an-api-endpoint-post)
- [Parse authenticated APIs](https://docs.parse.bot/authenticated-apis)
- [Cineby](https://www.cineby.at/)
- [AniList GraphQL getting started](https://docs.anilist.co/guide/graphql/)
- [AniList mutations guide](https://docs.anilist.co/guide/graphql/mutations)
- [AniList mutation reference](https://docs.anilist.co/reference/mutation)
- [AniList MediaList reference](https://docs.anilist.co/reference/object/medialist)
- [AniList MediaListStatus reference](https://docs.anilist.co/reference/enum/medialiststatus)
- [AniList ScoreFormat reference](https://docs.anilist.co/reference/enum/scoreformat)
