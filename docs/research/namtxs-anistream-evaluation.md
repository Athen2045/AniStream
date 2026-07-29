# `namtxs/anistream` evaluation

Verified: 2026-07-28  
Repository: [github.com/namtxs/anistream](https://github.com/namtxs/anistream)

## Executive conclusion

Use this repository as a **small UX and playback-behavior reference**, not as an anime adapter or
runtime dependency. The repository is a static HTML/CSS/JavaScript frontend. Its actual catalog,
episode, video, audio, subtitle, image, and schedule data come from a separately hosted
`https://api.ngewibu.tv` backend that is not present in the repository. It therefore cannot be
ported into AniStream as a self-contained source adapter.

The useful ideas are already compatible with AniStream's direction: a schedule rail, compact search
pagination, quality selection, subtitle selection, episode switching, resume/autoplay behavior, and
a player with screenshot/fullscreen/playback-rate controls. Those behaviors should be reimplemented
behind AniStream's typed main-process provider boundary, not copied as raw scripts or backend URLs.

## Verified repository facts

| Area                | Evidence                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation      | The tree contains static HTML, CSS, JavaScript, images, and a web manifest; it has no `package.json`, TypeScript, Electron code, backend service, or provider module. [Repository tree](https://api.github.com/repos/namtxs/anistream/git/trees/main?recursive=1)               |
| License             | MIT License, copyright 2023. [LICENSE](https://raw.githubusercontent.com/namtxs/anistream/main/LICENSE)                                                                                                                                                                         |
| Runtime API         | `index.html`, `details.html`, and the loader scripts hardcode `https://api.ngewibu.tv` as `BACKEND_URL`. [index.html](https://raw.githubusercontent.com/namtxs/anistream/main/index.html), [details.html](https://raw.githubusercontent.com/namtxs/anistream/main/details.html) |
| Repository metadata | GitHub reports CSS, JavaScript, and HTML as the languages; the default branch is `main`, it is not archived, and GitHub reports MIT. [Repository API metadata](https://api.github.com/repos/namtxs/anistream)                                                                   |
| Maintenance         | GitHub reports `pushed_at` as 2023-03-10. The latest listed commit is `Delete CNAME` on that date; the newer GitHub `updated_at` field is repository metadata activity, not a source push. [Commit API](https://api.github.com/repos/namtxs/anistream/commits?per_page=10)      |
| Releases            | No GitHub releases were returned. [Releases API](https://api.github.com/repos/namtxs/anistream/releases?per_page=10)                                                                                                                                                            |
| Open work           | One open issue, `Self Hosted API`, was last updated 2023-03-28. [Issues API](https://api.github.com/repos/namtxs/anistream/issues?state=open&per_page=10)                                                                                                                       |

## Anime adapter assessment

### What is present

The frontend calls these external backend shapes:

- `GET /search/{query}` for search results.
- `GET /terbaru`, `GET /rekomendasi`, and `GET /index/semua/hot/{page}` for home/update/index rows.
- `GET /jadwal` for release schedule data.
- `GET /v1/season2/{id}` for title metadata, sections, seasons, and episode details.
- `GET /v1/video/{episodeId}/{quality}` for video segments.
- `GET /v1/audio/{episodeId}/{quality}` for audio at higher qualities.
- `GET /v1/subtitle/{episodeId}` for subtitles.
- `GET /image/{cover}{variant}` for artwork.

The endpoint usage is visible in [loader.js](https://raw.githubusercontent.com/namtxs/anistream/main/assets/js/loader.js),
[loader-index.js](https://raw.githubusercontent.com/namtxs/anistream/main/assets/js/loader-index.js),
[details.js](https://raw.githubusercontent.com/namtxs/anistream/main/assets/js/details.js), and
[jadwal.js](https://raw.githubusercontent.com/namtxs/anistream/main/assets/js/jadwal.js).

This is **not** a portable adapter: the backend, its data model, source extraction, authentication,
rate limits, availability, and terms are outside the repository. The player also expects an `m4s`
media type and synchronizes a separate audio URL for qualities above 360P. That is an implementation
detail of this backend, not evidence that the source exposes HLS or a stable public API.

### Features worth reimplementing

1. **Episode-centric playback state.** Selecting an episode changes the poster, subtitle URL, media
   URL, and active episode without leaving the detail view. This maps cleanly to AniStream's
   `title → season → episode → hoster → video variant` contracts.
2. **Quality and subtitle controls.** The player exposes 360P/480P/720P/1080P choices and detects
   subtitle response format before configuring the player. AniStream should normalize these into
   `AnimeVideoVariant` values and subtitle tracks rather than embed source-specific URL templates in
   the renderer.
3. **Playback ergonomics.** Autoplay, next-episode-ready episode lists, resume (`autoPlayback`),
   playback rate, fullscreen, AirPlay, screenshot, poster updates, and loading/reload states are
   useful acceptance criteria for the future Watch surface.
4. **Schedule interaction.** The day buttons and compact airing table are a good feature candidate
   for a future AniList-powered schedule rail. AniList's airing data should remain authoritative.
5. **Fallback imagery and retry.** The frontend retries artwork with a portrait variant when the
   requested image fails and presents a reload action on list failures. AniStream should keep the
   same degraded-state principle, with bounded retries and provider-specific error messages.
6. **Theme persistence.** The light/dark toggle uses `localStorage`. AniStream already has a dark
   desktop language; the persistence idea is useful, but the implementation belongs in AniStream's
   settings/preferences layer.

## What should not be reused

- Do not add `api.ngewibu.tv` as an AniStream provider without separate current verification,
  explicit approval, and a documented legal/ToS review. It is a third-party backend, not part of the
  referenced repository.
- Do not copy the endpoint URL templates, media IDs, or assumed `m4s` behavior into the shared
  contracts. Provider quirks belong in a removable main-process adapter.
- Do not copy the raw DOM `innerHTML` rendering. `search.js`, `details.js`, and `jadwal.js` insert
  remote titles, descriptions, metadata, and IDs into HTML strings without a general escaping layer.
  AniStream's React rendering and main-process response validation are safer boundaries.
- Do not copy the third-party advertising script loaded by `index.html` and `details.html`.
- Do not copy the repository's hardcoded WibuTV/Ngewibu branding, remote banner/image URLs, or
  Indonesian-specific copy into AniStream.
- Do not infer that its media endpoints are legal, stable, authorized, or HLS-compatible merely
  because the frontend can call them.

## Comparison with AniStream

| Capability          | `namtxs/anistream`                                       | AniStream decision                                                                      |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Metadata authority  | External Ngewibu API                                     | AniList remains primary metadata/tracker source                                         |
| Video source        | External backend with custom `m4s`/audio/subtitle routes | Replaceable approved AnimePahe-style HLS adapter, then AnimeTosho/Nyaa torrent fallback |
| Data validation     | Loose JavaScript and DOM insertion                       | Validate at main-process adapter edge; typed preload contracts                          |
| Desktop integration | None                                                     | Electron main/preload/renderer separation                                               |
| Tracker sync        | Not present in the repository                            | Durable AniList OAuth, list mutations, progress, score, and completion                  |
| Manga               | Not present                                              | MangaDex public adapter and planned MangaDex@Home reader/account sync                   |
| Maintenance signal  | Last source push 2023-03-10; no releases                 | AniStream must not depend on this repository's backend availability                     |

## Recommendation

**Adopt selectively:** add the following to the Watch-surface acceptance checklist and future provider
contracts:

- episode switching without leaving the detail page;
- quality/language/subtitle variant selection;
- resume and autoplay/next-episode behavior;
- explicit loading, source-failure, and retry states;
- schedule/day browsing as a later AniList feature;
- player controls such as fullscreen, playback rate, and AirPlay where Electron/macOS supports them.

**Do not integrate:** the repository's backend, its hardcoded media URLs, its third-party ad script,
or its DOM scripts. The repo provides no anime adapter implementation that is safer or more complete
than AniStream's existing native TypeScript provider seam.
