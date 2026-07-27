import { describe, expect, it, vi } from "vitest";
import { createBoundedCache } from "../../src/main/anilist/cache";

describe("createBoundedCache", () => {
  it("returns a stored value before it expires", () => {
    const cache = createBoundedCache<string>({ maxEntries: 10, ttlMs: 1_000 });
    cache.set("a", "value");
    expect(cache.get("a")).toBe("value");
  });

  it("expires entries once the TTL elapses", () => {
    vi.useFakeTimers();
    try {
      const cache = createBoundedCache<string>({ maxEntries: 10, ttlMs: 1_000 });
      cache.set("a", "value");
      vi.advanceTimersByTime(1_001);
      expect(cache.get("a")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts the oldest entry once maxEntries is exceeded", () => {
    const cache = createBoundedCache<number>({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("treats a read as recently used, protecting it from eviction", () => {
    const cache = createBoundedCache<number>({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });
});
