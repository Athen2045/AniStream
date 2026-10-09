import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  embeddedPlayerOrigins,
  fillUrlTemplate,
  isDatabaseEnabled,
  loadProviderConfig,
  parseProviderConfig,
  primaryMedia,
} from "../../src/main/provider-config";

const animePlayer = {
  id: "anime-player",
  kind: "indexed-embed",
  recentIndexUrl: "https://index.example/recent?limit=100",
  seriesUrl: "https://index.example/series/{seriesId}",
  episodeEmbedUrl: "https://player.example/e/{embedId}/{audio}",
  aniListEmbedUrl: "https://player.example/a/{aniListId}/{episode}/{audio}",
};
const morePlayer = {
  id: "more-player",
  kind: "tmdb-embed",
  movieUrl: "https://more.example/m/{tmdbId}?autoPlay=true",
  tvUrl: "https://more.example/t/{tmdbId}/{season}/{episode}?autoPlay=true",
  startAtParam: "startAt",
};
const valid = {
  version: 2,
  anime: {
    database: [{ id: "anilist" }, { id: "mal" }, { id: "kitsu" }],
    media: [animePlayer],
  },
  manga: {
    database: [
      { id: "anilist" },
      { id: "mangadex" },
      { id: "mangabaka" },
      { id: "mangaupdates" },
      { id: "mal" },
    ],
    media: [{ id: "mangadex", kind: "mangadex" }],
  },
  more: { database: [{ id: "tmdb" }], media: [morePlayer] },
};

describe("local provider configuration", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("parses all three sections and derives each player origin", () => {
    const config = parseProviderConfig(valid);
    expect(config.anime.database).toEqual(["anilist", "mal", "kitsu"]);
    expect(config.manga.database).toEqual([
      "anilist",
      "mangadex",
      "mangabaka",
      "mangaupdates",
      "mal",
    ]);
    expect(config.more.database).toEqual(["tmdb"]);
    expect(primaryMedia(config.anime)?.seriesUrl).toBe("https://index.example/series/{seriesId}");
    expect(primaryMedia(config.anime)?.playerOrigin).toBe("https://player.example");
    expect(primaryMedia(config.manga)).toEqual({ id: "mangadex", kind: "mangadex" });
    expect(primaryMedia(config.more)?.origin).toBe("https://more.example");
    expect(primaryMedia(config.more)?.startAtParam).toBe("startAt");
    expect(primaryMedia(config.more)?.stripElectronUserAgent).toBe(false);
  });

  it("defaults to every built-in database provider and unconfigured players", () => {
    const config = parseProviderConfig({});
    expect(config.anime).toEqual({ database: ["anilist", "mal", "kitsu"], media: [] });
    expect(config.manga.media).toEqual([{ id: "mangadex", kind: "mangadex" }]);
    expect(
      parseProviderConfig({ manga: { media: [{ id: "mangadex", kind: "mangadex" }] } }).manga.media,
    ).toEqual([{ id: "mangadex", kind: "mangadex" }]);
    expect(config.more).toEqual({ database: ["tmdb"], media: [] });
    expect(embeddedPlayerOrigins(config)).toEqual([]);
  });

  it("disables optional database providers but keeps required ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = parseProviderConfig({
      anime: {
        database: [
          { id: "anilist", enabled: false },
          { id: "mal", enabled: false },
        ],
      },
      manga: { database: [{ id: "mangabaka" }, { id: "toString" }, { id: "nope" }] },
    });
    expect(config.anime.database).toEqual(["anilist"]);
    expect(isDatabaseEnabled(config, "anime", "mal")).toBe(false);
    expect(isDatabaseEnabled(config, "anime", "kitsu")).toBe(false);
    // Required providers left out of the list still run; unlisted optional ones stay off.
    expect(config.manga.database).toEqual(["mangabaka", "anilist", "mangadex"]);
    expect(isDatabaseEnabled(config, "manga", "mal")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("orders media providers as primary then fallbacks and frames every origin", () => {
    const config = parseProviderConfig({
      more: {
        media: [
          { ...morePlayer, enabled: false },
          {
            ...morePlayer,
            id: "backup",
            movieUrl: "https://b.example/m/{tmdbId}",
            tvUrl: "https://b.example/t/{tmdbId}/{season}/{episode}",
          },
          {
            ...morePlayer,
            id: "third",
            movieUrl: "https://c.example/m/{tmdbId}",
            tvUrl: "https://c.example/t/{tmdbId}/{season}/{episode}",
          },
        ],
      },
      anime: { media: [animePlayer] },
    });
    expect(config.more.media.map((provider) => provider.id)).toEqual(["backup", "third"]);
    expect(primaryMedia(config.more)?.origin).toBe("https://b.example");
    expect(embeddedPlayerOrigins(config)).toEqual([
      "https://player.example",
      "https://b.example",
      "https://c.example",
    ]);
  });

  it("drops only an invalid media entry so other providers keep working", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = parseProviderConfig({
      ...valid,
      anime: {
        media: [
          { ...animePlayer, episodeEmbedUrl: "http://player.example/e/{embedId}/{audio}" },
          { ...animePlayer, id: "backup" },
        ],
      },
    });
    expect(config.anime.media.map((provider) => provider.id)).toEqual(["backup"]);
    expect(primaryMedia(config.more)).toBeDefined();
  });

  it("rejects bad ids, kinds, placeholders, mixed origins, credentials, and params", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const anime = (patch: Record<string, unknown>) =>
      primaryMedia(parseProviderConfig({ anime: { media: [{ ...animePlayer, ...patch }] } }).anime);
    const more = (patch: Record<string, unknown>) =>
      primaryMedia(parseProviderConfig({ more: { media: [{ ...morePlayer, ...patch }] } }).more);

    expect(anime({ id: "Bad Id" })).toBeUndefined();
    expect(anime({ kind: "tmdb-embed" })).toBeUndefined();
    expect(anime({ episodeEmbedUrl: "https://player.example/e/{embedId}" })).toBeUndefined();
    expect(
      anime({ aniListEmbedUrl: "https://other.example/a/{aniListId}/{episode}/{audio}" }),
    ).toBeUndefined();
    expect(anime({ recentIndexUrl: "https://user:pw@index.example/recent" })).toBeUndefined();
    expect(anime({ seriesUrl: "https://index.example/series" })).toBeUndefined();
    expect(anime({ seriesUrl: "https://other.example/series/{seriesId}" })).toBeUndefined();
    expect(more({ tvUrl: "https://more.example/t/{tmdbId}/{season}" })).toBeUndefined();
    expect(
      more({ tvUrl: "https://elsewhere.example/t/{tmdbId}/{season}/{episode}" }),
    ).toBeUndefined();
    expect(more({ startAtParam: "start at" })).toBeUndefined();
    expect(more({ stripElectronUserAgent: "yes" })).toBeUndefined();
    expect(more({ stripElectronUserAgent: true })?.stripElectronUserAgent).toBe(true);
    expect(
      parseProviderConfig({ more: { media: [morePlayer, morePlayer] } }).more.media,
    ).toHaveLength(1);
    expect(
      parseProviderConfig({ manga: { media: [{ id: "x", kind: "other" }] } }).manga.media,
    ).toEqual([]);
    expect(parseProviderConfig("nope")).toEqual(parseProviderConfig({}));
  });

  it("upgrades the legacy single-provider shape", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { id: _a, kind: _b, ...legacyAnime } = animePlayer;
    const { id: _c, kind: _d, ...legacyMore } = morePlayer;
    const config = parseProviderConfig({ animeSource: legacyAnime, morePlayer: legacyMore });
    expect(primaryMedia(config.anime)?.playerOrigin).toBe("https://player.example");
    expect(primaryMedia(config.more)?.origin).toBe("https://more.example");
    // The legacy shape always applied the approved UA override, so the upgrade keeps it.
    expect(primaryMedia(config.more)?.stripElectronUserAgent).toBe(true);
    expect(config.manga.database).toContain("mangabaka");
  });

  it("fills templates with encoded values", () => {
    expect(fillUrlTemplate(morePlayer.tvUrl, { tmdbId: 93405, season: 1, episode: 2 })).toBe(
      "https://more.example/t/93405/1/2?autoPlay=true",
    );
    expect(fillUrlTemplate("https://p.example/{x}", { x: "a/b" })).toBe("https://p.example/a%2Fb");
  });

  it("loads the first existing file and treats a missing or unreadable file as unconfigured", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = mkdtempSync(join(tmpdir(), "anistream-providers-"));
    dirs.push(dir);
    const file = join(dir, "providers.local.json");
    const unconfigured = parseProviderConfig({});
    expect(loadProviderConfig([file])).toEqual(unconfigured);
    writeFileSync(file, "{ not json");
    expect(loadProviderConfig([file])).toEqual(unconfigured);
    writeFileSync(file, JSON.stringify(valid));
    expect(primaryMedia(loadProviderConfig([join(dir, "missing.json"), file]).more)?.origin).toBe(
      "https://more.example",
    );
  });
});
