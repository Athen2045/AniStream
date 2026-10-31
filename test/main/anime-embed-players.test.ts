import { describe, expect, it, vi } from "vitest";
import {
  aniListEmbedCandidates,
  animePlaybackFromPlayers,
} from "../../src/main/anime-embed-players";
import type { AnimeAniListEmbedProvider } from "../../src/main/provider-config";

const config: AnimeAniListEmbedProvider = {
  id: "first",
  kind: "anilist-embed",
  episodeUrl: "https://first.example/e/{aniListId}/{episode}?lang={audio}&autoplay=1",
  playerOrigin: "https://first.example",
  startAtParam: "t",
  eventSource: "player",
};
const input = { aniListId: 154587, title: "Frieren", episode: 2 };

describe("AniList-addressed anime player", () => {
  it("offers sub and dub, the requested audio first, with the saved position", () => {
    const candidates = aniListEmbedCandidates(config, {
      ...input,
      audio: "dub",
      startAtSeconds: 145.7,
    });
    expect(candidates.map((candidate) => [candidate.language, candidate.url])).toEqual([
      ["dub", "https://first.example/e/154587/2?lang=dub&autoplay=1&t=145"],
      ["sub", "https://first.example/e/154587/2?lang=sub&autoplay=1&t=145"],
    ]);
    expect(candidates[0]).toMatchObject({ player: "first", eventSource: "player", kind: "embed" });
  });

  it("leaves out the start time when there is none and rejects bad input", () => {
    expect(aniListEmbedCandidates(config, input)[0]!.url).toBe(
      "https://first.example/e/154587/2?lang=sub&autoplay=1",
    );
    expect(() => aniListEmbedCandidates(config, { ...input, episode: 0 })).toThrow();
    expect(() => aniListEmbedCandidates(config, { ...input, aniListId: -1 })).toThrow();
  });

  it("lists every player's candidates in order and keeps going when one fails", async () => {
    const indexed = vi.fn().mockResolvedValue({
      status: "available",
      candidates: [{ id: "i", label: "Sub", kind: "embed", url: "https://second.example/x" }],
      attemptedSources: ["episode-index"],
    });
    const result = await animePlaybackFromPlayers(
      [
        { kind: "anilist-embed", config },
        { kind: "indexed", id: "second", getPlayback: indexed },
      ],
      input,
    );
    expect(result.candidates.map((candidate) => candidate.player)).toEqual([
      "first",
      "first",
      "second",
    ]);
    const down = vi.fn().mockRejectedValue(new Error("down"));
    const broken = await animePlaybackFromPlayers(
      [
        { kind: "indexed", id: "second", getPlayback: down },
        { kind: "anilist-embed", config },
      ],
      input,
    );
    expect(broken.status).toBe("available");
    expect(broken.candidates).toHaveLength(2);
    const none = await animePlaybackFromPlayers(
      [{ kind: "indexed", id: "second", getPlayback: down }],
      input,
    );
    expect(none).toMatchObject({ status: "unavailable", message: "down" });
  });
});
