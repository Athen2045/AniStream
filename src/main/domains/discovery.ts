import type { AniListClient } from "../anilist";
import type { AppDatabase } from "../database";
import { registerTrustedIpcHandler } from "../ipc";
import { DiscoveryService } from "../recommendations/discovery-service";
import { MoreDiscoveryService } from "../recommendations/more-discovery-service";
import type { TmdbClient } from "../tmdb";
import { mergeMoreHistory } from "../more-library";
import type { SimklService } from "../simkl/service";
import type { FieldSnapshots } from "../field-snapshots";
import {
  isUsableDiscoveryFeed,
  isUsableMoreFeed,
  withoutDiscoveryTitle,
  withoutMoreTitle,
} from "../home-fields";

export function registerDiscoveryDomain(
  origin: string,
  database: AppDatabase,
  aniList: AniListClient,
  tmdb?: TmdbClient,
  simkl?: SimklService,
  snapshots?: FieldSnapshots,
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
    hiddenTags: () => personalization.hiddenTags(),
  });
  // A saved feed is shown until the viewer acts (watching, a choice, Refresh asks for `fresh`).
  registerTrustedIpcHandler(origin, "discovery:for-you", async (_event, type, fresh) => {
    const load = async () => {
      await prepareLinks();
      return service.getForYou(type);
    };
    const viewer = owner();
    if (!snapshots || !viewer) return load();
    return snapshots.get(
      {
        key: `for-you:${viewer}:${type}`,
        load,
        usable: isUsableDiscoveryFeed,
        adopt: (feed) => service.adopt(feed),
      },
      fresh === true,
    );
  });
  registerTrustedIpcHandler(origin, "discovery:feedback", (_event, input) => {
    service.feedback(input);
    if (input.action !== "dismiss" || !snapshots) return;
    for (const type of ["ANIME", "MANGA"] as const)
      snapshots.update(`for-you:${owner()}:${type}`, (value) =>
        withoutDiscoveryTitle(value, input.anilistId),
      );
  });
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
    collection: (id) => {
      if (!tmdb) throw new Error("TMDB is not configured.");
      return tmdb.getCollection(id);
    },
    hiddenTags: () => personalization.hiddenTags(),
  });
  registerTrustedIpcHandler(origin, "more:for-you", async (_event, fresh) => {
    // A due Simkl check runs in the background; its finish tells the renderer to reload.
    void simkl?.syncIfStale();
    const load = async () => {
      await prepareLinks();
      return more.getForYou();
    };
    if (!snapshots) return load();
    return snapshots.get(
      {
        key: `more-for-you:${owner()}`,
        load,
        usable: isUsableMoreFeed,
        adopt: (feed) => more.adopt(feed),
      },
      fresh === true,
    );
  });
  registerTrustedIpcHandler(origin, "more:for-you-feedback", (_event, input) => {
    more.feedback(input);
    if (input.action !== "dismiss" || !snapshots) return;
    snapshots.update(`more-for-you:${owner()}`, (value) =>
      withoutMoreTitle(value, input.type, input.tmdbId),
    );
  });
  const settings = () => ({
    activitySignals: personalization.activitySignals(),
    timeToPlay: personalization.timeToPlay(),
    hiddenTags: personalization.hiddenTags(),
  });
  registerTrustedIpcHandler(origin, "personalization:set-hidden-tags", (_event, names) => {
    personalization.setHiddenTags(names);
    // Saved feeds may hold newly hidden titles; the next view rebuilds them.
    const viewer = owner();
    for (const key of [
      `for-you:${viewer}:ANIME`,
      `for-you:${viewer}:MANGA`,
      `more-for-you:${viewer}`,
    ])
      snapshots?.forget(key);
    return settings();
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
