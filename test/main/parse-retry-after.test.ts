import { describe, expect, it } from "vitest";
import {
  parseAniListMinIntervalMs,
  parseRateLimitResetMs,
  parseRetryAfterMs,
} from "../../src/main/anilist/client";

describe("parseRetryAfterMs", () => {
  it("parses a delta-seconds Retry-After header", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
  });

  it("parses a zero delta-seconds header", () => {
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("parses an HTTP-date Retry-After header", () => {
    const future = new Date(Date.now() + 45_000);
    const parsed = parseRetryAfterMs(future.toUTCString());
    // Allow slack for the seconds truncation inherent to HTTP-date formatting.
    expect(parsed).toBeGreaterThan(43_000);
    expect(parsed).toBeLessThanOrEqual(46_000);
  });

  it("clamps a past HTTP-date to zero rather than a negative pause", () => {
    const past = new Date(Date.now() - 60_000);
    expect(parseRetryAfterMs(past.toUTCString())).toBe(0);
  });

  it("falls back to a conservative default when the header is missing", () => {
    expect(parseRetryAfterMs(null)).toBe(60_000);
  });

  it("falls back to a conservative default when the header is unparseable", () => {
    expect(parseRetryAfterMs("not-a-valid-value")).toBe(60_000);
  });
});

describe("parseRateLimitResetMs", () => {
  it("converts a future Unix reset timestamp to a delay", () => {
    expect(parseRateLimitResetMs("1700000030", 1_700_000_000_000)).toBe(30_000);
  });

  it("ignores missing, malformed, and expired reset timestamps", () => {
    expect(parseRateLimitResetMs(null, 1_700_000_000_000)).toBeUndefined();
    expect(parseRateLimitResetMs("later", 1_700_000_000_000)).toBeUndefined();
    expect(parseRateLimitResetMs("1699999999", 1_700_000_000_000)).toBeUndefined();
  });
});

describe("parseAniListMinIntervalMs", () => {
  it("uses conservative burst spacing by default and accepts a bounded override", () => {
    expect(parseAniListMinIntervalMs(undefined)).toBe(350);
    expect(parseAniListMinIntervalMs("600")).toBe(600);
    expect(parseAniListMinIntervalMs("0")).toBe(350);
    expect(parseAniListMinIntervalMs("10001")).toBe(350);
  });
});
