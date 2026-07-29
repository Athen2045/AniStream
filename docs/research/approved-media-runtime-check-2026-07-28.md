# Approved media-source runtime check

Verified: 2026-07-28

## Scope

This is a bounded operational check before implementation of the already-approved source order:
AnimePahe-style HLS first, then AnimeTosho/Nyaa torrent discovery. It does not establish content
rights, source terms, or a permanent provider contract.

## Findings

| Source     | Verified fact                                                                                                                                                                                                                            | AniStream decision                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AnimePahe  | A request to `https://animepahe.ru` redirected to `https://animepahe.su`. A subsequent representative JSON search request to `.su` returned a parked/domain-for-sale HTML page rather than the expected source response.                 | Do not enable an HLS extractor. The installed client reports the HLS primary as unavailable and continues to the approved torrent fallback. Re-verify before adding any new domain or parser. |
| Nyaa       | A bounded RSS search returned HTTP 200 with XML and a five-minute cache header.                                                                                                                                                          | Use only as a main-process torrent indexer. Normalize magnet URIs; opening one is an explicit OS action to the user's installed torrent client.                                               |
| AnimeTosho | Its official About page documents JSON feeds as an API and does not require an API key. Its current News Archive says new torrents stopped being added on 2026-05-09; the feed/API remains temporarily online, but with no new releases. | Keep as a secondary, degrading indexer for historical releases only. Nyaa is the practical active torrent fallback.                                                                           |

## Implementation boundaries

- No HLS source URL is exposed to the renderer.
- No torrent is downloaded, seeded, rehosted, or auto-started. The user explicitly chooses a release,
  then AniStream asks macOS to open its `magnet:` URL in the installed torrent handler.
- HLS provider parsing remains intentionally unimplemented because the approved source did not pass
  this runtime check. This is a truthful degraded state, not a replacement-provider decision.

## Sources

- [Anime Tosho About / API FAQ](https://animetosho.org/about)
- [Anime Tosho News Archive](https://animetosho.org/about/news)
- [Anime Tosho shutdown notice](https://animetosho.org/about/shutdown)
- Live bounded HTTP checks noted above (2026-07-28); no source was repeatedly queried.
