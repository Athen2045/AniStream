import { describe, expect, it } from "vitest";
import {
  createMorePlayerFallbackMemory,
  nextMorePlayerAfterFailure,
  nextMorePlayerManually,
} from "../../src/renderer/src/more-player-fallback";

describe("More player fallback", () => {
  it("tries each configured player once after failures, starting from any player", () => {
    expect(nextMorePlayerAfterFailure({ providerIndex: 0, providerCount: 1 }, 0)).toBeUndefined();
    expect(nextMorePlayerAfterFailure({ providerIndex: 0, providerCount: 3 }, 0)).toBe(1);
    expect(nextMorePlayerAfterFailure({ providerIndex: 1, providerCount: 3 }, 0)).toBe(2);
    expect(nextMorePlayerAfterFailure({ providerIndex: 2, providerCount: 3 }, 0)).toBeUndefined();
    // Starting from a remembered fallback wraps through the primary and stops before repeating.
    expect(nextMorePlayerAfterFailure({ providerIndex: 1, providerCount: 3 }, 1)).toBe(2);
    expect(nextMorePlayerAfterFailure({ providerIndex: 2, providerCount: 3 }, 1)).toBe(0);
    expect(nextMorePlayerAfterFailure({ providerIndex: 0, providerCount: 3 }, 1)).toBeUndefined();
  });

  it("cycles manually through every player", () => {
    expect(nextMorePlayerManually({ providerIndex: 0, providerCount: 2 })).toBe(1);
    expect(nextMorePlayerManually({ providerIndex: 1, providerCount: 2 })).toBe(0);
  });

  it("remembers the working player per title and type, bounded", () => {
    const memory = createMorePlayerFallbackMemory();
    expect(memory.initial(27205, "MOVIE")).toBe(0);
    memory.remember(27205, "MOVIE", 1);
    expect(memory.initial(27205, "MOVIE")).toBe(1);
    expect(memory.initial(27205, "TV")).toBe(0);
    memory.remember(27205, "MOVIE", 0);
    expect(memory.initial(27205, "MOVIE")).toBe(0);
    memory.remember(1, "TV", 2);
    memory.forget(1, "TV");
    expect(memory.initial(1, "TV")).toBe(0);
    for (let id = 1; id <= 201; id += 1) memory.remember(id, "MOVIE", 1);
    expect(memory.initial(1, "MOVIE")).toBe(0);
    expect(memory.initial(201, "MOVIE")).toBe(1);
  });
});
