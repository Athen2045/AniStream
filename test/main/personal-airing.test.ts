import { describe, expect, it } from "vitest";
import { loadPersonalAiring } from "../../src/main/anilist/personal-airing";

describe("bounded personal airing query", () => {
  it("requests exact title IDs and returns only valid requested past releases", async () => {
    const result = await loadPersonalAiring(
      async (_query, variables) => {
        expect(variables.ids).toEqual([10, 20]);
        expect(variables.since).toBe(740800);
        return {
          Page: {
            airingSchedules: [
              { mediaId: 10, episode: 5, airingAt: 3300000 },
              { mediaId: 10, episode: 4, airingAt: 3200000 },
              { mediaId: 30, episode: 1, airingAt: 3300000 },
              { mediaId: 20, episode: 2, airingAt: 3500000 },
              { mediaId: 20, episode: "bad", airingAt: 3300000 },
            ],
          },
        };
      },
      [10, 10, 20],
      3332800000,
    );
    expect(result).toEqual([{ aniListId: 10, episode: 5, airedAt: 3300000 }]);
  });
  it("does no request for empty input and rejects malformed responses and errors", async () => {
    expect(
      await loadPersonalAiring(async () => {
        throw new Error("must not fetch");
      }, []),
    ).toEqual([]);
    await expect(loadPersonalAiring(async () => ({}), [10])).rejects.toThrow();
    for (const message of ["timeout", "429", "unavailable"])
      await expect(
        loadPersonalAiring(async () => {
          throw new Error(message);
        }, [10]),
      ).rejects.toThrow(message);
  });
});
