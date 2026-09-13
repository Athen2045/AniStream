import type { AppDatabase } from "../database";
import { RecommendationService } from "./service";
import { previewCandidates, previewFeatures, previewSeedEvents } from "./preview-fixtures";
import { registerTrustedIpcHandler } from "../ipc";

export function createPreviewRecommendationService(database: AppDatabase): RecommendationService {
  if (!database.listRecommendationItemFeatures().length) {
    for (const feature of previewFeatures) database.upsertRecommendationItemFeatures(feature);
  }
  if (!database.listRecommendationEvents().length) {
    for (const event of previewSeedEvents) database.recordRecommendationEvent(event);
  }
  return new RecommendationService({
    repository: database,
    candidateSource: async ({ profileFeatures, events }) =>
      previewCandidates(profileFeatures, events),
  });
}

export function registerPreviewRecommendationDomain(
  trustedRendererOrigin: string,
  service: RecommendationService,
): void {
  registerTrustedIpcHandler(trustedRendererOrigin, "recommendations:get-for-you-preview", () =>
    service.getForYou(),
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "recommendations:record-interaction",
    (_event, event) => service.recordInteraction(event),
  );
}
