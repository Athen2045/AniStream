import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  AniListRelation,
  AnimeSeriesNode,
} from "../../shared/contracts";

const MAX_DIRECTION_HOPS = 8;
const ROMAN_SEASONS: Readonly<Record<string, number>> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
};

export interface AnimeSeasonChoice {
  number: number;
  partNumber?: number;
  media: AniListCatalogMedia;
  episodeCount?: number;
  current: boolean;
}

/** What the season walk needs of an anime: a full title detail or a series-graph node. */
export type AnimeSeriesDetail = AniListCatalogMedia & {
  relations: readonly AniListRelation[];
  synonyms?: readonly string[];
  titleEnglish?: string;
  titleRomaji?: string;
  titleNative?: string;
};

export type LoadAnimeDetail = (id: number) => Promise<AnimeSeriesDetail>;

export interface AnimeSeries {
  /** Episodic seasons in series order, numbered. */
  seasons: AnimeSeasonChoice[];
  /** Films, OVAs, specials and one-episode releases on or beside the chain, oldest first. */
  extras: { media: AniListCatalogMedia; current: boolean }[];
}

const SEASON_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

/**
 * A season is an episodic release (TV, TV short, ONA) with more than one episode, or with an
 * unknown count while it airs. Films, OVAs, specials and one-episode ONAs are extras, so AniList
 * listing a one-shot as a "prequel" (One Piece) does not make the main series "Season 2".
 */
export function isSeasonEntry(media: AniListCatalogMedia): boolean {
  return (
    (media.format === undefined || SEASON_FORMATS.has(media.format)) && media.totalProgress !== 1
  );
}

/** Seasons only; see `buildAnimeSeries`. */
export async function buildAnimeSeasonChain(
  current: AnimeSeriesDetail,
  loadDetail: LoadAnimeDetail,
): Promise<AnimeSeasonChoice[]> {
  return (await buildAnimeSeries(current, loadDetail)).seasons;
}

/**
 * Walks only AniList's exact PREQUEL/SEQUEL edges. Branches prefer main episodic formats so an
 * OVA or short does not replace the next television season; a film the chain passes through (or
 * that sits beside a season) is listed as an extra, never numbered as a season.
 */
export async function buildAnimeSeries(
  current: AnimeSeriesDetail,
  loadDetail: LoadAnimeDetail,
): Promise<AnimeSeries> {
  const [before, after] = await Promise.all([
    walkDirection(current, "PREQUEL", loadDetail),
    walkDirection(current, "SEQUEL", loadDetail),
  ]);
  const afterIds = new Set(after.map((media) => media.id));
  const ordered = [
    ...before.filter((media) => !afterIds.has(media.id)).reverse(),
    current,
    ...after,
  ];
  const seen = new Set<number>();
  const unique = ordered.filter((media) => {
    if (seen.has(media.id)) return false;
    seen.add(media.id);
    return true;
  });
  const extras = seriesExtras(unique, current.id);
  let lastSeasonNumber = 0;
  const numbered = unique.filter(isSeasonEntry).map((media) => {
    const explicitNumber = inferDisplayedSeasonNumber(media.title);
    const partNumber = inferDisplayedPartNumber(media.title);
    const number =
      explicitNumber ??
      (partNumber && lastSeasonNumber > 0 ? lastSeasonNumber : lastSeasonNumber + 1);
    lastSeasonNumber = Math.max(lastSeasonNumber, number);
    return {
      number,
      partNumber,
      media,
      episodeCount: media.totalProgress,
      current: media.id === current.id,
    };
  });
  const seasonCounts = new Map<number, number>();
  for (const item of numbered) {
    seasonCounts.set(item.number, (seasonCounts.get(item.number) ?? 0) + 1);
  }
  const nextImplicitPart = new Map<number, number>();
  const seasons = numbered.map((item) => {
    if ((seasonCounts.get(item.number) ?? 0) < 2 || item.partNumber) return item;
    const partNumber = nextImplicitPart.get(item.number) ?? 1;
    nextImplicitPart.set(item.number, partNumber + 1);
    return { ...item, partNumber };
  });
  return { seasons, extras };
}

/** Non-season entries on the chain plus those its entries link as prequel, sequel or side story. */
function seriesExtras(
  chain: readonly AnimeSeriesDetail[],
  currentId: number,
): AnimeSeries["extras"] {
  const extras = new Map<number, AniListCatalogMedia>();
  for (const media of chain) {
    if (!isSeasonEntry(media)) extras.set(media.id, media);
    for (const relation of media.relations) {
      const linked = relation.media;
      if (linked.type === "ANIME" && !isSeasonEntry(linked) && !extras.has(linked.id))
        extras.set(linked.id, linked);
    }
  }
  return [...extras.values()]
    .sort(
      (a, b) =>
        (a.seasonYear ?? Number.MAX_SAFE_INTEGER) - (b.seasonYear ?? Number.MAX_SAFE_INTEGER) ||
        a.id - b.id,
    )
    .slice(0, 40)
    .map((media) => ({ media, current: media.id === currentId }));
}

/**
 * Season-walk loader backed by the main process's two-hop series graph: one request fills the
 * entry and its neighbours, so most hops need no request at all. Bounded, per renderer session.
 */
export function createSeriesLoader(
  fetchGraph: (id: number) => Promise<AnimeSeriesNode[]>,
  maxEntries = 300,
): LoadAnimeDetail {
  const known = new Map<number, AnimeSeriesDetail>();
  return async (id) => {
    const hit = known.get(id);
    if (hit) return hit;
    for (const node of await fetchGraph(id)) {
      if (!node.relations) continue;
      known.delete(node.media.id);
      known.set(node.media.id, { ...node.media, synonyms: node.titles, relations: node.relations });
      if (known.size > maxEntries) known.delete(known.keys().next().value as number);
    }
    const loaded = known.get(id);
    if (!loaded) throw new Error("AniList returned no series entry for this title.");
    return loaded;
  };
}

async function walkDirection(
  origin: AnimeSeriesDetail,
  direction: "PREQUEL" | "SEQUEL",
  loadDetail: LoadAnimeDetail,
): Promise<AnimeSeriesDetail[]> {
  const result: AnimeSeriesDetail[] = [];
  const visited = new Set([origin.id]);
  let cursor = origin;
  for (let hop = 0; hop < MAX_DIRECTION_HOPS; hop += 1) {
    const next = chooseSeriesRelation(cursor.relations, direction, cursor.id);
    if (!next || visited.has(next.id)) break;
    visited.add(next.id);
    const detail = await loadDetail(next.id);
    if (detail.type !== "ANIME" || detail.id !== next.id) break;
    result.push(detail);
    cursor = detail;
  }
  return result;
}

function chooseSeriesRelation(
  relations: readonly AniListRelation[],
  direction: "PREQUEL" | "SEQUEL",
  currentId: number,
): AniListCatalogMedia | undefined {
  return relations
    .filter(
      (relation) =>
        relation.relationType === direction &&
        relation.media.type === "ANIME" &&
        relation.media.id !== currentId,
    )
    .map((relation) => relation.media)
    .sort((left, right) => compareSeriesCandidates(left, right, direction))[0];
}

function compareSeriesCandidates(
  left: AniListCatalogMedia,
  right: AniListCatalogMedia,
  direction: "PREQUEL" | "SEQUEL",
): number {
  const formatDifference = seriesFormatRank(right.format) - seriesFormatRank(left.format);
  if (formatDifference) return formatDifference;
  const episodeDifference =
    Number((right.totalProgress ?? 0) > 1) - Number((left.totalProgress ?? 0) > 1);
  if (episodeDifference) return episodeDifference;
  const leftYear = left.seasonYear ?? (direction === "PREQUEL" ? 0 : Number.MAX_SAFE_INTEGER);
  const rightYear = right.seasonYear ?? (direction === "PREQUEL" ? 0 : Number.MAX_SAFE_INTEGER);
  const yearDifference = direction === "PREQUEL" ? rightYear - leftYear : leftYear - rightYear;
  return yearDifference || left.id - right.id;
}

function seriesFormatRank(format: string | undefined): number {
  switch (format) {
    case "TV":
      return 6;
    case "ONA":
      return 5;
    case "TV_SHORT":
      return 4;
    case "MOVIE":
      return 3;
    case "OVA":
      return 2;
    case "SPECIAL":
      return 1;
    default:
      return 0;
  }
}

export function inferDisplayedSeasonNumber(title: string): number | undefined {
  const explicit =
    title.match(/\bseason\s+(\d{1,2})\b/i)?.[1] ??
    title.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i)?.[1];
  if (explicit) {
    const value = Number(explicit);
    return value > 0 ? value : undefined;
  }
  const roman = title.match(/\b(I|II|III|IV|V|VI|VII|VIII|IX|X)$/i)?.[1]?.toUpperCase();
  return roman ? ROMAN_SEASONS[roman] : undefined;
}

export function inferDisplayedPartNumber(title: string): number | undefined {
  const numeric = title.match(/\bpart\s+(\d{1,2})\b/i)?.[1];
  if (numeric) return Number(numeric);
  const roman = title.match(/\bpart\s+(I|II|III|IV|V)$/i)?.[1]?.toUpperCase();
  return roman ? ROMAN_SEASONS[roman] : undefined;
}

export function inferMediaDisplayedSeasonNumber(
  media: AniListCatalogMedia | AniListMediaDetail,
): number | undefined {
  return mediaTitleVariants(media)
    .map(inferDisplayedSeasonNumber)
    .find((number): number is number => number !== undefined);
}

export function inferMediaDisplayedPartNumber(
  media: AniListCatalogMedia | AniListMediaDetail,
): number | undefined {
  return mediaTitleVariants(media)
    .map(inferDisplayedPartNumber)
    .find((number): number is number => number !== undefined);
}

function mediaTitleVariants(media: AniListCatalogMedia | AniListMediaDetail): string[] {
  return "synonyms" in media
    ? [
        media.title,
        media.titleEnglish,
        media.titleRomaji,
        media.titleNative,
        ...media.synonyms,
      ].filter((title): title is string => typeof title === "string" && title.length > 0)
    : [media.title];
}
