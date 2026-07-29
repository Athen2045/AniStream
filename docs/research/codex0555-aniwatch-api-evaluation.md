# `codex0555/Aniwatch-Api` evaluation

**Reviewed:** 2026-07-28. **Scope:** source-level research only; the repository was not run, and AniStream application code and `CONTEXT.md` were not changed.

> **Historical note:** the recommendation below records the initial architecture review. It was
> superseded later on 2026-07-28 when the user explicitly approved this provider and accepted its
> legal, reliability, and maintenance risks. AniStream subsequently implemented a clean-room,
> removable client without copying the repository's unlicensed scraper code. See
> `approved-aniwatch-zenshin-runtime-2026-07-28.md` for the implementation-time verification.

## Recommendation: reject for adoption; reference-only

Do not adopt this repository, its Render deployment, or its source-extraction implementation as an AniStream runtime adapter/API. It is an unlicensed, inactive Express scraper for AniwatchTV with a hard-coded MegaCloud decryption path. That target family is outside AniStream's approved AnimePahe-style HLS → AnimeTosho/Nyaa torrent policy, and open repository issues report that its source-resolution endpoint returns internal-server errors.

## Verified evidence

| Area           | Finding                                                                                                                                        | Evidence                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| License        | No `LICENSE` file is present and GitHub reports no detected license. Do not copy code without explicit permission.                             | [Repository tree](https://github.com/codex0555/Aniwatch-Api/tree/main), [repository overview](https://github.com/codex0555/Aniwatch-Api)                                                                                                                                        |
| Maintenance    | Latest push to `main` was 2024-07-31. The project is not archived, but source-resolution failures were reported in issues #5 and #6 in 2026.   | [Commit history](https://github.com/codex0555/Aniwatch-Api/commits/main), [issue #5](https://github.com/codex0555/Aniwatch-Api/issues/5), [issue #6](https://github.com/codex0555/Aniwatch-Api/issues/6)                                                                        |
| Tests          | The source tree has no tests and `package.json` only provides `start: node inde.js`.                                                           | [Tree](https://github.com/codex0555/Aniwatch-Api/tree/main), [package manifest](https://github.com/codex0555/Aniwatch-Api/blob/main/src/package.json)                                                                                                                           |
| Upstream       | Routes scrape `https://aniwatchtv.to`; playback resolution requests its AJAX endpoints, then assumes and extracts MegaCloud source data.       | [episode route](https://github.com/codex0555/Aniwatch-Api/blob/main/src/routes/episode.js), [server route](https://github.com/codex0555/Aniwatch-Api/blob/main/src/routes/server.js), [source resolver](https://github.com/codex0555/Aniwatch-Api/blob/main/src/routes/src1.js) |
| Deployment/API | README documents an unauthenticated, third-party Render API. It publishes no rate limits, version guarantee, ownership/SLA, or OpenAPI schema. | [README](https://github.com/codex0555/Aniwatch-Api/blob/main/README.md)                                                                                                                                                                                                         |

## Actual API and architecture

The Express entry point mounts all routers below `/api` on port 3005. Its documented endpoints are `/parse`, `/search/:query/:page`, `/genre/:genre/:page`, `/shedule/:date`, `/related/:id`, `/mix/:kind/:page`, `/episode/:id`, `/server/:episodeId`, `/src-server/:sourceId`, and `/random`. They are all unauthenticated `GET` endpoints. [Entry point](https://github.com/codex0555/Aniwatch-Api/blob/main/src/inde.js), [README](https://github.com/codex0555/Aniwatch-Api/blob/main/README.md).

The pipeline is hard-coded rather than provider-abstracted:

1. Scrape AniwatchTV title/search/detail HTML using Axios and Cheerio.
2. Fetch AniwatchTV episode and server AJAX fragments.
3. Return sub/dub hoster entries.
4. Fetch the selected source; construct a MegaCloud embed URL; download MegaCloud's player JavaScript; regex-extract decryption values; AES-decrypt sources; return URLs/tracks/intro/outro.

The README's `/src-server` response shape differs from the implementation: it documents `serverSrc`, while the code sends `restres`. That is a verified contract mismatch. [README example](https://github.com/codex0555/Aniwatch-Api/blob/main/README.md), [implemented route](https://github.com/codex0555/Aniwatch-Api/blob/main/src/routes/src1.js).

## Security and reliability concerns

- Every route enables default permissive `cors()`; there is no authentication, authorization, input schema validation, cache, timeout, cancellation, rate-limit queue, retry policy, or circuit breaker. [Example route](https://github.com/codex0555/Aniwatch-Api/blob/main/src/routes/search.js).
- Several catch paths only log errors and do not produce a defined error response, so callers may wait indefinitely. [Episode route](https://github.com/codex0555/Aniwatch-Api/blob/main/src/routes/episode.js), [schedule route](https://github.com/codex0555/Aniwatch-Api/blob/main/src/routes/shedule.js).
- CSS selectors, string splits, and a regular expression over a remote player script are inherently fragile. The resolver explicitly recognizes that its extractor can become outdated. [Resolver](https://github.com/codex0555/Aniwatch-Api/blob/main/src/routes/src1.js).
- It exposes heterogeneous, unvalidated responses (for example the details route appends unrelated object shapes into `infoX`), unsuitable for AniStream's strict normalized contracts. [Details route](https://github.com/codex0555/Aniwatch-Api/blob/main/src/routes/info.js).

## Fit with AniStream policy

| Requirement                         | Fit            | Reason                                                                                                                            |
| ----------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| AnimePahe-style HLS primary         | No             | This source targets AniwatchTV/MegaCloud, not AnimePahe.                                                                          |
| AnimeTosho/Nyaa torrent fallback    | No             | No torrent indexing or torrent playback capability exists.                                                                        |
| Native removable TypeScript adapter | No             | CommonJS Express scraper with domains and extraction logic embedded in route handlers.                                            |
| Safe/degradable provider            | No             | No tests/fixtures, no bounded network policy, and reported source failures.                                                       |
| Pipeline concept                    | Reference only | Its title → episode → sub/dub hoster → source stages resemble AniStream's existing contracts, but not its implementation quality. |

## Independently reusable patterns

Implement these only from AniStream's own code and contracts, never by copying this repository:

- Stage resolution as title mapping → episodes → hosters → video variants.
- Model sub/dub choice explicitly and carry optional tracks plus intro/outro ranges with validated variants.
- Keep provider IDs and all extraction/network logic in the Electron main-process adapter.
- Add parser fixtures, typed failures, timeouts, source-health states, and a kill switch before enabling any scraped source.

**Bottom line:** reject as an adapter/API. It does not meet AniStream's approved source strategy or its security, licensing, maintenance, testability, and contract-stability requirements.
