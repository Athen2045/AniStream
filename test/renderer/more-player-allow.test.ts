import { describe, expect, it } from "vitest";
import { morePlayerAllow } from "../../src/renderer/src/more-player-allow";

describe("More player frame permissions", () => {
  it("keeps bare features for a player that stays on its embed origin", () => {
    expect(morePlayerAllow(undefined)).toBe(
      "autoplay; encrypted-media; fullscreen; picture-in-picture",
    );
  });

  it("also allows the origin a redirecting player runs on", () => {
    expect(morePlayerAllow("https://frame.example")).toBe(
      "autoplay 'src' https://frame.example; encrypted-media 'src' https://frame.example; " +
        "fullscreen 'src' https://frame.example; picture-in-picture 'src' https://frame.example",
    );
  });
});
