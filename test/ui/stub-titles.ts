import type { ElectronApplication } from "@playwright/test";

/** Titles as AniList describes them; For You cards carry only id, title and cover. */
export const TITLES = {
  8500001: { title: "Fixture Finished Show", status: "FINISHED", episodes: 12, listed: 12 },
  // Episode 9 airs next week, so 8 have aired; the source lists only 6.
  8500002: { title: "Fixture Airing Show", status: "RELEASING", episodes: 12, listed: 6, next: 9 },
  // The first episode-list request fails; Retry gets 3 episodes.
  8500003: { title: "Fixture Flaky Show", status: "FINISHED", episodes: 3, listed: 3, flaky: true },
  // A long runner with no other season, browsed by story arc (like One Piece).
  8500004: {
    title: "Fixture Long Runner",
    status: "FINISHED",
    episodes: 120,
    listed: 120,
    arcs: true,
  },
} as const;

/**
 * What AniList connects to each title: the airing show has a previous season; every other title
 * stands alone (no prequel, sequel, movie or special).
 */
const PREQUELS: Record<number, { id: number; title: string }> = {
  8500002: { id: 8500012, title: "Fixture Airing Show Origins" },
};

export interface CatalogCall {
  aniListId: number;
  totalEpisodes: number;
}

/**
 * Stubs the main process for these titles: For You lists them, title details answer after half a
 * second (as AniList does), the episode list answers from the source's numbers above, and the
 * series graph and story arcs follow `PREQUELS` and `arcs`.
 */
export async function stubTitles(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, [titles, prequels]) => {
      const calls: unknown[] = [];
      (globalThis as { catalogCalls?: unknown[] }).catalogCalls = calls;
      const failed = new Set<number>();
      const card = (id: string) => ({
        anilistId: Number(id),
        mediaType: "ANIME",
        title: titles[id as keyof typeof titles].title,
        coverUrl: `https://img.anilist.example/${id}.jpg`,
        score: 0.8,
        reasonCodes: ["highly-rated"],
      });
      for (const channel of [
        "discovery:for-you",
        "anilist:media-detail",
        "anime:episode-catalog",
        "anilist:series-graph",
        "anime:episode-ranges",
      ])
        ipcMain.removeHandler(channel);
      const catalogMedia = (id: number, title: string, episodes: number) => ({
        id,
        type: "ANIME",
        title,
        coverUrl: `https://img.anilist.example/${id}.jpg`,
        format: "TV",
        status: "FINISHED",
        totalProgress: episodes,
        genres: [],
        seasonYear: 2026,
        siteUrl: `https://anilist.co/anime/${id}`,
      });
      ipcMain.handle("anilist:series-graph", (_event, id: number) => {
        const currentId = Object.entries(prequels).find(([, prequel]) => prequel.id === id)?.[0];
        const ownerId = currentId ? Number(currentId) : id;
        const known = titles[String(ownerId) as keyof typeof titles];
        const current = catalogMedia(ownerId, known.title, known.episodes);
        const prequel = prequels[ownerId];
        if (!prequel) return [{ media: current, titles: [known.title], relations: [] }];
        const earlier = catalogMedia(prequel.id, prequel.title, 12);
        return [
          {
            media: current,
            titles: [known.title],
            relations: [{ relationType: "PREQUEL", media: earlier }],
          },
          {
            media: earlier,
            titles: [prequel.title],
            relations: [{ relationType: "SEQUEL", media: current }],
          },
        ];
      });
      ipcMain.handle("anime:episode-ranges", (_event, input: { aniListId: number }) =>
        "arcs" in titles[String(input.aniListId) as keyof typeof titles]
          ? {
              kind: "arc",
              ranges: [
                { title: "Fixture Arc One", start: 1, end: 60 },
                { title: "Fixture Arc Two", start: 61, end: 120 },
              ],
            }
          : undefined,
      );
      ipcMain.handle("discovery:for-you", (_event, type: string) =>
        type === "ANIME"
          ? { status: "ready", requestId: "episodes-feed", items: Object.keys(titles).map(card) }
          : { status: "learning", items: [] },
      );
      ipcMain.handle("anilist:media-detail", async (_event, id: number) => {
        await new Promise((done) => setTimeout(done, 500));
        const known = titles[String(id) as keyof typeof titles] as {
          title: string;
          status: string;
          episodes: number;
          next?: number;
        };
        return {
          id,
          type: "ANIME",
          title: known.title,
          coverUrl: `https://img.anilist.example/${id}.jpg`,
          format: "TV",
          status: known.status,
          totalProgress: known.episodes,
          genres: ["Drama"],
          season: "SPRING",
          seasonYear: 2026,
          siteUrl: `https://anilist.co/anime/${id}`,
          ...(known.next
            ? {
                nextAiringEpisode: {
                  episode: known.next,
                  airingAt: Math.floor(Date.now() / 1000) + 7 * 86_400,
                },
              }
            : {}),
          synonyms: [],
          studios: [],
          producers: [],
          characters: [],
          staff: [],
          relations: [],
          recommendations: [],
          externalLinks: [],
        };
      });
      ipcMain.handle(
        "anime:episode-catalog",
        (_event, input: { aniListId: number; totalEpisodes: number }) => {
          calls.push({ aniListId: input.aniListId, totalEpisodes: input.totalEpisodes });
          const known = titles[String(input.aniListId) as keyof typeof titles] as {
            listed: number;
            flaky?: boolean;
          };
          if (known.flaky && !failed.has(input.aniListId)) {
            failed.add(input.aniListId);
            throw new Error("The episode index timed out.");
          }
          return {
            status: "available",
            provider: "anime-source",
            checkedAt: new Date().toISOString(),
            seasons: [
              {
                id: `index:${input.aniListId}:season:1`,
                number: 1,
                title: "Season 1",
                episodes: Array.from({ length: known.listed }, (_, index) => ({
                  id: `${input.aniListId}-${index + 1}`,
                  number: index + 1,
                })),
              },
            ],
          };
        },
      );
    },
    [TITLES, PREQUELS] as const,
  );
}

export const catalogCalls = (app: ElectronApplication, id: number): Promise<CatalogCall[]> =>
  app.evaluate(
    (_electron, wanted) =>
      ((globalThis as { catalogCalls?: CatalogCall[] }).catalogCalls ?? []).filter(
        (call) => call.aniListId === wanted,
      ),
    id,
  );
