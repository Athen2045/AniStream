import { describe, expect, it } from "vitest";
import type { ProviderReadiness } from "../../src/shared/contracts";
import { normalizePlaybackReadiness } from "../../src/renderer/src/app-readiness";

const readiness = (status: ProviderReadiness["status"], message?: string): ProviderReadiness => ({
  provider: "anime-source",
  status,
  checkedAt: "2026-10-29T00:00:00Z",
  ...(message ? { message } : {}),
});

describe("launch playback check", () => {
  it("passes a ready player and reports a turned-off one as disabled", () => {
    expect(normalizePlaybackReadiness(readiness("ready"))).toBeUndefined();
    expect(normalizePlaybackReadiness(readiness("disabled", "Turned off"))).toEqual({
      status: "disabled",
      message: "Turned off",
    });
  });

  it("lets the app open when the player is offline, busy or unavailable", () => {
    expect(normalizePlaybackReadiness(readiness("offline"))).toEqual({
      status: "offline",
      provider: "The anime player",
    });
    expect(normalizePlaybackReadiness(readiness("rate-limited"))).toMatchObject({
      status: "degraded",
      canContinue: true,
      message: expect.stringContaining("busy"),
    });
    expect(normalizePlaybackReadiness(readiness("unavailable"))).toEqual({
      status: "degraded",
      provider: "The anime player",
      canContinue: true,
    });
  });
});
