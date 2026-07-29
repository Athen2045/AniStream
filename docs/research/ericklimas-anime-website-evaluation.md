# Evaluation: `ErickLimaS/anime-website`

Verified: 2026-07-28

Repository: <https://github.com/ErickLimaS/anime-website>

## Verdict

**Do not use this repository's anime adapter/API as an AniStream runtime dependency, and do not copy
its implementation.** It is a full Next.js/Firebase web application whose video API is a proxy over
separately deployed Consumet and Aniwatch-compatible services, not a maintained native adapter we can
put behind AniStream's approved source boundary. It also uses the non-permissive
CC BY-NC-SA 4.0 license.

The product behavior is a useful reference. The implementation is not.

## Verified facts

### Repository health and licensing

- GitHub describes the project as a Next.js anime/manga website using Firebase, AniList, Consumet,
  and Aniwatch; its default branch is `master`. The repository was last pushed on 2025-08-24 and
  currently reports 329 stars, 197 forks, and 19 open issues. [Repository metadata](https://github.com/ErickLimaS/anime-website)
- Its `LICENSE.md` is [Creative Commons Attribution-NonCommercial-ShareAlike 4.0](https://github.com/ErickLimaS/anime-website/blob/master/LICENSE.md),
  rather than a permissive software license. Reusing or adapting its code would impose attribution,
  non-commercial, and share-alike conditions, so AniStream must not copy it.
- The published frontend is a Next.js/Firebase web client, while the separate backend is Express +
  Redis. [Frontend package](https://github.com/ErickLimaS/anime-website/blob/master/frontend/package.json)
  [Backend package](https://github.com/ErickLimaS/anime-website/blob/master/backend/package.json)

### What its anime "adapter" actually does

- The backend setup explicitly requires a self-hosted Consumet API, a separately deployed
  `ghoshRitesh12/aniwatch-api`, Redis, and an AniList client secret. [Backend setup](https://github.com/ErickLimaS/anime-website/blob/master/backend/README.md)
- Its routes expose provider-shaped proxy endpoints for Aniwatch and Consumet Gogoanime/Zoro:
  `/episodes/aniwatch/*`, `/episodes/consumet/gogoanime/*`, and `/episodes/consumet/zoro/*`.
  [Episode routes](https://github.com/ErickLimaS/anime-website/blob/master/backend/routes/mediaEpisodesRoute.js)
- The Aniwatch controller forwards the browser request to `ANIWATCH_API_URL` and returns that
  service's episode/source payload. It does not implement extraction itself.
  [Aniwatch controller](https://github.com/ErickLimaS/anime-website/blob/master/backend/controllers/episodes/aniwatch/episodesController.js)
- The Gogoanime and Zoro controllers likewise concatenate an upstream `CONSUMET_API_URL`, proxy its
  JSON response, and cache it in Redis. [Gogoanime controller](https://github.com/ErickLimaS/anime-website/blob/master/backend/controllers/episodes/consumet/gogoanime/episodesController.js)
  [Zoro controller](https://github.com/ErickLimaS/anime-website/blob/master/backend/controllers/episodes/consumet/zoro/episodesController.js)
- Its frontend retrieves `sources` from its own public backend URL, then expects a source list to be
  present. [Aniwatch frontend API](https://github.com/ErickLimaS/anime-website/blob/master/frontend/app/api/episodes/aniwatch/episodesInfo.ts)
  [Consumet frontend API](https://github.com/ErickLimaS/anime-website/blob/master/frontend/app/api/episodes/consumet/episodesInfo.ts)

## Fit with AniStream

| Concern                      | Assessment                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Electron architecture | Poor fit. It needs a web backend, Redis, Firebase, and externally deployed provider APIs; AniStream is a local single-user Electron app.                                                                                                              |
| Current source policy        | Not compatible. Its Aniwatch/HiAnime, Zoro, and Gogoanime paths are not AniStream's approved AnimePahe → AnimeTosho/Nyaa targets.                                                                                                                     |
| Consumet                     | Rejected in AniStream's current architecture due to availability/licensing/maintenance review. This project depends on a self-hosted Consumet deployment.                                                                                             |
| Security boundary            | Poor fit. Its browser-facing `NEXT_PUBLIC_BACKEND_URL` requests are unlike AniStream's narrow typed preload bridge. The proxy controllers rely on upstream data without schema validation, documented rate limits, bounded retries, or circuit state. |
| License                      | Not suitable for code reuse: CC BY-NC-SA 4.0.                                                                                                                                                                                                         |
| Product patterns             | Good source of ideas, provided we reimplement them independently in AniStream.                                                                                                                                                                        |

## Risks observed in the implementation

- The proxy code builds remote URLs from environment-provided bases and forwards provider response
  bodies with only shallow checks. It has Redis caching, but no visible provider queue, timeout,
  response-schema validation, 429 policy, or circuit breaker in the reviewed episode controllers.
- A failed upstream response is often handled inside a `fetch().then()` callback after the controller
  continues, which can produce inconsistent HTTP responses. This is an implementation observation,
  not an assertion about the live services.
- The frontend README's AniList/Firebase instructions include a temporary Firestore rule allowing
  every read and write. AniStream must not replicate that guidance or introduce Firebase for this
  one-user local app. [Frontend setup](https://github.com/ErickLimaS/anime-website/blob/master/frontend/README.md)
- The project depends on several third-party/aggregator sources. Their availability, rights, request
  shapes, and terms are outside the repository and must not be treated as verified merely because
  this UI calls them.

## Features worth independently implementing

The README documents search/filtering, sub/dub choice, timestamp-based resume, watched-episode
tracking, AniList status/favourites, notifications, a manga reader, and player controls. [Feature list](https://github.com/ErickLimaS/anime-website/blob/master/README.md)
The following map well to AniStream's approved architecture:

1. **Audio/source preference** — model sub/dub as user preferences and expose only normalized
   `AnimeHoster`/`AnimeVideoVariant` choices from the approved native adapter.
2. **Exact resume behavior** — save local playback position in SQLite and use a thresholded main-process
   mutation to update AniList episode progress. This supports the requested Continue Watching rail
   without adding Firebase.
3. **Watched/caught-up states** — preserve the existing AniList `CURRENT`/episode availability rules,
   then add spoiler-safe episode selection and a clear “next episode” action.
4. **Player ergonomics** — quality choice, subtitle tracks, autoplay-next, retry, and source-health
   feedback belong in AniStream's renderer, while URL resolution remains in the main process.
5. **Local notifications** — a future airing/release reminder could use AniList air-date data and
   macOS notifications. It should remain opt-in and local rather than depend on Firebase cloud
   notifications.

Do not bring over its Firebase authentication, cloud user documents, anonymous accounts, social
comments, external provider URLs, DOM parsing, Redis service, or server deployment requirements.

## Recommendation

Keep the existing native TypeScript seam in `src/shared/providers.ts` and proceed with the separately
approved AnimePahe-style HLS research, followed by AnimeTosho/Nyaa fallback research. If a specific
source later returns hoster/source data, normalize it at the main-process adapter edge, validate it,
and make it removable. This repository offers no safe shortcut around that work.
