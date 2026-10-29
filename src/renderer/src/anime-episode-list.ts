import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  AnimeEpisodeArt,
  AnimeEpisodeCatalog,
  AnimeProviderEpisode,
  AnimeProviderSeason,
} from "../../shared/contracts";
import { unairedEpisode } from "./airing";
import { formatMediaLabel } from "./format-label";
import { friendlyRemoteError } from "./remote-error";

/** The titles the episode index is searched with: AniList's names and synonyms, at most 8. */
export function catalogTitles(media: AniListCatalogMedia | AniListMediaDetail): string[] {
  const detailTitles =
    "synonyms" in media
      ? [media.title, media.titleEnglish, media.titleRomaji, media.titleNative, ...media.synonyms]
      : [media.title];
  return [...new Set(detailTitles.filter(isNonEmptyString))].slice(0, 8);
}

export function catalogSeasonLabel(media: AniListCatalogMedia | AniListMediaDetail): string {
  return media.season && media.seasonYear
    ? `${formatMediaLabel(media.season, "Anime")} ${media.seasonYear}`
    : "Season 1";
}

/** The list shown when the episode index could not be asked: the AniList fallback stays usable. */
export function unavailableCatalog(reason: unknown): AnimeEpisodeCatalog {
  return {
    status: "unavailable",
    provider: "anime-source",
    seasons: [],
    message: friendlyRemoteError(reason, {
      provider: "The anime player",
      operation: "episode details",
      fallback:
        "Episode details could not be loaded. You can still try an episode, or retry the list.",
    }),
    checkedAt: new Date().toISOString(),
  };
}

/** Applies episode-art details without replacing a genuine provider title or description. */
export function withEpisodeArt(
  episode: AnimeProviderEpisode,
  art: AnimeEpisodeArt,
): AnimeProviderEpisode {
  const ownTitle = episode.title?.trim();
  const placeholder = !ownTitle || /^(episode|ep\.?)\s*\d+$/i.test(ownTitle);
  return {
    ...episode,
    ...(art.stillUrl ? { thumbnailUrl: art.stillUrl } : {}),
    ...(placeholder && art.title ? { title: art.title } : {}),
    ...(!episode.description?.trim() && art.synopsis ? { description: art.synopsis } : {}),
  };
}

export function fallbackSeason(
  media: AniListCatalogMedia | AniListMediaDetail,
): AnimeProviderSeason {
  const count = Math.min(
    Math.max(
      media.totalProgress ?? 0,
      media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : 0,
      1,
    ),
    2_000,
  );
  return {
    id: `anilist:${media.id}`,
    number: 1,
    title: "Season 1",
    episodes: Array.from({ length: count }, (_, index) => ({
      id: "",
      number: index + 1,
    })),
  };
}

/**
 * Provider lists stop at the last aired episode. When the list ends right before AniList's next
 * scheduled episode, show that episode too, as a locked tile with its airing time.
 */
export function withNextAiringTile(
  seasons: AnimeProviderSeason[],
  media: AniListCatalogMedia | AniListMediaDetail,
): AnimeProviderSeason[] {
  const next = media.nextAiringEpisode;
  const last = seasons.at(-1);
  if (!next || !last || !unairedEpisode(media, next.episode)) return seasons;
  const highest = Math.max(0, ...last.episodes.map((episode) => episode.number));
  if (highest !== next.episode - 1) return seasons;
  return [
    ...seasons.slice(0, -1),
    { ...last, episodes: [...last.episodes, { id: "", number: next.episode }] },
  ];
}

export function episodePlaceholder(number: number): AnimeProviderEpisode {
  const normalized = Math.max(1, number);
  return {
    id: "",
    number: normalized,
    title: `Episode ${normalized}`,
  };
}

export function seasonContainingEpisode(
  seasons: AnimeProviderSeason[],
  wanted: AnimeProviderEpisode,
): AnimeProviderSeason | undefined {
  return seasons.find((season) => season.episodes.some((episode) => sameEpisode(episode, wanted)));
}

/** The listed episode with this number (or a placeholder for it) and the season that holds it. */
export function findEpisode(
  seasons: AnimeProviderSeason[],
  number: number,
): { episode: AnimeProviderEpisode; season?: AnimeProviderSeason } {
  const episode =
    seasons.flatMap((season) => season.episodes).find((item) => item.number === number) ??
    episodePlaceholder(number);
  return { episode, season: seasonContainingEpisode(seasons, episode) ?? seasons[0] };
}

export function sameEpisode(left: AnimeProviderEpisode, right: AnimeProviderEpisode): boolean {
  return left.id && right.id ? left.id === right.id : left.number === right.number;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
