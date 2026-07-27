import { describe, expect, it } from "vitest";
import { parseRetryAfterMs } from "../../src/main/anilist/client";

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
