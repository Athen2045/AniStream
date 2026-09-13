import { describe, expect, it } from "vitest";
import { ipcArgValidators } from "../../src/main/ipc-validation";

describe("For You preview IPC validation", () => {
  it("accepts a normalized interaction event", () => {
    expect(
      ipcArgValidators["recommendations:record-interaction"]([
        {
          anilistId: 44,
          mediaType: "MANGA",
          occurredAt: 1_754_000_000_000,
          eventType: "explored",
          source: "detail",
        },
      ]),
    ).toEqual([
      {
        anilistId: 44,
        mediaType: "MANGA",
        occurredAt: 1_754_000_000_000,
        eventType: "explored",
        source: "detail",
      },
    ]);
  });

  it("rejects malformed interaction events", () => {
    expect(() =>
      ipcArgValidators["recommendations:record-interaction"]([
        {
          anilistId: 0,
          mediaType: "MANGA",
          occurredAt: 1,
          eventType: "explored",
          source: "detail",
        },
      ]),
    ).toThrow(/rejected malformed/);
  });
});
