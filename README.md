# AniStream

AniStream is a personal macOS desktop application that combines anime and manga discovery, list management, anime playback, manga reading, and tracker synchronization in one coherent library. AniList is the primary catalog and tracker, MangaDex supplies manga and chapter delivery, and anime video extraction is isolated behind replaceable source adapters inspired by Zenshin’s provider strategy.

## Feature scope

### Version 1

- Unified anime and manga search backed by AniList.
- Netflix-inspired anime and editorial manga browse pages with featured titles, catalog sorting,
  keyboard-accessible unified search, detailed title modals, fluid discovery rails, and pagination.
- AniList-driven Continue Watching/Reading, Top Rated, and interest-based discovery rails.
- Local SQLite library and progress state for one user on one Mac.
- AniList browser OAuth, profile, complete anime/manga lists, and progress/score/status/notes synchronization.
- MangaDex search, chapter feeds, MangaDex@Home page delivery, reader preferences, and account synchronization.
- Manga reader with single-page, double-page, long-strip, and right-to-left modes.
- Replaceable anime playback adapters: an AniWatch-compatible HLS API as the primary source, with
  AnimeTosho/Nyaa-indexed torrents as fallback.
- Internal playback with resume progress and external-player handoff where needed.

Currently implemented from this scope: durable AniList login, profile/list management, unified
search, Anime/Manga navigation, paginated catalog browse, expanding content carousels,
AniList-driven discovery rails that exclude owned titles, Zenshin season/episode enrichment,
AniWatch-compatible HLS resolution and trusted-process playlist proxying, torrent fallback,
per-episode SQLite resume, MangaDex chapter/page reading, MangaBaka exact-ID enrichment, rich AniList
title details, and AniList progress/rating/completion updates. The public AniWatch deployment was
unhealthy during the latest live check, so HLS currently degrades to the torrent fallback unless a
working compatible base URL is configured.

### Later

- Multiple video-source adapters and automatic fallback.
- Optional AniDB enrichment and episode/ID mapping.
- Downloads and richer offline behavior.
- Advanced recommendations, activity feeds, and statistics.
- Additional trackers or local-media/Plex/Jellyfin adapters.
- Platforms other than Apple Silicon macOS.

## Tech stack

| Choice                       | Why                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Electron                     | Mature macOS desktop shell with file, media, IPC, custom-protocol OAuth, and native-module support.                          |
| React + TypeScript           | One typed language across the renderer, preload, and main process, with a productive solo-developer workflow.                |
| electron-vite                | Fast development and a conventional main/preload/renderer build.                                                             |
| SQLite via `better-sqlite3`  | Simple local persistence for one user without a database server.                                                             |
| TanStack Query               | Planned request deduplication, caching, retries, and remote-state lifecycle management.                                      |
| Motion + Lucide              | Accessible iconography and reduced-motion-aware search/pagination transitions.                                               |
| Video.js React v10 + hls.js  | Accessible player controls and adaptive HLS playback while AniStream proxies media through the trusted process; v10 is beta. |
| Plain CSS with design tokens | Keeps the desktop UI direct while sharing the inspected Netflix reference palette and AniStream-specific tracker accents.    |

## Local setup

Requirements:

- Apple Silicon Mac
- macOS Monterey or newer
- Node.js 22 or newer
- npm

```bash
git clone <your-anistream-repository-url>
cd AniStream
npm install
cp .env.example .env
npm run dev
```

On the first AniList connection, macOS presents a hidden-input dialog for the OAuth client secret
and saves it in Keychain. As a terminal fallback, `npm run configure:anilist` performs the same
one-time setup. Neither path writes the secret to `.env` or the repository.

Useful checks:

```bash
npm run typecheck
npm run build
npm run check:packaged-preload
npm run check:anilist-oauth
npm run check:product-slice
```

Create an unpacked Apple Silicon application:

```bash
npm run package:mac
```

The current checkout is local and may not yet have a Git remote. Replace the clone URL above when the repository is published.

## Project structure

```text
AniStream/
├── assets/app-icon/    Source artwork used for the macOS application icon
├── docs/research/       Phase 0 provider and UX research
├── src/main/            Trusted Electron process, persistence, network adapters, IPC
├── src/preload/         Narrow, typed bridge exposed to the renderer
├── src/renderer/        React user interface
├── src/shared/          Contracts safe to share across process seams
├── API.md               External integration contracts and degraded behavior
├── AGENTS.md            Operating instructions for coding agents
├── CONTEXT.md           Current verified state, open decisions, and next work
└── electron.vite.config.ts
```

## Environment variables

| Variable                        | Service                     | Where to get it                                            | Required                                                        |
| ------------------------------- | --------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `MANGADEX_CLIENT_ID`            | MangaDex personal client    | MangaDex Settings → API clients                            | Planned for opt-in account sync; not used by the public adapter |
| `MANGADEX_CLIENT_SECRET`        | MangaDex personal client    | MangaDex API client settings                               | Planned for opt-in account sync; must move to Keychain          |
| `MANGADEX_USERNAME`             | MangaDex personal client    | Your MangaDex account                                      | Planned for opt-in account sync; must move to Keychain          |
| `MANGADEX_PASSWORD`             | MangaDex personal client    | Your MangaDex account                                      | Planned for opt-in account sync; must move to Keychain          |
| `MANGADEX_LANGUAGE`             | MangaDex public API         | ISO 639-1 language code                                    | Optional; defaults to `en` for chapter availability             |
| `ANISTREAM_ANIWATCH_ENABLED`    | AniWatch-compatible HLS API | Set to `false`/`0`/`off` to disable the risky adapter      | Optional; enabled by default for this approved personal build   |
| `ANISTREAM_ANIWATCH_API_URL`    | AniWatch-compatible HLS API | Public deployment or a repaired/self-hosted compatible URL | Optional; defaults to the reviewed Render deployment            |
| `ANISTREAM_ZENSHIN_API_URL`     | Zenshin episode mapping     | Optional preferred mirror URL                              | Optional; official mirrors are tried by default                 |
| `PARSE_API_KEY`                 | Parse episode-guide adapter | Parse dashboard → Settings → API Key                       | Optional; required for episode-guide loading                    |
| `PARSE_ANIME_SCRAPER_ID`        | Parse episode-guide adapter | Supplied/generated Parse scraper ID                        | Optional; defaults to the configured anime scraper              |
| `PARSE_ANIME_EPISODES_ENDPOINT` | Parse episode-guide adapter | Supplied/generated Parse endpoint name                     | Optional; defaults to `get_show_episodes`                       |

Provider base URLs are application constants unless a development proxy is explicitly required. Secrets must never be exposed to renderer code or committed. The main process loads `.env` during development and `~/Library/Application Support/AniStream/.env` for a packaged personal install; shell variables take precedence. Parse keys remain main-process-only and should move to Keychain before treating the adapter as production-ready.

AniList OAuth is configured for this personal build with the public client ID and
`anistream://auth/anilist` callback. The authorization-code flow reads its client secret from macOS
Keychain after a one-time native prompt; the secret is never packaged or exposed to the renderer.
The resulting access token is encrypted with Electron `safeStorage`, also backed by macOS Keychain.

## Status

Durable AniList login, profile/list management, unified Anime/Manga browse and search, expanding
content carousels, Zenshin episode details, typed HLS/torrent source resolution, local playback
resume, MangaDex chapter/page reading, MangaBaka enrichment, rich title details, pagination, the
typed Electron bridge, SQLite persistence, production build, and unsigned Apple Silicon package
have been structurally verified on macOS. The reviewed public AniWatch deployment currently returns
empty/time-out/error responses, so a successful live HLS playback still requires that service to
recover or a compatible base URL to be configured. For current build status and next steps, see
[CONTEXT.md](CONTEXT.md).
