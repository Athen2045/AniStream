import { useEffect, useEffectEvent, useMemo, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  AnimeEpisodeArt,
  AnimeEpisodeCatalog,
  AnimeEpisodeRange,
  AnimeEpisodeRanges,
  AnimeProviderEpisode,
  AnimeProviderSeason,
  PlaybackResume,
} from "../../shared/contracts";
import { chooseInitialAnimeEpisode } from "./anime-playback-session";
import { unairedEpisode } from "./airing";
import {
  catalogSeasonLabel,
  catalogTitles,
  fallbackSeason,
  findEpisode,
  sameEpisode,
  seasonContainingEpisode,
  unavailableCatalog,
  withEpisodeArt,
  withNextAiringTile,
} from "./anime-episode-list";
import { rangeContaining } from "./SeasonPicker";

/** Matches the main process: shorter entries are never split into arcs or seasons. */
const MIN_RANGE_EPISODES = 50;

/** How long a recommendation card waits for AniList's details before loading episodes anyway. */
const THIN_MEDIA_WAIT_MS = 4_000;

export type EpisodeListLoaded = {
  /** The episode to open on: the request, moved on by progress unless it was exact. */
  episode: AnimeProviderEpisode;
  season?: AnimeProviderSeason;
  /** The title's saved playback spot, whichever episode it is for. */
  saved?: PlaybackResume;
};

/**
 * The episode list of the watch screen: the index's seasons (or an AniList stand-in), episode art,
 * story-arc ranges for long runners, and the neighbours of the episode on screen. Each finished
 * list load reports the episode to open on through `onLoaded`, in the same render as the list.
 */
export function useEpisodeList({
  media,
  initialEpisode,
  exactEpisode,
  activeEpisode,
  selectedSeasonId,
  onLoaded,
}: {
  media: AniListCatalogMedia | AniListMediaDetail;
  initialEpisode: number;
  exactEpisode: boolean;
  activeEpisode: AnimeProviderEpisode;
  selectedSeasonId: string;
  onLoaded: (loaded: EpisodeListLoaded) => void;
}) {
  const [catalog, setCatalog] = useState<AnimeEpisodeCatalog>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [catalogMedia, setCatalogMedia] = useState(media);
  // A recommendation card (For You, "Because you…") opens the page before AniList's details arrive
  // and carries no episode count, status or airing schedule. Once they arrive, reload the episode
  // list with them; other updates (e.g. list progress) keep the loaded list.
  if (
    media.id === catalogMedia.id &&
    (media.totalProgress !== catalogMedia.totalProgress ||
      media.status !== catalogMedia.status ||
      media.nextAiringEpisode?.episode !== catalogMedia.nextAiringEpisode?.episode)
  )
    setCatalogMedia(media);
  const [catalogInitialEpisode] = useState(initialEpisode);
  const [catalogExactEpisode] = useState(exactEpisode);
  const titles = useMemo(() => catalogTitles(catalogMedia), [catalogMedia]);
  const fallback = useMemo(() => fallbackSeason(catalogMedia), [catalogMedia]);

  // Episode-art sources (exact links): a still replaces the tile artwork, and a real title and
  // synopsis fill in where the episode list has only "Episode N".
  const [episodeArt, setEpisodeArt] = useState<ReadonlyMap<number, AnimeEpisodeArt>>(new Map());
  const listedSeasons = catalog?.seasons.length ? catalog.seasons : [fallback];
  const lastEpisode = Math.max(
    0,
    ...listedSeasons.flatMap((season) => season.episodes.map((episode) => episode.number)),
  );
  const seasons = useMemo(() => {
    const listed = catalog?.seasons.length ? catalog.seasons : [fallback];
    const withArt = episodeArt.size
      ? listed.map((season) => ({
          ...season,
          episodes: season.episodes.map((episode) => {
            const extra = episodeArt.get(episode.number);
            return extra ? withEpisodeArt(episode, extra) : episode;
          }),
        }))
      : listed;
    return withNextAiringTile(withArt, media);
  }, [catalog, episodeArt, fallback, media]);
  const activeSeason =
    seasons.find((season) => season.id === selectedSeasonId) ??
    seasonContainingEpisode(seasons, activeEpisode) ??
    seasons[0];
  const allEpisodes = useMemo(() => seasons.flatMap((season) => season.episodes), [seasons]);

  // Long runners listed as one season are browsed by story arc (or TheTVDB season).
  // Both are keyed, so a different title or a newly played episode simply stops matching.
  const rangesKey = `${catalogMedia.id}:${lastEpisode}`;
  const [loadedRanges, setLoadedRanges] = useState<{ key: string; ranges?: AnimeEpisodeRanges }>();
  const [rangeChoice, setRangeChoice] = useState<{ episode: number; start: number }>();
  const singleListedSeason = listedSeasons.length === 1;
  useEffect(() => {
    if (loading || !singleListedSeason || lastEpisode < MIN_RANGE_EPISODES) return;
    let active = true;
    window.anistream
      .getAnimeEpisodeRanges({ aniListId: catalogMedia.id, episodes: lastEpisode })
      .then((ranges) => {
        if (active) setLoadedRanges({ key: `${catalogMedia.id}:${lastEpisode}`, ranges });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [catalogMedia.id, lastEpisode, loading, singleListedSeason]);
  const ranges =
    singleListedSeason && loadedRanges?.key === rangesKey ? loadedRanges.ranges : undefined;
  // Playing another episode brings the list back to the range that holds it.
  const selectedRangeStart =
    rangeChoice?.episode === activeEpisode.number ? rangeChoice.start : undefined;
  const selectRange = (range: AnimeEpisodeRange): void =>
    setRangeChoice({ episode: activeEpisode.number, start: range.start });
  const activeRange = ranges
    ? (ranges.ranges.find((range) => range.start === selectedRangeStart) ??
      rangeContaining(ranges.ranges, activeEpisode.number))
    : undefined;

  // Stills follow the episodes on screen: long series load the art around this tab or range.
  const artFocus = activeRange?.start ?? activeSeason?.episodes[0]?.number ?? catalogInitialEpisode;
  useEffect(() => {
    if (loading || lastEpisode < 1) return;
    let active = true;
    window.anistream
      .getAnimeEpisodeArt({
        aniListId: catalogMedia.id,
        episodes: lastEpisode,
        focus: Math.min(lastEpisode, Math.max(1, artFocus)),
      })
      .then((art) => {
        if (active && art.length)
          setEpisodeArt(
            (known) => new Map([...known, ...art.map((row) => [row.number, row] as const)]),
          );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [artFocus, catalogMedia.id, lastEpisode, loading]);

  const activeIndex = useMemo(
    () => allEpisodes.findIndex((episode) => sameEpisode(episode, activeEpisode)),
    [allEpisodes, activeEpisode],
  );
  const nextEpisode = useMemo(() => {
    const next =
      activeIndex >= 0 && activeIndex + 1 < allEpisodes.length
        ? allEpisodes[activeIndex + 1]
        : undefined;
    // The end-of-episode prompt never offers an episode that has not aired yet.
    return next && !unairedEpisode(media, next.number) ? next : undefined;
  }, [activeIndex, allEpisodes, media]);
  const previousEpisode = activeIndex > 0 ? allEpisodes[activeIndex - 1] : undefined;

  // A thin card waits briefly for AniList's details before asking for episodes, so the list does
  // not first appear with a single episode; without details (e.g. offline) it goes ahead anyway.
  const thinMedia = catalogMedia.status === undefined && catalogMedia.totalProgress === undefined;
  const [thinWaitOver, setThinWaitOver] = useState(false);
  useEffect(() => {
    if (!thinMedia) return;
    const timer = window.setTimeout(() => setThinWaitOver(true), THIN_MEDIA_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [thinMedia]);
  const waitForDetails = thinMedia && !thinWaitOver;

  const reportLoaded = useEffectEvent(onLoaded);
  useEffect(() => {
    if (waitForDetails) return;
    let active = true;
    void Promise.allSettled([
      window.anistream.getAnimeEpisodeCatalog({
        aniListId: catalogMedia.id,
        titles,
        seasonLabel: catalogSeasonLabel(catalogMedia),
        totalEpisodes: Math.max(
          catalogMedia.totalProgress ?? 0,
          catalogMedia.nextAiringEpisode ? catalogMedia.nextAiringEpisode.episode - 1 : 0,
          catalogInitialEpisode,
        ),
      }),
      window.anistream.getPlaybackResume(catalogMedia.id),
      window.anistream.getLocalActivity(),
    ]).then(([catalogResult, resumeResult, activityResult]) => {
      if (!active) return;
      const nextCatalog =
        catalogResult.status === "fulfilled"
          ? catalogResult.value
          : unavailableCatalog(catalogResult.reason);
      const saved = resumeResult.status === "fulfilled" ? resumeResult.value : undefined;
      const completed =
        activityResult.status === "fulfilled"
          ? Math.max(
              0,
              ...activityResult.value
                .filter((item) => item.media.id === catalogMedia.id)
                .map((item) => item.completedProgress),
            )
          : 0;
      const wantedEpisode = chooseInitialAnimeEpisode({
        requestedEpisode: catalogInitialEpisode,
        savedEpisode: saved?.episode,
        completedProgress: completed,
        totalEpisodes: catalogMedia.totalProgress,
        exact: catalogExactEpisode,
      });
      setCatalog(nextCatalog);
      setLoading(false);
      reportLoaded({
        ...findEpisode(
          nextCatalog.seasons.length ? nextCatalog.seasons : [fallback],
          wantedEpisode,
        ),
        saved,
      });
    });

    return () => {
      active = false;
    };
  }, [
    attempt,
    fallback,
    catalogExactEpisode,
    catalogInitialEpisode,
    catalogMedia,
    titles,
    waitForDetails,
  ]);

  const retry = (): void => {
    setLoading(true);
    setAttempt((current) => current + 1);
  };

  return {
    /** The index's answer; its `message` explains a missing or partial list. */
    catalog,
    /** The title the list was loaded for (the first copy, or AniList's details once they arrive). */
    catalogMedia,
    seasons,
    activeSeason,
    ranges,
    activeRange,
    selectRange,
    previousEpisode,
    nextEpisode,
    loading,
    retry,
  };
}
