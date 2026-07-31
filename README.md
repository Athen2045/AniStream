# AniStream

AniStream is a personal macOS desktop application that combines anime and manga discovery, list
management, anime playback, manga reading, and tracker synchronization in one coherent library.
AniList is the primary catalog and tracker, MangaDex supplies manga and chapter delivery, and
Anikoto/MegaPlay supplies removable embedded anime playback.

## Feature scope

### Version 1

- Unified anime and manga search backed by AniList.
- Netflix-inspired anime and editorial manga browse pages with featured titles, catalog sorting,
  keyboard-accessible unified search, detailed title modals, fluid discovery rails, and pagination.
- AniList-driven Continue Watching/Reading and Trending rails, plus independently paged 21-title
  Latest Anime/Manga grids.
- Local SQLite library and progress state for one user on one Mac.
- AniList browser OAuth, profile, complete anime/manga lists, and progress/score/status/notes synchronization.
- MangaDex exact-ID mapping, chapter feeds, MangaDex@Home page delivery, and opt-in account
  synchronization (account sync is still pending).
- Fullscreen vertical long-strip manga reader with local chapter/scroll resume and previous/next
  chapter navigation.
- Replaceable Anikoto episode adapter with sub/dub playback through MegaPlay's documented embed.
- Fullscreen episode playback with local progress checkpoints and AniList completion updates.

Currently implemented from this scope: durable AniList login, profile/list management, unified
search, Anime/Manga navigation, paginated catalog search, expanding content carousels, AniList
Continue/Trending rails, static paginated Latest Updates grids, Anikoto episode lookup, MegaPlay
sub/dub embeds, Framer Motion fullscreen episode-list transitions, per-episode SQLite progress,
direct-to-list anime/manga details, MangaDex archive paging and fullscreen long-strip reading,
per-chapter SQLite resume, MangaBaka exact-ID enrichment, rich AniList title details, and AniList
progress/rating/completion updates.

### Later

- Multiple video-source adapters and automatic fallback.
- Optional AniDB enrichment and episode/ID mapping.
- Downloads and richer offline behavior.
- Advanced recommendations, activity feeds, and statistics.
- Additional trackers or local-media/Plex/Jellyfin adapters.
- Platforms other than Apple Silicon macOS.

## Tech stack

| Choice                       | Why                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Electron                     | Mature macOS desktop shell with file, media, IPC, custom-protocol OAuth, and native-module support.                       |
| React + TypeScript           | One typed language across the renderer, preload, and main process, with a productive solo-developer workflow.             |
| electron-vite                | Fast development and a conventional main/preload/renderer build.                                                          |
| SQLite via `better-sqlite3`  | Simple local persistence for one user without a database server.                                                          |
| TanStack Query               | Planned request deduplication, caching, retries, and remote-state lifecycle management.                                   |
| Framer Motion + Lucide       | Accessible iconography and reduced-motion-aware search, pagination, and fullscreen view transitions.                      |
| Anikoto + MegaPlay embed     | Exact provider episode IDs when available and documented AniList-ID sub/dub embeds without extracting direct media URLs.  |
| Plain CSS with design tokens | Keeps the desktop UI direct while sharing the inspected Netflix reference palette and AniStream-specific tracker accents. |

## Local setup

Requirements:

- Apple Silicon Mac
- macOS Monterey or newer
- Node.js 22 or newer
- npm

```bash
git clone <your-anistream-repository-url>
cd AniStream
npm install --legacy-peer-deps
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

Create the Apple Silicon application and DMG:

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

| Variable                        | Service                     | Where to get it                                    | Required                                                        |
| ------------------------------- | --------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `MANGADEX_CLIENT_ID`            | MangaDex personal client    | MangaDex Settings → API clients                    | Planned for opt-in account sync; not used by the public adapter |
| `MANGADEX_CLIENT_SECRET`        | MangaDex personal client    | MangaDex API client settings                       | Planned for opt-in account sync; must move to Keychain          |
| `MANGADEX_USERNAME`             | MangaDex personal client    | Your MangaDex account                              | Planned for opt-in account sync; must move to Keychain          |
| `MANGADEX_PASSWORD`             | MangaDex personal client    | Your MangaDex account                              | Planned for opt-in account sync; must move to Keychain          |
| `MANGADEX_LANGUAGE`             | MangaDex public API         | ISO 639-1 language code                            | Optional; defaults to `en` for chapter availability             |
| `ANISTREAM_ANIKOTO_ENABLED`     | Anikoto/MegaPlay            | Set to `false`/`0`/`off` for the local kill switch | Optional; enabled by default                                    |
| `ANISTREAM_ANIKOTO_API_URL`     | Anikoto catalog API         | Verified HTTPS-compatible deployment               | Optional; defaults to `https://anikotoapi.site`                 |
| `ANISTREAM_MAL_CLIENT_ID`       | MyAnimeList public API      | MyAnimeList API client settings                    | Optional score/index fallback                                   |
| `ANISTREAM_MANGABAKA_TOKEN`     | MangaBaka                   | MangaBaka personal access token                    | Optional; unauthenticated enrichment still works                |
| `PARSE_API_KEY`                 | Parse episode-guide adapter | Parse dashboard → Settings → API Key               | Optional; required for episode-guide loading                    |
| `PARSE_ANIME_SCRAPER_ID`        | Parse episode-guide adapter | Supplied/generated Parse scraper ID                | Optional; defaults to the configured anime scraper              |
| `PARSE_ANIME_EPISODES_ENDPOINT` | Parse episode-guide adapter | Supplied/generated Parse endpoint name             | Optional; defaults to `get_show_episodes`                       |

Provider base URLs are application constants unless a development proxy is explicitly required. Secrets must never be exposed to renderer code or committed. The main process loads `.env` during development and `~/Library/Application Support/AniStream/.env` for a packaged personal install; shell variables take precedence. Parse keys remain main-process-only and should move to Keychain before treating the adapter as production-ready.

AniList OAuth is configured for this personal build with the public client ID and
`anistream://auth/anilist` callback. The authorization-code flow reads its client secret from macOS
Keychain after a one-time native prompt; the secret is never packaged or exposed to the renderer.
The resulting access token is encrypted with Electron `safeStorage`, also backed by macOS Keychain.

## Status

Durable AniList login, profile/list management, unified Anime/Manga browse and search, expanding
Continue/Trending carousels, static 21-title Latest Updates grids, Anikoto episode catalogs, the
fullscreen MegaPlay player flow, local playback progress, MangaDex chapter/page reading, MangaBaka
enrichment, fullscreen long-strip reading, local chapter/scroll resume, rich title details,
pagination, the typed Electron bridge, SQLite persistence, and the production build are
implemented. For current verified runtime status and next steps, see [CONTEXT.md](CONTEXT.md).
