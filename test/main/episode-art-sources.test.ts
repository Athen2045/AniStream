import { describe, expect, it } from "vitest";
import type { AnimeEpisodeArt } from "../../src/shared/contracts";
import { chainEpisodeArt, type EpisodeArtSource } from "../../src/main/episode-art-sources";

const rows = (name: string, numbers: number[]): AnimeEpisodeArt[] =>
  numbers.map((number) => ({ number, stillUrl: `https://${name}.example/${number}.jpg` }));

function source(
  name: string,
  numbers: number[],
  complete = true,
): EpisodeArtSource & { calls: number } {
  const result = {
    calls: 0,
    async load() {
      result.calls += 1;
      return { art: rows(name, numbers), complete };
    },
  };
  return result;
}

const failing = (): EpisodeArtSource & { calls: number } => {
  const result = {
    calls: 0,
    async load(): Promise<never> {
      result.calls += 1;
      throw new Error("down");
    },
  };
  return result;
};

const input = { aniListId: 1, episodes: 4, focus: 1 };

describe("chainEpisodeArt", () => {
  it("stops after a source that covers every episode", async () => {
    const first = source("a", [1, 2, 3, 4]);
    const second = source("b", [1, 2, 3, 4]);
    const result = await chainEpisodeArt([first, second], input);
    expect(result.complete).toBe(true);
    expect(result.art.map((row) => row.stillUrl)).toEqual(
      rows("a", [1, 2, 3, 4]).map((r) => r.stillUrl),
    );
    expect(second.calls).toBe(0);
  });

  it("fills gaps from later sources without overriding earlier ones", async () => {
    const result = await chainEpisodeArt(
      [source("a", [1, 3]), source("b", [1, 2]), source("c", [4])],
      input,
    );
    expect(result.art.map((row) => row.stillUrl)).toEqual([
      "https://a.example/1.jpg",
      "https://b.example/2.jpg",
      "https://a.example/3.jpg",
      "https://c.example/4.jpg",
    ]);
  });

  it("keeps going after a failure but marks the result incomplete", async () => {
    const last = source("c", [1, 2, 3, 4]);
    const result = await chainEpisodeArt([failing(), last], input);
    expect(last.calls).toBe(1);
    expect(result.art).toHaveLength(4);
    expect(result.complete).toBe(false);
  });

  it("only needs the episodes around the focus for long series", async () => {
    // Episodes 921..1040 (pages 46-51) are the focus window for episode 1000 of 1100.
    const near = Array.from({ length: 120 }, (_, index) => 921 + index);
    const second = source("b", [1]);
    await chainEpisodeArt([source("a", near), second], {
      aniListId: 21,
      episodes: 1100,
      focus: 1000,
    });
    expect(second.calls).toBe(0);
  });

  it("returns nothing when every source is empty", async () => {
    expect(await chainEpisodeArt([source("a", []), source("b", [])], input)).toEqual({
      art: [],
      complete: true,
    });
  });
});

describe("chainEpisodeArt field merge", () => {
  it("keeps an earlier title while a later source fills the missing still", async () => {
    const textOnly: EpisodeArtSource = {
      load: async () => ({
        art: [{ number: 1, title: "Real title", synopsis: "Plot." }],
        complete: true,
      }),
    };
    const stills: EpisodeArtSource = {
      load: async () => ({
        art: [{ number: 1, stillUrl: "https://b.example/1.jpg", title: "Other title" }],
        complete: true,
      }),
    };
    const result = await chainEpisodeArt([textOnly, stills], {
      aniListId: 1,
      episodes: 1,
      focus: 1,
    });
    expect(result.art).toEqual([
      { number: 1, stillUrl: "https://b.example/1.jpg", title: "Real title", synopsis: "Plot." },
    ]);
  });
});
