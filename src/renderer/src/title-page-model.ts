import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  MalScore,
  MangaEnrichment,
  MangaReadingResume,
} from "../../shared/contracts";
import type { AnimeTitleScore } from "./AnimeTitleHeader";
import { cleanDescription, formatNumber, titleFacts } from "./title-facts";
import type { ViewerAccess } from "./viewer-access";

/** The title page's words: summary, genres and titles, with MyAnimeList filling AniList's gaps. */
export interface TitleCopy {
  aniListSummary?: string;
  malSummary?: string;
  /** What the summary shows (a "no summary" line when neither source has one). */
  description: string;
  genres: string[];
  /** What MyAnimeList filled in, for its credit line ("Summary", "English title", "genres"). */
  malFilled: string[];
  altTitles: string[];
  /** Manga story and art credits (MangaBaka's authors, else AniList's staff). */
  credits: string[];
}

export function titleCopy(
  media: AniListCatalogMedia,
  detail: AniListMediaDetail | undefined,
  malScore: MalScore | undefined,
  enrichment: MangaEnrichment | undefined,
): TitleCopy {
  // MyAnimeList fills what AniList leaves empty (joined only by AniList's own idMal), credited.
  const aniListSummary = cleanDescription(media.description);
  const malSummary = aniListSummary ? undefined : cleanDescription(malScore?.synopsis);
  const malEnglishTitle = detail && !detail.titleEnglish ? malScore?.englishTitle : undefined;
  const malGenres = media.genres.length ? undefined : malScore?.genres;
  return {
    aniListSummary,
    malSummary,
    description:
      aniListSummary ??
      malSummary ??
      "AniList does not currently provide a summary for this title.",
    genres: malGenres ?? media.genres,
    malFilled: [
      malSummary ? "Summary" : undefined,
      malEnglishTitle ? "English title" : undefined,
      malGenres?.length ? "genres" : undefined,
    ].filter((part): part is string => Boolean(part)),
    altTitles: [malEnglishTitle, detail?.titleRomaji, detail?.titleNative].filter(
      (value, index, all): value is string =>
        Boolean(value) &&
        value?.toLocaleLowerCase() !== media.title.toLocaleLowerCase() &&
        all.indexOf(value) === index,
    ),
    credits:
      media.type !== "ANIME" && enrichment?.status === "available" && enrichment.authors.length
        ? enrichment.authors
        : (detail?.staff ?? [])
            .filter((person) => /story|art|original creator/i.test(person.role ?? ""))
            .map((person) => person.name)
            .filter((name, index, all) => all.indexOf(name) === index)
            .slice(0, 3),
  };
}

/** Watch / Continue E5 for anime; Read / Continue / Resume for manga. */
export function primaryActionLabel(options: {
  anime: boolean;
  watchedEpisodes: number;
  totalProgress?: number;
  nextEpisode: number;
  mangaProgress: number;
  mangaResume?: MangaReadingResume;
}): string {
  const { watchedEpisodes, mangaResume, mangaProgress } = options;
  if (options.anime)
    return watchedEpisodes > 0 && watchedEpisodes < (options.totalProgress ?? Infinity)
      ? `Continue E${options.nextEpisode}`
      : "Watch";
  if (mangaResume?.chapterNumber !== undefined && mangaResume.progress < 1)
    return `Resume Ch. ${formatNumber(mangaResume.chapterNumber)}`;
  return mangaProgress > 0 ? `Continue Ch. ${mangaProgress + 1}` : "Read";
}

/**
 * The best 6 AniList picks (already ranked by community votes), skipping titles the viewer
 * already watched or read: anything on their list except Planning (user decision 2026-10-06).
 */
export function unseenRecommendations(
  detail: AniListMediaDetail | undefined,
  access: ViewerAccess,
  personalized: boolean,
): AniListCatalogMedia[] {
  return (detail?.recommendations ?? [])
    .filter((item) => {
      const entry =
        personalized && access.kind === "member" ? access.libraryEntries.get(item.id) : undefined;
      return !entry || entry.status === "PLANNING";
    })
    .slice(0, 6);
}

/** Episodes aired so far: everything before the next airing, else the full count. */
export function airedEpisodes(media: AniListCatalogMedia): number {
  if (media.status === "NOT_YET_RELEASED") return 0;
  return media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : (media.totalProgress ?? 0);
}

/** The anime header's score pills: MyAnimeList, then AniList. */
export function animeScores(
  media: AniListCatalogMedia,
  malScore: MalScore | undefined,
  siteUrl: string,
): AnimeTitleScore[] {
  return [
    ...(malScore?.score
      ? [
          {
            score: `★ ${malScore.score}`,
            source: "mal" as const,
            href: malScore.malUrl,
            title: malScore.scoredBy
              ? `${malScore.score}/10 from ${malScore.scoredBy.toLocaleString()} MAL users`
              : `${malScore.score}/10 on MyAnimeList`,
          },
        ]
      : []),
    ...(media.averageScore
      ? [
          {
            score: `${media.averageScore}%`,
            source: "anilist" as const,
            href: siteUrl,
            title: `${media.averageScore}% on AniList`,
          },
        ]
      : []),
  ];
}

/** An anime movie's header facts: release date, original creator and country. */
export function animeMovieFacts(detail: AniListMediaDetail): Array<[string, string]> {
  return titleFacts(detail)
    .filter(([name]) => ["Aired", "Original Creator", "Country"].includes(name))
    .map(([name, value]): [string, string] => [
      name === "Aired" ? "Released" : name === "Original Creator" ? "Original creator" : name,
      value,
    ]);
}

/** A series' About facts: status, air dates, studio and original creator. */
export function animeAboutFacts(detail: AniListMediaDetail): Array<[string, string]> {
  return titleFacts(detail)
    .filter(([name]) => ["Status", "Aired", "Studio", "Original Creator"].includes(name))
    .map(([name, value]): [string, string] => [
      name === "Original Creator" ? "Original creator" : name,
      value,
    ]);
}
