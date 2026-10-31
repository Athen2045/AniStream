import { describe, expect, it } from "vitest";
import {
  ANIME_BACKUP_PLAYER,
  animePlayerChoice,
  animePlayerOrder,
} from "../../src/renderer/src/anime-player-choice";

const candidate = (player?: string) => ({
  id: "x",
  label: "Sub",
  kind: "embed" as const,
  url: "https://a.example",
  player,
});

describe("anime player order", () => {
  it("keeps the order main returned, one entry per player, then the backup player", () => {
    expect(animePlayerOrder([candidate("first"), candidate("first"), candidate("second")])).toEqual(
      ["first", "second", ANIME_BACKUP_PLAYER],
    );
    expect(animePlayerOrder([candidate()])).toEqual(["main", ANIME_BACKUP_PLAYER]);
    expect(animePlayerOrder([])).toEqual([ANIME_BACKUP_PLAYER]);
  });

  it("remembers a switched player per title for the session", () => {
    animePlayerChoice.set(1, "second");
    expect(animePlayerChoice.get(1)).toBe("second");
    animePlayerChoice.delete(1);
    expect(animePlayerChoice.get(1)).toBeUndefined();
  });
});
