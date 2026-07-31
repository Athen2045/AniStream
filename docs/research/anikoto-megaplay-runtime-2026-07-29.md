# Anikoto + MegaPlay runtime verification

Verified: 2026-07-29

## Outcome

AniStream replaced its AniWatch HLS, Zenshin episode-mapping, and AnimeTosho/Nyaa torrent runtime
with one removable Anikoto adapter. Anikoto supplies a recent catalog and exact series episode rows;
MegaPlay supplies the cross-origin embedded player. This is an embed integration, not a direct HLS
integration.

## Verified facts from the official documentation

- Anikoto's base URL is `https://anikotoapi.site`.
- The documented JSON routes are `GET /recent-anime?page={page}&per_page={count}` and
  `GET /series/{id}`.
- The recent rows include provider ID, title, `ani_id`, `mal_id`, artwork, and availability fields.
- Series rows include `anime` plus `episodes`; each observed episode had numeric `number`,
  `episode_embed_id`, and `embed_url.sub`/`embed_url.dub`.
- The published limit is 60 requests per IP per 120 seconds. A live response also exposed
  `X-RateLimit-Limit: 60`, remaining budget, and reset time.
- The documentation recommends server-side access and caching, warns that 429 can become an IP 403
  under heavy abuse, and does not document automatic retry.
- MegaPlay documents embed-only routes for provider episode ID, MAL ID, and AniList ID:
  `/stream/s-2/{episodeEmbedId}/{sub|dub}`,
  `/stream/mal/{malId}/{episode}/{sub|dub}`, and
  `/stream/ani/{aniListId}/{episode}/{sub|dub}`.
- MegaPlay explicitly says direct access is disabled. It documents parent-window `postMessage`
  events named `time`, `complete`, `error`, and `watching-log`.
- MegaPlay warns that not every MAL/AniList ID is mapped even when the title exists in its library.

Sources:

- [Anikoto API documentation](https://anikotoapi.site/)
- [MegaPlay Anikoto video API documentation](https://megaplay.buzz/api)

## Bounded live verification

The following checks were performed once or in a small bounded set:

1. `GET /recent-anime?page=1&per_page=3` returned `ok: true`, pagination, provider IDs, exact
   `ani_id` values, and catalog metadata.
2. `GET /series/8868` returned an exact `ani_id` match and four episode rows with numeric
   `episode_embed_id` values and sub/dub embed URLs.
3. Asking for `per_page=500` was capped by the provider to 100 rows. The live catalog reported 8,914
   titles across 90 pages.
4. A direct MegaPlay request and an iframe-style request without an HTTP referrer returned its error
   page with code 410.
5. The same documented episode embed route with a truthful `http://127.0.0.1:{port}/` iframe
   referrer returned the player shell. AniStream therefore serves only its packaged renderer assets
   from an ephemeral loopback origin instead of spoofing a third-party referrer or weakening the
   provider's access check.

No video segment or media URL was extracted during research.

## Implementation judgment

- Do not crawl all 90 Anikoto pages to find an arbitrary AniList title. That would consume the
  published IP allowance and create a fragile load-bearing index.
- Cache the first 100 recent rows for 15 minutes. If one row has exactly the requested `ani_id`,
  load and cache `/series/{id}` for 30 minutes.
- If the recent page has no exact match, build the episode-number list from AniList and use
  MegaPlay's documented direct AniList-ID route. Never map by title similarity.
- Serialize Anikoto requests at one every 2.1 seconds, stop immediately on 429/403, and honor
  `Retry-After` or `X-RateLimit-Reset`. This is AniStream's conservative policy, not another
  provider-published limit.
- Accept playback messages only when both `event.origin === "https://megaplay.buzz"` and
  `event.source` is the current player iframe.
- Treat an embed load or mapping failure as playback-only degradation. AniList discovery, profile
  lists, tracker writes, and MangaDex reading remain available.
