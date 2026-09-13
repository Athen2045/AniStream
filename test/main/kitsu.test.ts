import { describe, expect, it } from "vitest";
import type { KitsuHeroArtworkInput } from "../../src/shared/contracts";
import { KitsuClient, parseKitsuHeroArtwork } from "../../src/main/kitsu";

const input: KitsuHeroArtworkInput = {
  aniListId: 21,
  type: "ANIME",
  title: "One Piece",
};

const payload = {
  data: [
    {
      id: "12",
      type: "anime",
      attributes: {
        coverImage: {
          large: "https://media.kitsu.app/anime/12/cover_image/large.jpg",
          meta: { dimensions: { large: { width: 3360, height: 800 } } },
        },
      },
      relationships: {
        mappings: { data: [{ type: "mappings", id: "mapping-21" }] },
      },
    },
  ],
  included: [
    {
      type: "mappings",
      id: "mapping-21",
      attributes: { externalSite: "anilist/anime", externalId: "21" },
    },
  ],
};

describe("parseKitsuHeroArtwork", () => {
  it("returns the wide cover after an exact AniList mapping", () => {
    expect(parseKitsuHeroArtwork(payload, input)).toEqual({
      source: "kitsu",
      imageUrl: "https://media.kitsu.app/anime/12/cover_image/large.jpg",
      width: 3360,
      height: 800,
    });
  });

  it("does not accept a title-only match", () => {
    expect(parseKitsuHeroArtwork({ ...payload, included: [] }, input)).toBeUndefined();
  });

  it("rejects non-https artwork URLs", () => {
    const insecurePayload = {
      ...payload,
      data: payload.data.map((item) => ({
        ...item,
        attributes: {
          coverImage: { large: "http://media.kitsu.app/cover.jpg" },
        },
      })),
    };
    expect(parseKitsuHeroArtwork(insecurePayload, input)).toBeUndefined();
  });
});

describe("KitsuClient", () => {
  it("uses the Kitsu JSON:API search endpoint and normalizes the result", async () => {
    let requestedUrl = "";
    const client = new KitsuClient("https://kitsu.io/api/edge", async (url) => {
      requestedUrl = url.toString();
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
      });
    });

    await expect(client.getHeroArtwork(input)).resolves.toEqual({
      source: "kitsu",
      imageUrl: "https://media.kitsu.app/anime/12/cover_image/large.jpg",
      width: 3360,
      height: 800,
    });
    expect(requestedUrl).toContain("/anime?");
    expect(requestedUrl).toContain("include=mappings");
    expect(requestedUrl).toContain("filter%5Btext%5D=One+Piece");
  });
});
