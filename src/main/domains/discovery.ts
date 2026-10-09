import type { AniListClient } from "../anilist";
import type { AppDatabase } from "../database";
import { registerTrustedIpcHandler } from "../ipc";
import { DiscoveryService } from "../recommendations/discovery-service";
import { MoreDiscoveryService } from "../recommendations/more-discovery-service";
import type { TmdbClient } from "../tmdb";
import { mergeMoreHistory } from "../more-library";
import type { SimklService } from "../simkl/service";

export function registerDiscoveryDomain(
  origin: string,
  database: AppDatabase,
  aniList: AniListClient,
  tmdb?: TmdbClient,
  simkl?: SimklService,
): () => void {
  const owner = (): number => {
    const state = aniList.getState();
    return state.status === "signed-in" ? state.profile.id : 0;
  };
  const links = database.animeTmdbLinks;
  // Waits only for the first-ever download (bounded); later refreshes run in the background.
  const prepareLinks = (): Promise<void> => links.prepare(5_000);
  // Local playback evidence plus the imported Simkl library, merged per title.
  const moreHistory = () => mergeMoreHistory(database.listMoreHistory(), simkl?.history() ?? []);
  // More titles watched past a player check; their anime counterparts leave Anime For You.
  const watchedMore = (): Set<string> =>
    new Set(
      moreHistory()
        .filter(
          (entry) =>
            entry.finishedEpisodes > 0 ||
            entry.maxRatio >= 0.25 ||
            entry.trackerStatus === "completed",
        )
        .map((entry) => `${entry.type}:${entry.tmdbId}`),
    );
  const personalization = database.personalization;
  const service = new DiscoveryService({
    feedback: () => personalization.feedback(),
    links: () => links.index(),
    watchedMore,
    store: database.discovery,
    owner,
    activity: () => database.listActivity(owner()),
    dashboard: () => database.getCachedAniListDashboard(),
    seeds: (ids, signal) => aniList.getRecommendationSeeds(ids, signal),
    trending: (type, signal) => aniList.getRecommendationTrending(type, signal),
  });
  registerTrustedIpcHandler(origin, "discovery:for-you", async (_event, type) => {
    await prepareLinks();
    return service.getForYou(type);
  });
  registerTrustedIpcHandler(origin, "discovery:feedback", (_event, input) =>
    service.feedback(input),
  );
  registerTrustedIpcHandler(origin, "discovery:impressions", (_event, input) =>
    service.impressions(input),
  );
  const more = new MoreDiscoveryService({
    feedback: () => personalization.feedback(),
    activitySignals: () => personalization.activitySignals(),
    collaborative: (ref) => simkl?.collaborative(ref),
    warmCollaborative: (refs) => simkl?.warmCollaborative(refs) ?? Promise.resolve(),
    links: () => links.index(),
    watchedAniList: () => service.watchedAniList(),
    store: database.moreDiscovery,
    history: moreHistory,
    aniListTaste: () => service.tasteHistory(),
    seed: (id, type) => {
      if (!tmdb) throw new Error("TMDB is not configured.");
      return tmdb.getRecommendationSeed(id, type);
    },
    trending: (type) => {
      if (!tmdb) throw new Error("TMDB is not configured.");
      return tmdb.getRecommendationTrending(type);
    },
    byLanguage: (type, language) => {
      if (!tmdb) throw new Error("TMDB is not configured.");
      return tmdb.getRecommendationsByLanguage(type, language);
    },
    byKeyword: (type, keyword) => {
      if (!tmdb) throw new Error("TMDB is not configured.");
      return tmdb.getRecommendationsByKeyword(type, keyword);
    },
  });
  registerTrustedIpcHandler(origin, "more:for-you", async () => {
    // A due Simkl check runs in the background; its finish tells the renderer to reload.
    void simkl?.syncIfStale();
    await prepareLinks();
    return more.getForYou();
  });
  registerTrustedIpcHandler(origin, "more:for-you-feedback", (_event, input) =>
    more.feedback(input),
  );
  const settings = () => ({
    activitySignals: personalization.activitySignals(),
    timeToPlay: personalization.timeToPlay(),
  });
  registerTrustedIpcHandler(origin, "personalization:settings", settings);
  registerTrustedIpcHandler(origin, "personalization:set-activity", (_event, on) => {
    personalization.setActivitySignals(on);
    return settings();
  });
  registerTrustedIpcHandler(origin, "personalization:time-to-play", (_event, section, seconds) => {
    // Measured only while the viewer lets AniStream learn from activity.
    if (personalization.activitySignals())
      personalization.recordTimeToPlay(section, Math.round(seconds * 10) / 10, Date.now());
  });
  registerTrustedIpcHandler(origin, "personalization:feedback", (_event, ref) =>
    personalization.getFeedback(ref),
  );
  registerTrustedIpcHandler(origin, "personalization:set-feedback", (_event, ref, value) =>
    personalization.setFeedback(ref, value, Date.now()),
  );
  return () => service.dispose();
}
