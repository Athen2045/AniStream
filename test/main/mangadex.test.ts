import { describe, expect, it } from "vitest";
import {
  findExactAniListMapping,
  findLatestNumericChapter,
  parseRateLimitCooldownMs,
} from "../../src/main/mangadex";

describe("MangaDex normalization", () => {
  it("maps only a result with the exact AniList external ID", () => {
    const payload = {
      data: [
        { id: "similar-title", attributes: { links: { al: "999" } } },
        { id: "exact-title", attributes: { links: { al: "118586" } } },
      ],
    };
    expect(findExactAniListMapping(payload, 118586)).toBe("exact-title");
    expect(findExactAniListMapping(payload, 123)).toBeUndefined();
  });

  it("rejects ambiguous duplicate AniList mappings", () => {
    expect(
      findExactAniListMapping(
        {
          data: [
            { id: "first", attributes: { links: { al: "118586" } } },
            { id: "second", attributes: { links: { al: "118586" } } },
          ],
        },
        118586,
      ),
    ).toBeUndefined();
  });

  it("finds the greatest numeric chapter across volumes", () => {
    const payload = {
      volumes: {
        "1": { chapters: { "1": {}, "2.5": {} } },
        "2": { chapters: { "10": {}, extra: {} } },
      },
    };
    expect(findLatestNumericChapter(payload)).toBe(10);
  });

  it("returns undefined when a language aggregate has no readable chapters", () => {
    expect(findLatestNumericChapter({ volumes: {} })).toBeUndefined();
  });

  it("honors MangaDex's UNIX reset timestamp before generic Retry-After", () => {
    const resetAt = Math.floor(Date.now() / 1_000) + 30;
    expect(parseRateLimitCooldownMs(String(resetAt), "120")).toBeGreaterThan(28_000);
  });
});
