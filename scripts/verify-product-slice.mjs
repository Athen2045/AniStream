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
]);
const aniList = aniListClient + aniListQueries;

for (const [name, source, fragments] of [
  ["main process", main, ["await aniList.restore()", '"anilist:browse"', '"anilist:media-detail"']],
  [
    "AniList client",
    aniList,
    ["BROWSE_MEDIA_QUERY", "MEDIA_DETAIL_QUERY", "profile: this.profile"],
  ],
  [
    "preload bridge",
    preload,
    [
      'ipcRenderer.invoke("anilist:browse"',
      'ipcRenderer.invoke("anilist:media-detail"',
      '"mangadex:availability"',
    ],
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
    "catalog rails",
    catalog,
    [
      "ContentCarousel",
      "Trending {mediaName}",
      "Latest Anime Updates",
      "Latest Manga Updates",
      "getMangaDexAvailability",
    ],
  ],
]) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) throw new Error(`${name} is missing ${fragment}`);
  }
}

if (main.indexOf("await aniList.restore()") > main.indexOf("\n  createWindow();")) {
  throw new Error("AniList session restoration must finish before the renderer is created.");
}

console.log(
  "Verified durable session, catalog/detail IPC, MangaDex availability, carousels, and provider contracts.",
);
