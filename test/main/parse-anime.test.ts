import { describe, expect, it } from "vitest";
import { normalizeEpisodes } from "../../src/main/parse-anime";

describe("normalizeEpisodes", () => {
  it("normalizes a Parse-style data envelope without trusting provider field names", () => {
    expect(
      normalizeEpisodes({
        status: "success",
        data: {
          episodes: [
            {
              id: "a2",
              episode_number: 2,
              season_number: 1,
              name: "The second episode",
              air_date: "2026-07-27",
            },
            { id: "a1", episode: 1, title: "The first episode" },
          ],
        },
      }),
    ).toEqual([
      { id: "a1", number: 1, season: undefined, title: "The first episode" },
      {
        id: "a2",
        number: 2,
        season: 1,
        title: "The second episode",
        airDate: "2026-07-27",
      },
    ]);
  });

  it("ignores malformed rows and returns an empty guide for unknown shapes", () => {
    expect(
      normalizeEpisodes({ data: { episodes: [{ title: "missing number" }, null, "bad"] } }),
    ).toEqual([]);
  });
});
