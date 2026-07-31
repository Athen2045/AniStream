import { readFile } from "node:fs/promises";

const [
  main,
  aniListClient,
  aniListQueries,
  mangaDex,
  preload,
  contracts,
  providers,
  renderer,
  catalog,
  catalogStyles,
  mangaKind,
  anikoto,
  animeWatch,
  mediaDetail,
  mangaReader,
  database,
] = await Promise.all([
  readFile("src/main/index.ts", "utf8"),
  readFile("src/main/anilist/client.ts", "utf8"),
  readFile("src/main/anilist/queries.ts", "utf8"),
  readFile("src/main/mangadex.ts", "utf8"),
  readFile("src/preload/index.ts", "utf8"),
  readFile("src/shared/contracts.ts", "utf8"),
  readFile("src/shared/providers.ts", "utf8"),
  readFile("src/renderer/src/App.tsx", "utf8"),
  readFile("src/renderer/src/CatalogView.tsx", "utf8"),
  readFile("src/renderer/src/styles.css", "utf8"),
  readFile("src/main/manga-kind.ts", "utf8"),
  readFile("src/main/anikoto.ts", "utf8"),
  readFile("src/renderer/src/AnimeWatchExperience.tsx", "utf8"),
  readFile("src/renderer/src/MediaDetailModal.tsx", "utf8"),
  readFile("src/renderer/src/MangaReaderFullscreen.tsx", "utf8"),
  readFile("src/main/database.ts", "utf8"),
]);
const aniList = aniListClient + aniListQueries;

for (const [name, source, fragments] of [
  [
    "main process",
    main,
    [
      "const restorePromise = aniList.restore()",
      "registerTrustedIpcHandler",
      '"anilist:browse"',
      '"anilist:media-detail"',
    ],
  ],
  [
    "AniList client",
    aniList,
    ["BROWSE_MEDIA_QUERY", "MEDIA_DETAIL_QUERY", "profile: this.profile"],
  ],
  [
    "preload bridge",
    preload,
    ['invoke("anilist:browse"', 'invoke("anilist:media-detail"', 'invoke("mangadex:availability"'],
  ],
  [
    "shared contracts",
    contracts,
    ["AniListCatalogPage", "AniListMediaDetail", "BrowseAniListInput"],
  ],
  [
    "provider contracts",
    providers,
    ["AnimeTitleMapping", "AnimeSeason", "AnimeEpisode", "AnimeHoster", "AnimeVideoVariant"],
  ],
  ["renderer", renderer, ["CatalogView", "GlobalSearch", "MediaDetailModal"]],
  [
    "MangaDex adapter",
    mangaDex,
    ["findExactAniListMapping", "findLatestNumericChapter", "translatedLanguage[]"],
  ],
  [
    "catalog surfaces",
    catalog,
    [
      "ContentCarousel",
      "Trending {mediaName}",
      "Latest Anime Updates",
      "Latest Manga Updates",
      "latest-updates-grid",
      "getMangaDexAvailability",
    ],
  ],
  ["latest grid styles", catalogStyles, ["grid-template-columns: repeat(7", "latest-update-card"]],
  [
    "manga publication classifier",
    mangaKind,
    ["mangaKindFromOriginalLanguage", "mangaKindFromCountry", "mangaKindFromMalMediaType"],
  ],
  [
    "Anikoto adapter",
    anikoto,
    ["https://anikotoapi.site", "https://megaplay.buzz", "getEpisodeCatalog", "getPlayback"],
  ],
  [
    "anime player",
    animeWatch,
    [
      "AnikotoEmbedPlayer",
      "requestFullscreen",
      '"fullscreenchange"',
      "parseMegaPlayEvent",
      "AnimatePresence",
      "watch-view-transition",
    ],
  ],
  [
    "media detail",
    mediaDetail,
    ["MangaChapterBrowser", "MangaReaderFullscreen", "autoPlayRequest", "chooseChapterToRead"],
  ],
  [
    "manga reader",
    mangaReader,
    [
      "useScroll",
      "scrollYProgress",
      "saveMangaReadingResume",
      '"fullscreenchange"',
      "Previous chapter",
      "Next chapter",
    ],
  ],
  [
    "manga resume database",
    database,
    ["manga_reading_resume", "saveMangaReadingResume", "getMangaReadingResume"],
  ],
]) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) throw new Error(`${name} is missing ${fragment}`);
  }
}

if (main.includes("await aniList.restore()")) {
  throw new Error("AniList session restoration must not block the first renderer paint.");
}

if (
  main.indexOf("const restorePromise = aniList.restore()") >
  main.indexOf("createWindow(rendererUrl)")
) {
  throw new Error("AniList session restoration must begin before the renderer is created.");
}

if (animeWatch.includes("sandbox=")) {
  throw new Error("The approved MegaPlay iframe must not regain an HTML sandbox attribute.");
}

if (mediaDetail.includes("Keep your progress current")) {
  throw new Error("The removed AniList sync card must not return to the title detail.");
}

console.log(
  "Verified durable session, catalog/detail IPC, static Latest grids, MangaDex classification/reader resume, Framer Motion transitions, Anikoto playback, and provider contracts.",
);
