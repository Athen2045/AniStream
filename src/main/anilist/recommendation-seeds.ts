import type {
  RecommendationCreator,
  RecommendationEdge,
  RecommendationItemFeatures,
  RecommendationMediaType,
  RecommendationRelation,
  RecommendationTag,
} from "../../shared/recommendations";

const SEED_PAGE_SIZE = 24;
const EDGES_PER_SEED = 10;
const TAG_LIMIT = 20;

const RELATION_LIMIT = 40;
const RELATION_TYPES = new Set<RecommendationRelation["relationType"]>([
  "PREQUEL",
  "SEQUEL",
  "PARENT",
  "SIDE_STORY",
  "ADAPTATION",
  "SOURCE",
  "ALTERNATIVE",
  "SPIN_OFF",
]);

const ITEM_FIELDS = `id type isAdult format status countryOfOrigin startDate { year month day }
    title { userPreferred } coverImage { large }
    genres averageScore popularity tags { id name rank isMediaSpoiler }
    studios(isMain: true) { nodes { id name } }
    relations { edges { relationType node { id type } } }`;

const TRENDING_QUERY = `query AniStreamRecommendationTrending($type: MediaType!) {
  Page(page: 1, perPage: 20) {
    media(type: $type, sort: [TRENDING_DESC], isAdult: false) { ${ITEM_FIELDS} }
  }
}`;

const QUERY = `query AniStreamRecommendationSeeds($ids: [Int!]!) {
  Page(page: 1, perPage: ${SEED_PAGE_SIZE}) { media(id_in: $ids) {
    ${ITEM_FIELDS}
    staff(perPage: 6, sort: [RELEVANCE, ID]) { edges { role node { id name { full } } } }
    recommendations(perPage: ${EDGES_PER_SEED}, sort: [RATING_DESC, ID]) {
      nodes { rating mediaRecommendation { ${ITEM_FIELDS} } }
    }
  } }
}`;

export interface RecommendationSeedData {
  /** Requested history titles with features and their recommendation edges. */
  seeds: RecommendationItemFeatures[];
  /** Features of the titles those edges point to (candidate pool material). */
  neighbors: RecommendationItemFeatures[];
}

/** Loads exact-ID history seeds with tags, creators, and user-voted recommendation edges. */
export async function loadRecommendationSeeds(
  request: (query: string, variables: Record<string, unknown>) => Promise<unknown>,
  ids: number[],
  now = Date.now(),
): Promise<RecommendationSeedData> {
  const exactIds = [
    ...new Set(ids.filter((id) => Number.isInteger(id) && id > 0 && id <= 2_147_483_647)),
  ].slice(0, SEED_PAGE_SIZE);
  if (!exactIds.length) return { seeds: [], neighbors: [] };
  const response = await request(QUERY, { ids: exactIds });
  if (!isRecord(response) || !isRecord(response.Page) || !Array.isArray(response.Page.media))
    throw new Error("AniList returned invalid recommendation seed data.");
  const seeds = new Map<number, RecommendationItemFeatures>();
  const neighbors = new Map<number, RecommendationItemFeatures>();
  for (const value of response.Page.media.slice(0, SEED_PAGE_SIZE)) {
    const seed = parseItem(value, now);
    if (!seed || !exactIds.includes(seed.anilistId) || seeds.has(seed.anilistId)) continue;
    seed.creators.push(...parseStaff(isRecord(value) ? value.staff : undefined));
    const edges: RecommendationEdge[] = [];
    const nodes =
      isRecord(value) && isRecord(value.recommendations) ? value.recommendations.nodes : [];
    for (const node of Array.isArray(nodes) ? nodes.slice(0, EDGES_PER_SEED) : []) {
      if (!isRecord(node) || typeof node.rating !== "number" || node.rating <= 0) continue;
      const neighbor = parseItem(node.mediaRecommendation, now);
      if (!neighbor || neighbor.anilistId === seed.anilistId) continue;
      edges.push({ id: neighbor.anilistId, mediaType: neighbor.mediaType, rating: node.rating });
      if (!neighbors.has(neighbor.anilistId)) neighbors.set(neighbor.anilistId, neighbor);
    }
    seed.recommendations = edges;
    seeds.set(seed.anilistId, seed);
  }
  for (const id of seeds.keys()) neighbors.delete(id);
  return { seeds: [...seeds.values()], neighbors: [...neighbors.values()] };
}

function parseItem(value: unknown, now: number): RecommendationItemFeatures | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "number" ||
    !Number.isInteger(value.id) ||
    value.id <= 0 ||
    (value.type !== "ANIME" && value.type !== "MANGA")
  )
    return undefined;
  const title = isRecord(value.title) ? text(value.title.userPreferred) : undefined;
  const cover = isRecord(value.coverImage) ? text(value.coverImage.large) : undefined;
  const studios =
    isRecord(value.studios) && Array.isArray(value.studios.nodes) ? value.studios.nodes : [];
  return {
    anilistId: value.id,
    mediaType: value.type,
    normalizedTitle: title ?? `#${value.id}`,
    coverUrl: cover?.startsWith("https://") ? cover : undefined,
    titleTokens: [],
    synonyms: [],
    genres: Array.isArray(value.genres)
      ? value.genres.flatMap((genre) => (text(genre) ? [text(genre)!] : [])).slice(0, 12)
      : [],
    tags: Array.isArray(value.tags) ? parseTags(value.tags) : [],
    creators: studios
      .slice(0, 4)
      .flatMap((studio): RecommendationCreator[] =>
        isRecord(studio) && typeof studio.id === "number" && text(studio.name)
          ? [{ id: studio.id, name: text(studio.name)!, role: "STUDIO" }]
          : [],
      ),
    averageScore: finite(value.averageScore),
    popularity: finite(value.popularity),
    status: text(value.status),
    startedOn: startedOn(value.startDate),
    format: text(value.format),
    isAdult: value.isAdult === true,
    origin:
      typeof value.countryOfOrigin === "string" && /^[A-Z]{2}$/.test(value.countryOfOrigin)
        ? value.countryOfOrigin
        : undefined,
    relations: parseRelations(value.relations),
    updatedAt: now,
  };
}

function startedOn(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const year = finite(value.year);
  if (!year || year < 1900 || year > 2200) return undefined;
  const part = (raw: unknown, max: number): number => {
    const number = finite(raw);
    return number && number >= 1 && number <= max ? Math.floor(number) : 0;
  };
  return Math.floor(year) * 10_000 + part(value.month, 12) * 100 + part(value.day, 31);
}

/** Trending page with full candidate features and relations (one request). */
export async function loadRecommendationTrending(
  request: (query: string, variables: Record<string, unknown>) => Promise<unknown>,
  type: RecommendationMediaType,
  now = Date.now(),
): Promise<RecommendationItemFeatures[]> {
  const response = await request(TRENDING_QUERY, { type });
  if (!isRecord(response) || !isRecord(response.Page) || !Array.isArray(response.Page.media))
    throw new Error("AniList returned invalid trending recommendation data.");
  const seen = new Set<number>();
  return response.Page.media.slice(0, 20).flatMap((value) => {
    const item = parseItem(value, now);
    if (!item || item.mediaType !== type || seen.has(item.anilistId)) return [];
    seen.add(item.anilistId);
    return [item];
  });
}

function parseRelations(value: unknown): RecommendationRelation[] {
  const edges = isRecord(value) && Array.isArray(value.edges) ? value.edges : [];
  return edges.slice(0, RELATION_LIMIT).flatMap((edge): RecommendationRelation[] => {
    if (!isRecord(edge) || !isRecord(edge.node)) return [];
    const { id, type } = edge.node;
    const relationType = edge.relationType as RecommendationRelation["relationType"];
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      (type !== "ANIME" && type !== "MANGA") ||
      !RELATION_TYPES.has(relationType)
    )
      return [];
    return [{ id, mediaType: type, relationType }];
  });
}

function parseTags(values: unknown[]): RecommendationTag[] {
  return values
    .flatMap((tag): RecommendationTag[] => {
      if (!isRecord(tag) || typeof tag.id !== "number" || !text(tag.name)) return [];
      const rank = finite(tag.rank) ?? 0;
      // Spoiler tags still describe the work; halve their weight instead of hiding taste signal.
      return [
        { id: tag.id, name: text(tag.name)!, rank: tag.isMediaSpoiler === true ? rank / 2 : rank },
      ];
    })
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    .slice(0, TAG_LIMIT);
}

function parseStaff(value: unknown): RecommendationCreator[] {
  const edges = isRecord(value) && Array.isArray(value.edges) ? value.edges : [];
  return edges.flatMap((edge): RecommendationCreator[] => {
    if (!isRecord(edge) || !isRecord(edge.node) || typeof edge.node.id !== "number") return [];
    const role = text(edge.role) ?? "";
    // Only roles that shape a work's identity; voice and minor staff add noise.
    if (!/original creator|story|art|director|series composition/i.test(role)) return [];
    const name = isRecord(edge.node.name) ? text(edge.node.name.full) : undefined;
    return name ? [{ id: edge.node.id, name, role: "STAFF" }] : [];
  });
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
