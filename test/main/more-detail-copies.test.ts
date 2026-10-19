import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import type { MoreDetail } from "../../src/shared/contracts";
import { createMoreDetailLoader, MORE_DETAIL_REFRESH_MS } from "../../src/main/more-detail-copies";
import { createTitleCopies } from "../../src/main/title-copies";

const detail = (title: string): MoreDetail =>
  ({
    id: 7,
    type: "MOVIE",
    title,
    genres: [],
    seasons: [],
    networks: [],
    creators: [],
    recommendations: [],
    logoUrl: "https://image.tmdb.org/t/p/w500/logo.png",
  }) as unknown as MoreDetail;

describe("More title details saved on the device", () => {
  it("fetches with the caller's priority once, then serves the saved copy", async () => {
    const copies = createTitleCopies(new Database(":memory:"), () => []);
    const getDetail = vi.fn(async () => detail("Live"));
    const load = createMoreDetailLoader({ getDetail }, copies, () => 1_000);
    expect((await load(7, "MOVIE", true)).title).toBe("Live");
    expect(getDetail).toHaveBeenCalledWith(7, "MOVIE", true);
    getDetail.mockResolvedValue(detail("Newer"));
    expect((await load(7, "MOVIE")).logoUrl).toBe("https://image.tmdb.org/t/p/w500/logo.png");
    expect(getDetail).toHaveBeenCalledTimes(1);
  });

  it("shows a day-old copy at once and refreshes it in the background", async () => {
    const copies = createTitleCopies(new Database(":memory:"), () => []);
    let now = 0;
    const getDetail = vi.fn(async () => detail("First"));
    const load = createMoreDetailLoader({ getDetail }, copies, () => now);
    await load(7, "MOVIE");
    now = MORE_DETAIL_REFRESH_MS;
    getDetail.mockResolvedValue(detail("Refreshed"));
    expect((await load(7, "MOVIE", true)).title).toBe("First");
    expect(getDetail).toHaveBeenLastCalledWith(7, "MOVIE", false);
    await vi.waitFor(async () => expect((await load(7, "MOVIE")).title).toBe("Refreshed"));
  });

  it("refetches a damaged copy and still answers when saving fails", async () => {
    const copies = createTitleCopies(new Database(":memory:"), () => []);
    copies.write("more-detail:MOVIE:7", 7, { savedAt: 1, detail: { title: 3 } });
    const getDetail = vi.fn(async () => detail("Live"));
    expect((await createMoreDetailLoader({ getDetail }, copies)(7, "MOVIE")).title).toBe("Live");
    const broken = {
      read: () => undefined,
      write: () => {
        throw new Error("disk full");
      },
    };
    expect((await createMoreDetailLoader({ getDetail }, broken)(7, "MOVIE")).title).toBe("Live");
  });
});
