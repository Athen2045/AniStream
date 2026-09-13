import type {
  RecommendationCandidate,
  RecommendationEvent,
  RecommendationItemFeatures,
  RecommendationResult,
} from "../../shared/recommendations";
import type { RecommendationRepository } from "./repository";
import { buildRecommendationProfile } from "./profile";
import {
  filterRecommendationCandidates,
  scoreRecommendationCandidate,
  selectRecommendations,
} from "./scoring";

export const MINIMUM_MEANINGFUL_TITLES = 5;

export interface RecommendationServiceDependencies {
  repository: RecommendationRepository;
  candidateSource: (input: {
    profileFeatures: RecommendationItemFeatures[];
    events: RecommendationEvent[];
  }) => Promise<RecommendationCandidate[]>;
  now?: () => number;
}

export class RecommendationService {
  private readonly now: () => number;
  private requestSequence = 0;

  constructor(private readonly dependencies: RecommendationServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  async getForYou(): Promise<RecommendationResult[]> {
    const now = this.now();
    const events = this.dependencies.repository.listRecommendationEvents();
    if (countMeaningfulRecommendationTitles(events) < MINIMUM_MEANINGFUL_TITLES) return [];
    const features = this.dependencies.repository.listRecommendationItemFeatures();
    const profile = buildRecommendationProfile(events, features, now);
    const candidates = await this.dependencies.candidateSource({
      profileFeatures: features,
      events,
    });
    const excludedIds = new Set(
      events
        .filter((event) => event.eventType === "completed" || event.eventType === "dismissed")
        .map((event) => event.anilistId),
    );
    const filtered = filterRecommendationCandidates(candidates, excludedIds);
    const scored = filtered.map((candidate) =>
      scoreRecommendationCandidate(candidate, profile, now),
    );
    const results = selectRecommendations(scored, 10);
    this.dependencies.repository.recordRecommendationImpressions(
      this.nextRequestId(now),
      results,
      now,
    );
    return results;
  }

  async recordInteraction(event: RecommendationEvent): Promise<void> {
    if (!Number.isInteger(event.anilistId) || event.anilistId <= 0) {
      throw new Error("Invalid AniList recommendation ID.");
    }
    this.dependencies.repository.recordRecommendationEvent(event);
  }

  private nextRequestId(now: number): string {
    this.requestSequence += 1;
    return `for-you-${now}-${this.requestSequence}`;
  }
}

export function countMeaningfulRecommendationTitles(events: RecommendationEvent[]): number {
  return new Set(
    events
      .filter(
        (event) =>
          event.eventType === "started" ||
          event.eventType === "progressed" ||
          event.eventType === "completed",
      )
      .map((event) => event.anilistId),
  ).size;
}
