import type { FieldSnapshots } from "../field-snapshots";
import { isUsableMorePage } from "../home-fields";
import type { AppDatabase } from "../database";
import { registerTrustedIpcHandler } from "../ipc";
import type { MorePlayerFrameUserAgent } from "../more-player-frame-ua";
import { buildMorePlayerUrl } from "../more-player-url";
import type { MoreTmdbEmbedProvider } from "../provider-config";
import { mergeMoreHistory } from "../more-library";
import type { SimklService } from "../simkl/service";
import { TmdbClient } from "../tmdb";

export interface MoreDomainDeps {
  tmdb: TmdbClient;
  database: AppDatabase | undefined;
  /** Players from the gitignored provider config, primary first; empty means unconfigured. */
  players: readonly MoreTmdbEmbedProvider[];
  /** Exists only while the main window does. */
  frameUserAgent: () => MorePlayerFrameUserAgent | undefined;
  /** The optional Simkl connection; "+" choices are mirrored there when it can write. */
  tracker?: () => SimklService | undefined;
  /** Saved Trending copies (shown at once, refreshed in the background for the next launch). */
  snapshots?: FieldSnapshots;
}

const MORE_LIKE_THIS_LIMIT = 6;

export function registerMoreDomain(
  trustedRendererOrigin: string,
  { tmdb, database, players, frameUserAgent, tracker, snapshots }: MoreDomainDeps,
): void {
  registerTrustedIpcHandler(trustedRendererOrigin, "more:trending", (_event, type, page) =>
    snapshots && page === 1
      ? snapshots.get({
          key: `more-trending:${type}`,
          load: () => tmdb.getTrending(type, page),
          usable: isUsableMorePage,
        })
      : tmdb.getTrending(type, page),
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "more:browse", (_event, input) =>
    tmdb.browse(input),
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "more:search", (_event, query, type, page) =>
    tmdb.search(query, type, page),
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "more:detail", async (_event, id, type) => {
    const detail = await tmdb.getDetail(id, type);
    // "More like this" skips what the viewer already watched (user decision 2026-10-06).
    const watched = new Set(
      (database?.listMoreHistory() ?? [])
        .filter((entry) => entry.finishedEpisodes > 0)
        .map((entry) => `${entry.type}:${entry.tmdbId}`),
    );
    return {
      ...detail,
      recommendations: detail.recommendations
        .filter((item) => !watched.has(`${item.type}:${item.id}`))
        .slice(0, MORE_LIKE_THIS_LIMIT),
    };
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "more:season", (_event, id, season) =>
    tmdb.getSeason(id, season),
  );
  const library = (): AppDatabase => {
    if (!database) throw new Error("AniStream database is not ready.");
    return database;
  };
  /**
   * Titles that count as completed: marked Completed here, Completed on Simkl, or a movie played
   * to the end here. Shows need the mark, since finishing one episode is not finishing the show.
   */
  const completedKeys = (): Set<string> =>
    new Set(
      mergeMoreHistory(library().listMoreHistory(), tracker?.()?.history() ?? [])
        .filter(
          (entry) =>
            entry.trackerStatus === "completed" ||
            (entry.type === "MOVIE" && entry.finishedEpisodes > 0 && entry.maxRatio > 0),
        )
        .map((entry) => `${entry.type}:${entry.tmdbId}`),
    );
  registerTrustedIpcHandler(trustedRendererOrigin, "more:library", () => {
    const local = library().getMoreLibrary();
    const completed = [...completedKeys()].map((key) => {
      const [type, id] = key.split(":");
      return { type: type as "MOVIE" | "TV", tmdbId: Number(id) };
    });
    return { ...local, completed };
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "more:title-status",
    async (_event, title, action) => {
      // Local first: the choice is kept even when Simkl is offline or not connected.
      if (action === "completed") library().setMoreCompleted(title, true);
      else library().setMoreWatchlist(title, action === "planning");
      try {
        const synced =
          (await tracker?.()?.setTitleStatus({ type: title.type, tmdbId: title.id }, action)) ??
          false;
        return { simkl: synced ? ("synced" as const) : ("skipped" as const) };
      } catch (reason) {
        return {
          simkl: "failed" as const,
          message:
            reason instanceof Error && /Simkl does not know/.test(reason.message)
              ? reason.message
              : "Saved here, but Simkl could not be updated. Try again later.",
        };
      }
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "more:simkl-rows",
    () => tracker?.()?.rows() ?? [],
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "more:rating", (_event, ref) => {
    const simkl = tracker?.();
    const auth = simkl?.status().auth;
    return {
      rating: library().getMoreRating(ref) ?? simkl?.ratingFor(ref),
      canRate: completedKeys().has(`${ref.type}:${ref.tmdbId}`),
      simklUrl: simkl?.titleLink(ref),
      syncsToSimkl: auth?.status === "connected" && Boolean(auth.canWrite),
    };
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "more:rating-set",
    async (_event, title, rating) => {
      // Ratings are for finished titles; clearing one is always allowed.
      if (rating !== null && !completedKeys().has(`${title.type}:${title.id}`))
        throw new Error("Finish watching this title, or mark it Completed, before rating it.");
      library().setMoreRating(title, rating ?? undefined);
      try {
        const synced =
          (await tracker?.()?.setRating(
            { type: title.type, tmdbId: title.id },
            rating ?? undefined,
          )) ?? false;
        return { simkl: synced ? ("synced" as const) : ("skipped" as const) };
      } catch (reason) {
        return {
          simkl: "failed" as const,
          message:
            reason instanceof Error && /Simkl does not know/.test(reason.message)
              ? reason.message
              : "Rating saved here, but Simkl could not be updated. Try again later.",
        };
      }
    },
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "more:title-progress", (_event, input) => {
    // Loaded when a title page opens: the title no longer counts as shown-but-ignored.
    database?.moreDiscovery.markOpened(`${input.type}:${input.tmdbId}`);
    return library().getMoreTitleProgress(input);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "more:watchlist-set", (_event, title, saved) =>
    library().setMoreWatchlist(title, saved),
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "more:remember", (_event, title) =>
    library().rememberMoreTitle(title),
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "more:player-prepare", async (_event, input) => {
    if (players.length === 0) throw new Error("More playback is not configured on this device.");
    const providerIndex = input.providerIndex ?? 0;
    const player = players[providerIndex];
    if (!player) throw new Error("No further More player is configured.");
    const url = buildMorePlayerUrl(player, input);
    // Only a player whose entry opts in gets the approved UA override. Arm before the renderer
    // creates the iframe so its first request already has the right UA.
    if (player.stripElectronUserAgent) await frameUserAgent()?.arm(player.origin);
    else frameUserAgent()?.disarm();
    return { url, providerIndex, providerCount: players.length };
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "more:player-release", () => {
    frameUserAgent()?.disarm();
  });
}
