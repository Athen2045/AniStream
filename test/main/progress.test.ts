import { describe, expect, it } from "vitest";
import { isProgressComplete } from "../../src/shared/progress";

describe("progress completion", () => {
  it("treats a completed AniList entry as complete even without a total", () => {
    expect(isProgressComplete("COMPLETED", 3)).toBe(true);
  });

  it("treats progress at the known total as complete", () => {
    expect(isProgressComplete("CURRENT", 12, 12)).toBe(true);
    expect(isProgressComplete("CURRENT", 11, 12)).toBe(false);
  });
});
