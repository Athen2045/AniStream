import { describe, expect, it } from "vitest";
import { normalizeIpcError } from "../../src/preload/ipc-error";

describe("normalizeIpcError", () => {
  it("replaces Electron's wrapped AniList rate-limit error with recovery guidance", () => {
    const error = normalizeIpcError(
      new Error(
        "Error invoking remote method 'anilist:browse': Error: AniList is rate-limiting requests right now. AniStream will pause new requests briefly — please try again shortly.",
      ),
    );

    expect(error.message).toBe(
      "AniList is busy right now. Please wait a few minutes, then try again.",
    );
    expect(error.message).not.toMatch(/invoking remote method|anilist:browse/i);
  });

  it("removes Electron's transport prefix from other handled errors", () => {
    expect(
      normalizeIpcError(
        new Error("Error invoking remote method 'anilist:browse': Error: Search is unavailable."),
      ).message,
    ).toBe("Search is unavailable.");
  });
});
