import { describe, expect, it, vi } from "vitest";
import { loadAiringSchedule } from "../../src/main/anilist/airing-schedule";
import { ipcArgValidators } from "../../src/main/ipc-validation";

const START = 1_790_000_000;
const END = START + 7 * 86_400 - 1;

function media(id: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: "ANIME",
    title: { userPreferred: `Show ${id}` },
    coverImage: { large: `https://example.test/${id}.jpg` },
    siteUrl: `https://anilist.co/anime/${id}`,
    genres: [],
    ...extra,
  };
}

function page(rows: unknown[], hasNextPage = false): unknown {
  return { Page: { pageInfo: { hasNextPage }, airingSchedules: rows } };
}

describe("airing schedule loader", () => {
  it("returns a week's airings in time order, skipping adult, out-of-span and malformed rows", async () => {
    const request = vi.fn(async () =>
      page([
        { episode: 2, airingAt: START + 500, media: media(2) },
        { episode: 1, airingAt: START + 100, media: media(1) },
        { episode: 3, airingAt: START + 200, media: media(3, { isAdult: true }) },
        { episode: 4, airingAt: END + 100, media: media(4) },
        { episode: 0, airingAt: START + 300, media: media(5) },
        { episode: 6, airingAt: START + 300, media: { id: 6, type: "ANIME" } },
      ]),
    );
    const result = await loadAiringSchedule(request, { start: START, end: END });
    expect(result.partial).toBe(false);
    expect(result.entries.map((entry) => [entry.media.id, entry.episode])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![1]).toEqual({ page: 1, start: START - 1, end: END + 1 });
  });

  it("stops at the page budget and reports the week as partial", async () => {
    const request = vi.fn(async () =>
      page([{ episode: 1, airingAt: START + 1, media: media(1) }], true),
    );
    const result = await loadAiringSchedule(request, { start: START, end: END });
    expect(request).toHaveBeenCalledTimes(6);
    expect(result.partial).toBe(true);
    expect(result.entries).toHaveLength(1);
  });

  it("filters to exact list IDs, and makes no request for an empty list", async () => {
    const request = vi.fn(async () =>
      page([
        { episode: 1, airingAt: START + 1, media: media(1) },
        { episode: 1, airingAt: START + 2, media: media(9) },
      ]),
    );
    expect(await loadAiringSchedule(request, { start: START, end: END, mediaIds: [] })).toEqual({
      entries: [],
      partial: false,
    });
    expect(request).not.toHaveBeenCalled();
    const result = await loadAiringSchedule(request, { start: START, end: END, mediaIds: [1, 1] });
    expect(request.mock.calls[0]![1]).toMatchObject({ ids: [1] });
    expect(result.entries.map((entry) => entry.media.id)).toEqual([1]);
  });

  it("rejects a malformed page instead of showing an empty week", async () => {
    await expect(
      loadAiringSchedule(async () => ({ Page: {} }), { start: START, end: END }),
    ).rejects.toThrow(/invalid schedule/);
  });

  it("validates schedule IPC spans and list IDs", () => {
    const validate = ipcArgValidators["anilist:schedule"];
    expect(validate([{ start: START, end: END }])).toEqual([{ start: START, end: END }]);
    expect(validate([{ start: START, end: END, mediaIds: [1, 2] }])).toEqual([
      { start: START, end: END, mediaIds: [1, 2] },
    ]);
    expect(() => validate([{ start: END, end: START }])).toThrow(/malformed/);
    expect(() => validate([{ start: START, end: START + 30 * 86_400 }])).toThrow(/malformed/);
    // A month grid is allowed only for the user's list.
    expect(validate([{ start: START, end: START + 42 * 86_400 - 1, mediaIds: [1] }])).toHaveLength(
      1,
    );
    expect(() => validate([{ start: START, end: START + 50 * 86_400, mediaIds: [1] }])).toThrow(
      /malformed/,
    );
    expect(() => validate([{ start: START, end: END, mediaIds: [0] }])).toThrow(/malformed/);
    expect(() =>
      validate([
        { start: START, end: END, mediaIds: Array.from({ length: 201 }, (_, i) => i + 1) },
      ]),
    ).toThrow(/malformed/);
    expect(() => validate([{ start: START + 0.5, end: END }])).toThrow(/malformed/);
  });
});
