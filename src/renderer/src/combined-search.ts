import type {
  AniListCatalogMedia,
  AniListMediaType,
  AniStreamBridge,
} from "../../shared/contracts";

export async function combinedSearch(
  query: string,
  bridge: Pick<AniStreamBridge, "browseAniList">,
): Promise<{ items: AniListCatalogMedia[]; failedTypes: AniListMediaType[] }> {
  const types: AniListMediaType[] = ["ANIME", "MANGA"];
  const responses = await Promise.allSettled(
    types.map((type) =>
      Promise.resolve().then(async () => {
        const page = await bridge.browseAniList({ type, page: 1, perPage: 4, query });
        if (!Array.isArray(page.items)) throw new Error("Invalid search results.");
        return page.items.filter((media) => media.type === type).slice(0, 4);
      }),
    ),
  );
  return {
    items: responses.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
    failedTypes: responses.flatMap((result, index) =>
      result.status === "rejected" ? [types[index]] : [],
    ),
  };
}
