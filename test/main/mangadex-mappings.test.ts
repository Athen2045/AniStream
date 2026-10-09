import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MangaDexClient } from "../../src/main/mangadex";
import {
  MAPPED_TTL_MS,
  UNMAPPED_TTL_MS,
  createMangaDexMappingStore,
} from "../../src/main/mangadex-mappings";

const MANGA_ID = "0f3c2a5e-1b2c-4d5e-8f90-123456789abc";

function scriptedFetch(responses: Response[]) {
  const urls: string[] = [];
  const fetcher = async (input: string | URL | Request): Promise<Response> => {
    urls.push(new URL(String(input)).pathname);
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch.");
    return response;
  };
  return { urls, fetcher: fetcher as typeof fetch };
}

const search = (): Response =>
  Response.json({ data: [{ id: MANGA_ID, attributes: { links: { al: "700" } } }] });
const aggregate = (): Response => Response.json({ volumes: { "1": { chapters: { "3": {} } } } });

describe("MangaDex mapping store", () => {
  it("expires a match after a month and a miss after three days", () => {
    const store = createMangaDexMappingStore(new Database(":memory:"));
    store.save(1, MANGA_ID, 0);
    store.save(2, null, 0);
    expect(store.get(1, MAPPED_TTL_MS - 1)).toBe(MANGA_ID);
    expect(store.get(1, MAPPED_TTL_MS)).toBeUndefined();
    expect(store.get(2, UNMAPPED_TTL_MS - 1)).toBeNull();
    expect(store.get(2, UNMAPPED_TTL_MS)).toBeUndefined();
    store.save(3, "not-a-mangadex-id", 0);
    expect(store.get(3, 0)).toBeUndefined();
  });

  it("lets a later availability check skip the title search", async () => {
    const store = createMangaDexMappingStore(new Database(":memory:"));
    const first = scriptedFetch([search(), aggregate()]);
    await new MangaDexClient("en", first.fetcher, { mappingStore: () => store }).getAvailability([
      { aniListId: 700, title: "Another Manga" },
    ]);
    expect(first.urls).toEqual(["/manga", `/manga/${MANGA_ID}/aggregate`]);

    // A fresh client stands in for the next launch: its in-memory cache is empty.
    const next = scriptedFetch([aggregate()]);
    const [availability] = await new MangaDexClient("en", next.fetcher, {
      mappingStore: () => store,
    }).getAvailability([{ aniListId: 700, title: "Another Manga" }]);
    expect(next.urls).toEqual([`/manga/${MANGA_ID}/aggregate`]);
    expect(availability).toMatchObject({ status: "available", mangaDexId: MANGA_ID });
  });

  it("remembers a miss and forgets a match MangaDex no longer serves", async () => {
    const store = createMangaDexMappingStore(new Database(":memory:"));
    store.save(800, null, Date.now());
    const miss = scriptedFetch([]);
    const [unmapped] = await new MangaDexClient("en", miss.fetcher, {
      mappingStore: () => store,
    }).getAvailability([{ aniListId: 800, title: "Missing" }]);
    expect(unmapped.status).toBe("unmapped");
    expect(miss.urls).toEqual([]);

    store.save(700, MANGA_ID, Date.now());
    const gone = scriptedFetch([new Response("{}", { status: 404 })]);
    const [unavailable] = await new MangaDexClient("en", gone.fetcher, {
      mappingStore: () => store,
    }).getAvailability([{ aniListId: 700, title: "Another Manga" }]);
    expect(unavailable.status).toBe("unavailable");
    expect(store.get(700, Date.now())).toBeUndefined();
  });

  it("still works when the store is not ready or fails", async () => {
    const broken = {
      get: () => {
        throw new Error("disk");
      },
      save: () => {
        throw new Error("disk");
      },
      forget: () => undefined,
    };
    for (const mappingStore of [() => undefined, () => broken]) {
      const { fetcher } = scriptedFetch([search(), aggregate()]);
      const [availability] = await new MangaDexClient("en", fetcher, {
        mappingStore,
      }).getAvailability([{ aniListId: 700, title: "Another Manga" }]);
      expect(availability.status).toBe("available");
    }
  });
});
