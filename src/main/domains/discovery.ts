import type { AniListClient } from "../anilist";
import type { AppDatabase } from "../database";
import { registerTrustedIpcHandler } from "../ipc";
import { DiscoveryService } from "../recommendations/discovery-service";

export function registerDiscoveryDomain(
  origin: string,
  database: AppDatabase,
  aniList: AniListClient,
): () => void {
  const owner = (): number => {
    const state = aniList.getState();
    return state.status === "signed-in" ? state.profile.id : 0;
  };
  const service = new DiscoveryService({
    store: database.discovery,
    owner,
    activity: () => database.listActivity(owner()),
    dashboard: () => database.getCachedAniListDashboard(),
    seeds: (ids, signal) => aniList.getRecommendationSeeds(ids, signal),
    browse: (input, signal) => aniList.browseMedia(input, signal),
  });
  registerTrustedIpcHandler(origin, "discovery:for-you", (_event, type) => service.getForYou(type));
  registerTrustedIpcHandler(origin, "discovery:feedback", (_event, input) =>
    service.feedback(input),
  );
  registerTrustedIpcHandler(origin, "discovery:impressions", (_event, input) =>
    service.impressions(input),
  );
  return () => service.dispose();
}
