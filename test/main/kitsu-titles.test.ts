import { describe, expect, it, vi } from "vitest";
import { KitsuClient, parseKitsuTitles } from "../../src/main/kitsu";

describe("Kitsu title search", () => {
  it("keeps distinct English and romaji names and drops malformed rows", () => {
    expect(
      parseKitsuTitles({
        data: [
          {
            attributes: {
              canonicalTitle: "Sousou no Frieren",
              titles: { en: "Frieren: Beyond Journey's End", en_jp: "Sousou no Frieren" },
            },
          },
          { attributes: { canonicalTitle: 42 } },
          "junk",
        ],
      }),
    ).toEqual(["Sousou no Frieren", "Frieren: Beyond Journey's End"]);
    expect(parseKitsuTitles({ errors: [] })).toEqual([]);
  });

  it("searches the right kind once per query and stops on refusal", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ data: [{ attributes: { canonicalTitle: "Berserk" } }] }),
    );
    const client = new KitsuClient("https://kitsu.example/api", fetcher as typeof fetch);
    await expect(client.searchTitles("MANGA", "Berserkk")).resolves.toEqual(["Berserk"]);
    await client.searchTitles("MANGA", "berserkk");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String((fetcher.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe("/api/manga");
    expect(url.searchParams.get("filter[text]")).toBe("Berserkk");

    const refused = new KitsuClient(
      "https://kitsu.example/api",
      vi.fn(async () => new Response(null, { status: 429 })) as typeof fetch,
    );
    await expect(refused.searchTitles("ANIME", "Narto")).rejects.toThrow(/refused/);
    await expect(client.searchTitles("ANIME", "ab")).resolves.toEqual([]);
  });
});
