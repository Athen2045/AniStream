import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readBandwidthEstimate,
  writeBandwidthEstimate,
} from "../../src/renderer/src/player/player-prefs";

afterEach(() => vi.unstubAllGlobals());

describe("player preferences", () => {
  it("remembers the measured connection speed within a sensible range", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    expect(readBandwidthEstimate()).toBeUndefined();
    writeBandwidthEstimate(12_345_678.9);
    expect(readBandwidthEstimate()).toBe(12_345_679);
    // Nonsense or extreme values are not kept.
    writeBandwidthEstimate(Number.NaN);
    writeBandwidthEstimate(100);
    writeBandwidthEstimate(1e12);
    expect(readBandwidthEstimate()).toBe(12_345_679);
    store.set("anistream.player.bandwidth", "garbage");
    expect(readBandwidthEstimate()).toBeUndefined();
  });
});
