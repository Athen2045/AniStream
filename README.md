# AniStream

AniStream is a personal macOS desktop application that combines anime and manga discovery, list management, anime playback, manga reading, and tracker synchronization in one coherent library. AniList is the primary catalog and tracker, MangaDex supplies manga and chapter delivery, and anime video extraction is isolated behind replaceable source adapters inspired by Zenshin’s provider strategy.

## Feature scope

### Version 1

- Unified anime and manga search backed by AniList.
- Netflix-inspired anime and editorial manga browse pages with featured titles, catalog sorting,
  keyboard-accessible unified search, detailed title modals, and pagination.
- Local SQLite library and progress state for one user on one Mac.
- AniList browser OAuth, profile, complete anime/manga lists, and progress/score/status/notes synchronization.
- MangaDex search, chapter feeds, MangaDex@Home page delivery, reader preferences, and account synchronization.
- Manga reader with single-page, double-page, long-strip, and right-to-left modes.
- Replaceable anime playback adapters: AnimePahe HLS as the primary source, with AnimeTosho/Nyaa-indexed torrents as fallback.
- Internal playback with resume progress and external-player handoff where needed.

Currently implemented from this scope: durable AniList login, profile/list management, unified
search, Anime/Manga navigation, paginated catalog browse, and rich AniList title details including
summaries, episode/chapter counts, studios, cast, staff, relations, recommendations, and official
links. Video extraction and MangaDex chapter reading remain the next provider slices.

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
| Motion + Lucide              | Accessible iconography and reduced-motion-aware search/pagination transitions.                                            |
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

| Variable                    | Service                     | Where to get it                                         | Required                                                                    |
| --------------------------- | --------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `MANGADEX_CLIENT_ID`        | MangaDex personal client    | MangaDex Settings → API clients                         | Required for MangaDex account sync                                          |
| `MANGADEX_CLIENT_SECRET`    | MangaDex personal client    | MangaDex API client settings                            | Required for MangaDex account sync                                          |
| `MANGADEX_USERNAME`         | MangaDex personal client    | Your MangaDex account                                   | Required for current personal-client flow                                   |
| `MANGADEX_PASSWORD`         | MangaDex personal client    | Your MangaDex account                                   | Required for current personal-client flow; move to Keychain before real use |
| `VIDEO_HLS_SOURCE_ID`       | Primary anime video adapter | Set to `animepahe` after the adapter is implemented     | Required for HLS playback                                                   |
| `VIDEO_TORRENT_INDEXER_IDS` | Torrent fallback adapters   | Set to `animetosho,nyaa` after adapters are implemented | Required for torrent fallback                                               |

Provider base URLs are application constants unless a development proxy is explicitly required. Secrets must never be exposed to renderer code or committed.

AniList OAuth is configured for this personal build with the public client ID and
`anistream://auth/anilist` callback. The authorization-code flow reads its client secret from macOS
Keychain after a one-time native prompt; the secret is never packaged or exposed to the renderer.
The resulting access token is encrypted with Electron `safeStorage`, also backed by macOS Keychain.

## Status

Durable AniList login, profile/list management, unified Anime/Manga browse and search, rich title
details, pagination, the typed Electron bridge, SQLite initialization, production build, and
unsigned Apple Silicon package have been verified on macOS. Playback source extraction and
MangaDex reading are not yet connected. For current build status and next steps, see
[CONTEXT.md](CONTEXT.md).
