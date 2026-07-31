import type { LatestMangaUpdate, MangaPublicationKind } from "../shared/contracts";

export interface AniListMangaKindHint {
  aniListId: number;
  malId?: number;
  countryOfOrigin?: string;
  format?: string;
  publicationKind?: MangaPublicationKind;
}

export function mangaKindFromOriginalLanguage(
  originalLanguage: string | undefined,
): MangaPublicationKind | undefined {
  const language = originalLanguage?.toLowerCase();
  if (language === "ja") return "MANGA";
  if (language === "ko") return "MANHWA";
  if (language === "zh" || language === "zh-hk") return "MANHUA";
  return undefined;
}

export function mangaKindFromCountry(
  countryOfOrigin: string | undefined,
): MangaPublicationKind | undefined {
  const country = countryOfOrigin?.toUpperCase();
  if (country === "JP") return "MANGA";
  if (country === "KR") return "MANHWA";
  if (country === "CN" || country === "TW" || country === "HK") return "MANHUA";
  return undefined;
}

export function mangaKindFromMalMediaType(
  mediaType: string | undefined,
): MangaPublicationKind | undefined {
  const normalized = mediaType?.toLowerCase();
  if (normalized === "manga") return "MANGA";
  if (normalized === "manhwa") return "MANHWA";
  if (normalized === "manhua") return "MANHUA";
  return undefined;
}

export function parseAniListMangaKindHints(payload: unknown): AniListMangaKindHint[] {
  if (!isRecord(payload) || !Array.isArray(payload.media)) return [];
  return payload.media.flatMap((value): AniListMangaKindHint[] => {
    if (!isRecord(value) || !isPositiveInteger(value.id)) return [];
    const countryOfOrigin =
      typeof value.countryOfOrigin === "string" ? value.countryOfOrigin : undefined;
    const format = typeof value.format === "string" ? value.format : undefined;
    return [
      {
        aniListId: value.id,
        malId: isPositiveInteger(value.idMal) ? value.idMal : undefined,
        countryOfOrigin,
        format,
        publicationKind: mangaKindFromCountry(countryOfOrigin),
      },
    ];
  });
}

/**
 * MangaDex original language is the primary signal. AniList country is the
 * batch cross-check, and MAL media_type breaks disagreements or fills a final
 * gap. The exact provider IDs supplied by MangaDex/AniList are the only joins.
 */
export function classifyLatestMangaUpdates(
  items: LatestMangaUpdate[],
  aniListHints: ReadonlyMap<number, AniListMangaKindHint>,
  malHints: ReadonlyMap<number, MangaPublicationKind>,
): LatestMangaUpdate[] {
  return items.map((item) => {
    const aniListHint = item.aniListId ? aniListHints.get(item.aniListId) : undefined;
    const malId = item.malId ?? aniListHint?.malId;
    const mangaDexKind = mangaKindFromOriginalLanguage(item.originalLanguage);
    const aniListKind = aniListHint?.publicationKind;
    const malKind = malId ? malHints.get(malId) : undefined;

    let publicationKind = mangaDexKind ?? aniListKind ?? malKind ?? "OTHER";
    if (mangaDexKind && aniListKind && mangaDexKind !== aniListKind && malKind) {
      publicationKind = malKind;
    }

    return { ...item, malId, publicationKind };
  });
}

export function needsMalKindCrossCheck(
  item: LatestMangaUpdate,
  aniListHint: AniListMangaKindHint | undefined,
): boolean {
  const mangaDexKind = mangaKindFromOriginalLanguage(item.originalLanguage);
  const aniListKind = aniListHint?.publicationKind;
  return !mangaDexKind || !aniListKind || mangaDexKind !== aniListKind;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
