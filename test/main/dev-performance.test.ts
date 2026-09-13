import { afterEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({ isPackaged: false }));
vi.mock("electron", () => ({ app }));
import { startDevTiming } from "../../src/main/dev-performance";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  app.isPackaged = false;
});

describe("local development timings", () => {
  it("stays silent without explicit opt-in", () => {
    vi.stubEnv("ANISTREAM_PERF", "0");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    startDevTiming("anilist:browse")();
    expect(log).not.toHaveBeenCalled();
  });
  it("stays silent in packaged builds even with opt-in", () => {
    vi.stubEnv("ANISTREAM_PERF", "1");
    app.isPackaged = true;
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    startDevTiming("anilist:browse")();
    expect(log).not.toHaveBeenCalled();
  });
  it("reports only the fixed label, elapsed duration and outcome", () => {
    vi.stubEnv("ANISTREAM_PERF", "1");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(954.4);
    startDevTiming("anilist:browse")("error");
    expect(log).toHaveBeenCalledWith("[AniStream perf] anilist:browse 854ms error");
  });
});
