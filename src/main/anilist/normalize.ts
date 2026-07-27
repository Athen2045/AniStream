import type {
  AniListCatalogMedia,
  AniListCatalogPage,
  AniListEntry,
  AniListEntryStatus,
  AniListGroup,
  AniListMedia,
  AniListMediaDetail,
  AniListMediaType,
  AniListNamedPerson,
  AniListProfile,
} from "../../shared/contracts";

export function normalizeProfile(value: unknown): AniListProfile {
  const viewer = asRecord(value, "AniList returned an invalid profile.");
  const avatar = asRecord(viewer.avatar, "AniList returned an invalid avatar.");
  const statistics = asRecord(viewer.statistics, "AniList returned invalid statistics.");
  const anime = asRecord(statistics.anime, "AniList returned invalid anime statistics.");
  const manga = asRecord(statistics.manga, "AniList returned invalid manga statistics.");

  return {
    id: requiredNumber(viewer.id, "profile ID"),
    name: requiredString(viewer.name, "profile name"),
    about: optionalString(viewer.about),
    avatarUrl: requiredString(avatar.large, "avatar"),
    bannerUrl: optionalString(viewer.bannerImage),
    siteUrl: requiredString(viewer.siteUrl, "profile URL"),
    animeCount: requiredNumber(anime.count, "anime count"),
    episodesWatched: requiredNumber(anime.episodesWatched, "episodes watched"),
    minutesWatched: requiredNumber(anime.minutesWatched, "minutes watched"),
    mangaCount: requiredNumber(manga.count, "manga count"),
    chaptersRead: requiredNumber(manga.chaptersRead, "chapters read"),
    volumesRead: requiredNumber(manga.volumesRead, "volumes read"),
  };
}

export function normalizeGroups(
  collectionValue: unknown,
  expectedType: AniListMediaType,
): AniListGroup[] {
  const collection = asRecord(collectionValue, "AniList returned an invalid media list.");
  if (!Array.isArray(collection.lists)) throw new Error("AniList returned invalid list groups.");

  return collection.lists.map((listValue): AniListGroup => {
    const list = asRecord(listValue, "AniList returned an invalid list group.");
    if (!Array.isArray(list.entries)) throw new Error("AniList returned invalid list entries.");

    return {
      name: requiredString(list.name, "list name"),
      isCustomList: Boolean(list.isCustomList),
      entries: list.entries.map((entry) => normalizeEntry(entry, expectedType)),
    };
  });
}

export function normalizeEntry(value: unknown, expectedType: AniListMediaType): AniListEntry {
  const entry = asRecord(value, "AniList returned an invalid list entry.");
  const status = requiredString(entry.status, "entry status");

  if (!isEntryStatus(status)) throw new Error(`AniList returned an unknown list status: ${status}`);

  return {
    id: requiredNumber(entry.id, "entry ID"),
    status,
    score: requiredNumber(entry.score, "entry score"),
    progress: requiredNumber(entry.progress, "entry progress"),
    progressVolumes: optionalNumber(entry.progressVolumes),
    repeat: requiredNumber(entry.repeat, "entry repeat"),
    notes: optionalString(entry.notes),
    updatedAt: requiredNumber(entry.updatedAt, "entry update time"),
    media: normalizeMedia(entry.media, expectedType),
  };
}

export function normalizeMedia(value: unknown, expectedType: AniListMediaType): AniListMedia {
  const media = asRecord(value, "AniList returned invalid media.");
  const title = asRecord(media.title, "AniList returned an invalid title.");
  const cover = asRecord(media.coverImage, "AniList returned an invalid cover.");
  const mediaType = requiredString(media.type, "media type");
  if (mediaType !== expectedType) throw new Error("AniList returned a mismatched media type.");

  const preferredTitle =
    optionalString(title.userPreferred) ??
    optionalString(title.english) ??
    optionalString(title.romaji);
  if (!preferredTitle) throw new Error("AniList returned media without a title.");
  const nextAiring = media.nextAiringEpisode
    ? asRecord(media.nextAiringEpisode, "AniList returned an invalid airing schedule.")
    : undefined;

  return {
    id: requiredNumber(media.id, "media ID"),
    type: expectedType,
    title: preferredTitle,
    coverUrl: requiredString(cover.large, "cover image"),
    format: optionalString(media.format),
    status: optionalString(media.status),
    totalProgress:
      expectedType === "ANIME" ? optionalNumber(media.episodes) : optionalNumber(media.chapters),
    totalVolumes: optionalNumber(media.volumes),
    genres: optionalStringArray(media.genres),
    averageScore: optionalNumber(media.averageScore),
    nextAiringEpisode: nextAiring
      ? {
          episode: requiredNumber(nextAiring.episode, "next episode"),
          airingAt: requiredNumber(nextAiring.airingAt, "airing time"),
        }
      : undefined,
    siteUrl: requiredString(media.siteUrl, "media URL"),
  };
}

export function normalizeCatalogPage(
  value: unknown,
  expectedType: AniListMediaType,
): AniListCatalogPage {
  const page = asRecord(value, "AniList returned an invalid catalog page.");
  const pageInfo = asRecord(page.pageInfo, "AniList returned invalid pagination.");
  if (!Array.isArray(page.media)) throw new Error("AniList returned invalid catalog results.");

  const currentPage = requiredNumber(pageInfo.currentPage, "current page");
  const rawLastPage = optionalNumber(pageInfo.lastPage);

  return {
    pageInfo: {
      currentPage,
      perPage: requiredNumber(pageInfo.perPage, "page size"),
      lastPage: Math.max(currentPage, rawLastPage ?? currentPage),
      hasNextPage: Boolean(pageInfo.hasNextPage),
    },
    items: page.media.map((media) => normalizeCatalogMedia(media, expectedType)),
  };
}

export function normalizeCatalogMedia(
  value: unknown,
  expectedType: AniListMediaType,
): AniListCatalogMedia {
  const media = asRecord(value, "AniList returned invalid catalog media.");
  const title = asRecord(media.title, "AniList returned an invalid title.");
  const cover = asRecord(media.coverImage, "AniList returned an invalid cover.");
  const mediaType = requiredString(media.type, "media type");
  if (mediaType !== expectedType) throw new Error("AniList returned a mismatched media type.");
  const preferredTitle =
    optionalString(title.userPreferred) ??
    optionalString(title.english) ??
    optionalString(title.romaji);
  if (!preferredTitle) throw new Error("AniList returned media without a title.");

  const nextAiring = media.nextAiringEpisode
    ? asRecord(media.nextAiringEpisode, "AniList returned an invalid airing schedule.")
    : undefined;

  return {
    id: requiredNumber(media.id, "media ID"),
    type: expectedType,
    title: preferredTitle,
    coverUrl: optionalString(cover.extraLarge) ?? requiredString(cover.large, "cover image"),
    bannerUrl: optionalString(media.bannerImage),
    description: optionalString(media.description),
    format: optionalString(media.format),
    status: optionalString(media.status),
    totalProgress:
      expectedType === "ANIME" ? optionalNumber(media.episodes) : optionalNumber(media.chapters),
    totalVolumes: optionalNumber(media.volumes),
    siteUrl: requiredString(media.siteUrl, "media URL"),
    genres: Array.isArray(media.genres)
      ? media.genres.filter((genre): genre is string => typeof genre === "string")
      : [],
    averageScore: optionalNumber(media.averageScore),
    popularity: optionalNumber(media.popularity),
    season: optionalString(media.season),
    seasonYear: optionalNumber(media.seasonYear),
    nextAiringEpisode: nextAiring
      ? {
          episode: requiredNumber(nextAiring.episode, "next episode"),
          airingAt: requiredNumber(nextAiring.airingAt, "airing time"),
        }
      : undefined,
  };
}

export function normalizeMediaDetail(
  value: unknown,
  expectedType: AniListMediaType,
): AniListMediaDetail {
  const media = asRecord(value, "AniList returned invalid media details.");
  const base = normalizeCatalogMedia(media, expectedType);
  const title = asRecord(media.title, "AniList returned an invalid title.");
  const studios = media.studios
    ? asRecord(media.studios, "AniList returned invalid studios.")
    : undefined;
  const studioEdges = studios && Array.isArray(studios.edges) ? studios.edges : [];

  const mainStudios: string[] = [];
  const producers: string[] = [];
  for (const edgeValue of studioEdges) {
    const edge = asRecord(edgeValue, "AniList returned an invalid studio.");
    const node = asRecord(edge.node, "AniList returned an invalid studio.");
    const name = requiredString(node.name, "studio name");
    (edge.isMain ? mainStudios : producers).push(name);
  }

  const characters = normalizePeopleConnection(media.characters, "character");
  const staff = normalizePeopleConnection(media.staff, "staff");
  const relationsConnection = media.relations
    ? asRecord(media.relations, "AniList returned invalid relations.")
    : undefined;
  const relationEdges =
    relationsConnection && Array.isArray(relationsConnection.edges)
      ? relationsConnection.edges
      : [];
  const relations = relationEdges.flatMap((edgeValue) => {
    const edge = asRecord(edgeValue, "AniList returned an invalid relation.");
    if (!edge.node) return [];
    return [
      {
        relationType: requiredString(edge.relationType, "relation type"),
        media: normalizeCatalogMedia(edge.node, requiredMediaType(edge.node)),
      },
    ];
  });

  const recommendationConnection = media.recommendations
    ? asRecord(media.recommendations, "AniList returned invalid recommendations.")
    : undefined;
  const recommendationNodes =
    recommendationConnection && Array.isArray(recommendationConnection.nodes)
      ? recommendationConnection.nodes
      : [];
  const recommendations = recommendationNodes.flatMap((recommendationValue) => {
    const recommendation = asRecord(
      recommendationValue,
      "AniList returned an invalid recommendation.",
    );
    if (!recommendation.mediaRecommendation) return [];
    return [
      normalizeCatalogMedia(
        recommendation.mediaRecommendation,
        requiredMediaType(recommendation.mediaRecommendation),
      ),
    ];
  });

  const externalLinks = Array.isArray(media.externalLinks)
    ? media.externalLinks.flatMap((linkValue) => {
        const link = asRecord(linkValue, "AniList returned an invalid external link.");
        const site = optionalString(link.site);
        const url = optionalString(link.url);
        return site && url ? [{ site, url, type: optionalString(link.type) }] : [];
      })
    : [];

  const trailer = media.trailer
    ? asRecord(media.trailer, "AniList returned an invalid trailer.")
    : undefined;
  const trailerId = trailer ? optionalString(trailer.id) : undefined;
  const trailerSite = trailer ? optionalString(trailer.site)?.toLocaleLowerCase() : undefined;

  const listEntry = media.mediaListEntry
    ? asRecord(media.mediaListEntry, "AniList returned an invalid list entry.")
    : undefined;
  const listStatus = listEntry ? requiredString(listEntry.status, "entry status") : undefined;

  return {
    ...base,
    titleRomaji: optionalString(title.romaji),
    titleEnglish: optionalString(title.english),
    titleNative: optionalString(title.native),
    synonyms: Array.isArray(media.synonyms)
      ? media.synonyms.filter((synonym): synonym is string => typeof synonym === "string")
      : [],
    source: optionalString(media.source),
    countryOfOrigin: optionalString(media.countryOfOrigin),
    duration: optionalNumber(media.duration),
    startDate: normalizeFuzzyDate(media.startDate),
    endDate: normalizeFuzzyDate(media.endDate),
    studios: mainStudios.length ? mainStudios : producers,
    producers,
    characters,
    staff,
    relations,
    recommendations,
    externalLinks,
    trailerUrl:
      trailerId && trailerSite === "youtube"
        ? `https://www.youtube.com/watch?v=${encodeURIComponent(trailerId)}`
        : trailerId && trailerSite === "dailymotion"
          ? `https://www.dailymotion.com/video/${encodeURIComponent(trailerId)}`
          : undefined,
    listEntry:
      listEntry && listStatus && isEntryStatus(listStatus)
        ? {
            id: requiredNumber(listEntry.id, "entry ID"),
            status: listStatus,
            score: requiredNumber(listEntry.score, "entry score"),
            progress: requiredNumber(listEntry.progress, "entry progress"),
          }
        : undefined,
  };
}

function normalizePeopleConnection(value: unknown, kind: string): AniListNamedPerson[] {
  if (!value) return [];
  const connection = asRecord(value, `AniList returned invalid ${kind} data.`);
  if (!Array.isArray(connection.edges)) return [];
  return connection.edges.flatMap((edgeValue) => {
    const edge = asRecord(edgeValue, `AniList returned an invalid ${kind}.`);
    if (!edge.node) return [];
    const node = asRecord(edge.node, `AniList returned an invalid ${kind}.`);
    const name = asRecord(node.name, `AniList returned an invalid ${kind} name.`);
    const image = node.image
      ? asRecord(node.image, `AniList returned an invalid ${kind} image.`)
      : undefined;
    return [
      {
        id: requiredNumber(node.id, `${kind} ID`),
        name: requiredString(name.full, `${kind} name`),
        imageUrl: image ? optionalString(image.medium) : undefined,
        role: optionalString(edge.role),
      },
    ];
  });
}

function normalizeFuzzyDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = asRecord(value, "AniList returned an invalid date.");
  const year = optionalNumber(date.year);
  if (!year) return undefined;
  const month = optionalNumber(date.month);
  const day = optionalNumber(date.day);
  return [year, month, day]
    .filter((part): part is number => typeof part === "number")
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
    .join("-");
}

function requiredMediaType(value: unknown): AniListMediaType {
  const record = asRecord(value, "AniList returned invalid related media.");
  const type = requiredString(record.type, "media type");
  if (type !== "ANIME" && type !== "MANGA")
    throw new Error("AniList returned an unknown media type.");
  return type;
}

export function isEntryStatus(value: string): value is AniListEntryStatus {
  return ["CURRENT", "PLANNING", "COMPLETED", "DROPPED", "PAUSED", "REPEATING"].includes(value);
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`AniList returned an invalid ${field}.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return values.length ? values : undefined;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`AniList returned an invalid ${field}.`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
