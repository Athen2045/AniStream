import { randomUUID } from "node:crypto";
import type {
  AniListCatalogPage,
  AniListDashboard,
  AniListMedia,
  AniListMediaType,
  BrowseAniListInput,
} from "../../shared/contracts";
import type { LocalActivity } from "../../shared/activity";
import type {
  DiscoveryFeed,
  DiscoveryFeedback,
  DiscoveryImpressionInput,
} from "../../shared/discovery";
import type {
  RecommendationItemFeatures,
  RecommendationResult,
} from "../../shared/recommendations";
import type { DiscoveryStore } from "./discovery-store";
import { discoveryEvidence, recommendationFeatures } from "./discovery-evidence";
import { buildRecommendationProfile, profileFeatureKey } from "./profile";
import {
  filterRecommendationCandidates,
  scoreRecommendationCandidate,
  selectRecommendations,
} from "./scoring";

interface Dependencies {
  store: DiscoveryStore;
  owner(): number;
  activity(): LocalActivity[];
  dashboard(): AniListDashboard | undefined;
  seeds(ids: number[], signal?: AbortSignal): Promise<AniListMedia[]>;
  browse(input: BrowseAniListInput, signal?: AbortSignal): Promise<AniListCatalogPage>;
  now?: () => number;
  providerTimeoutMs?: number;
}
const PROVIDER_DEADLINE_MS = 12_000;
interface CandidatePool {
  items: RecommendationItemFeatures[];
  expiresAt: number;
  message?: string;
}

export class DiscoveryService {
  private readonly now: () => number;
  private readonly providerTimeoutMs: number;
  private readonly pools = new Map<string, CandidatePool>();
  private readonly pending = new Map<string, Promise<DiscoveryFeed>>();
  private readonly requests = new Map<
    string,
    { owner: number; items: RecommendationResult[]; expiresAt: number }
  >();
  private disposed = false;
  constructor(private readonly deps: Dependencies) {
    this.now = deps.now ?? Date.now;
    this.providerTimeoutMs = deps.providerTimeoutMs ?? PROVIDER_DEADLINE_MS;
  }

  getForYou(type: AniListMediaType): Promise<DiscoveryFeed> {
    const owner = this.deps.owner();
    const key = `${owner}:${type}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const load = this.load(type, owner).finally(() => this.pending.delete(key));
    this.pending.set(key, load);
    return load;
  }

  feedback(input: DiscoveryFeedback): void {
    const request = this.request(input.requestId);
    const item = request.items.find((row) => row.anilistId === input.anilistId);
    if (!item) throw new Error("This recommendation is no longer available. Refresh For You.");
    this.deps.store.feedback(request.owner, item, input.action, this.now());
  }

  impressions(input: DiscoveryImpressionInput): void {
    const request = this.request(input.requestId);
    for (const id of new Set(input.anilistIds)) {
      const position = request.items.findIndex((row) => row.anilistId === id);
      if (position < 0) throw new Error("Invalid visible recommendation.");
    }
    for (const id of new Set(input.anilistIds)) {
      const position = request.items.findIndex((row) => row.anilistId === id);
      this.deps.store.impression(
        request.owner,
        input.requestId,
        request.items[position],
        position,
        this.now(),
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    this.requests.clear();
    this.pools.clear();
  }

  private assertOwner(owner: number): void {
    if (this.disposed || this.deps.owner() !== owner)
      throw new Error("Viewer changed. Refresh For You.");
  }
  private request(id: string) {
    const request = this.requests.get(id);
    if (!request || request.expiresAt <= this.now())
      throw new Error("Recommendations expired. Refresh For You.");
    this.assertOwner(request.owner);
    return request;
  }

  private async load(type: AniListMediaType, owner: number): Promise<DiscoveryFeed> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new DOMException("Recommendation request timed out.", "TimeoutError"));
    }, this.providerTimeoutMs);
    try {
      return await this.loadWithinDeadline(type, owner, controller.signal);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async loadWithinDeadline(
    type: AniListMediaType,
    owner: number,
    signal: AbortSignal,
  ): Promise<DiscoveryFeed> {
    this.assertOwner(owner);
    const now = this.now();
    const dashboard = this.deps.dashboard();
    const evidence = discoveryEvidence(
      this.deps.activity(),
      dashboard?.profile.id === owner ? dashboard : undefined,
    );
    if (new Set(evidence.events.map((row) => row.anilistId)).size < 5)
      return {
        status: "learning",
        items: [],
        message:
          "Watch or read five titles to shape your recommendations. Opening a title alone does not count.",
      };
    const feedback = this.deps.store.events(owner);
    const stored = this.deps.store.features([
      ...evidence.media.map((row) => row.id),
      ...feedback.map((row) => row.anilistId),
    ]);
    const features = new Map(stored.map((row) => [row.anilistId, row]));
    const missing: number[] = [];
    for (const media of evidence.media) {
      if (media.genres?.length) features.set(media.id, recommendationFeatures(media, now));
      else if (!features.has(media.id) || features.get(media.id)!.updatedAt < now - 6 * 60 * 60_000)
        missing.push(media.id);
    }
    if (missing.length) {
      try {
        const hydrated = await this.deps.seeds(missing.slice(0, 24), signal);
        this.assertOwner(owner);
        for (const media of hydrated) {
          if (missing.includes(media.id))
            features.set(media.id, recommendationFeatures(media, now));
        }
      } catch (reason) {
        this.assertOwner(owner);
        return {
          status: "unavailable",
          items: [],
          message: providerMessage(reason, "AniList history metadata could not be checked."),
        };
      }
    }
    this.assertOwner(owner);
    const allFeatures = [...features.values()];
    this.deps.store.saveFeatures(allFeatures);
    const profile = buildRecommendationProfile([...evidence.events, ...feedback], allFeatures, now);
    const genres = [...new Set(allFeatures.flatMap((row) => row.genres))]
      .map((genre) => {
        const weight = profile.features[profileFeatureKey("genre", genre)];
        return {
          genre,
          weight: (weight?.positiveWeight ?? 0) - (weight?.negativeWeight ?? 0) * 1.15,
        };
      })
      .filter((row) => row.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.genre.localeCompare(b.genre))
      .slice(0, 2)
      .map((row) => row.genre);
    const key = `${type}:${genres.join(",")}`;
    let pool = this.pools.get(key);
    if (!pool || pool.expiresAt <= now) {
      const candidates: RecommendationItemFeatures[] = [];
      let failure: unknown;
      for (const genre of [...genres, undefined]) {
        try {
          const page = await this.deps.browse(
            {
              type,
              genre,
              page: 1,
              perPage: 20,
              sort: genre ? "SCORE_DESC" : "TRENDING_DESC",
            },
            signal,
          );
          this.assertOwner(owner);
          candidates.push(
            ...page.items
              .slice(0, 20)
              .filter((row) => row.type === type)
              .map((row) => recommendationFeatures(row, now)),
          );
        } catch (reason) {
          this.assertOwner(owner);
          failure = reason;
          break; // The shared transport owns cooldown; never fan out after a 429/403.
        }
      }
      pool = {
        items: candidates.length ? candidates : (pool?.items ?? []),
        expiresAt: now + (failure ? 60_000 : 10 * 60_000),
        message: failure
          ? providerMessage(
              failure,
              "AniList recommendation check failed. Available results may be incomplete or out of date.",
            )
          : undefined,
      };
      this.pools.set(key, pool);
      if (this.pools.size > 8) this.pools.delete(this.pools.keys().next().value!);
    }
    this.assertOwner(owner);
    this.deps.store.saveFeatures(pool.items);
    for (const row of feedback)
      if (row.eventType === "dismissed") evidence.excluded.add(row.anilistId);
    const items = selectRecommendations(
      filterRecommendationCandidates(
        pool.items.map((features) => ({ features })),
        evidence.excluded,
      ).map((row) => scoreRecommendationCandidate(row, profile, now)),
      10,
    );
    const requestId = randomUUID();
    for (const [id, request] of this.requests)
      if (request.expiresAt <= now || request.owner !== owner) this.requests.delete(id);
    this.requests.set(requestId, { owner, items, expiresAt: now + 60 * 60_000 });
    if (this.requests.size > 32) this.requests.delete(this.requests.keys().next().value!);
    return {
      status: pool.message && !items.length ? "unavailable" : "ready",
      items,
      requestId,
      message: pool.message,
    };
  }
}

function providerMessage(reason: unknown, fallback: string): string {
  const raw = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? "");
  if (/timeout|aborterror/i.test(raw))
    return "AniList recommendations are taking longer than expected. Try again in a moment.";
  if (/\b429\b|rate.?limit|too many requests/i.test(raw))
    return "AniList is busy right now. Try recommendations again in a few minutes.";
  if (/failed to fetch|network|offline|enotfound|econn|dns/i.test(raw))
    return "AniList could not be reached. Check your connection and try again.";
  return fallback;
}
