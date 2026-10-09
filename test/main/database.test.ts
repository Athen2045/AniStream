import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "../../src/main/database";
import type { AniListDashboard } from "../../src/shared/contracts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("local reading progress", () => {
  it("persists and clears the last verified AniList dashboard", () => {
    const directory = mkdtempSync(join(tmpdir(), "anistream-database-"));
    temporaryDirectories.push(directory);
    const database = openAppDatabase(join(directory, "anistream.sqlite"));
    const dashboard: AniListDashboard = {
      profile: {
        id: 42,
        name: "Athen101",
        avatarUrl: "https://example.test/avatar.jpg",
        siteUrl: "https://anilist.co/user/Athen101",
        animeCount: 12,
        episodesWatched: 100,
        minutesWatched: 2_400,
        mangaCount: 8,
        chaptersRead: 300,
        volumesRead: 20,
      },
      animeLists: [],
      mangaLists: [],
      fetchedAt: "2026-07-31T00:00:00.000Z",
    };

    database.saveCachedAniListDashboard(dashboard);
    expect(database.getCachedAniListDashboard()).toEqual(dashboard);

    database.clearCachedAniListDashboard();
    expect(database.getCachedAniListDashboard()).toBeUndefined();
    database.close();
  });

  it("persists manga language and exact scanlation group preferences across restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "anistream-database-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "anistream.sqlite");
    let database = openAppDatabase(databasePath);

    database.saveMangaReaderPreferences({
      aniListId: 30_013,
      translatedLanguage: "ja",
      preferredGroupId: "group-uuid",
    });
    // Manga is offered in English and Japanese only.
    expect(() =>
      database.saveMangaReaderPreferences({ aniListId: 30_013, translatedLanguage: "pt-br" }),
    ).toThrow();
    database.close();

    database = openAppDatabase(databasePath);
    expect(database.getMangaReaderPreferences(30_013)).toMatchObject({
      aniListId: 30_013,
      translatedLanguage: "ja",
      preferredGroupId: "group-uuid",
    });
    database.close();
  });
});
