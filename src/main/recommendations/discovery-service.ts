import { randomUUID } from "node:crypto";
import type { AniListDashboard, AniListMediaType } from "../../shared/contracts";
import type { LocalActivity } from "../../shared/activity";
import type {
  DiscoveryFeed,
  DiscoveryFeedback,
  DiscoveryImpressionInput,
} from "../../shared/discovery";
import {
  HYBRID_WEIGHTS,
  type RecommendationItemFeatures,
  type RecommendationResult,
} from "../../shared/recommendations";
import type { RecommendationSeedData } from "../anilist/recommendation-seeds";
import type { AnimeTmdbLinkIndex } from "../anime-tmdb-links";
import type { DiscoveryStore } from "./discovery-store";
import type { TitleFeedbackRow } from "./personalization-store";
import { discoveryEvidence, recommendationFeatures } from "./discovery-evidence";
import {
  buildSeedRows,
  buildThemeRow,
  adjustScores,
  continuationPicks,
  eligibilityFilter,
  firstSeason,
  isHidden,
  itemKey,
  tasteRetrieval,
  toAniListResults,
  rankHybrid,
  redirectEdges,
  rowStrength,
  selectHybrid,
  type HybridHistoryItem,
} from "./hybrid";

/** Titles watched/read (any section) before For You starts; matches the hero (user 2026-10-08). */
const MIN_TITLES = 3;

interface Dependencies {
  store: DiscoveryStore;
  owner(): number;
  activity(): LocalActivity[];
  dashboard(): AniListDashboard | undefined;
  seeds(ids: number[], signal?: AbortSignal): Promise<RecommendationSeedData>;
  trending(type: AniListMediaType, signal?: AbortSignal): Promise<RecommendationItemFeatures[]>;
  /** Title-page "Interested" / "Not interested" choices (all sections; AniList reads its own). */
  feedback?: () => TitleFeedbackRow[];
  /** Exact AniList ↔ TMDB links; absent means no cross-section identity. */
  links?: () => AnimeTmdbLinkIndex;
  /** More titles really watched (`MOVIE:id` / `TV:id`); their anime stays out of For You. */
  watchedMore?: () => ReadonlySet<string>;
  /** Genres and tags the viewer hid in Settings. */
  hiddenTags?: () => string[];
  now?: () => number;
  providerTimeoutMs?: number;
}
const PROVIDER_DEADLINE_MS = 12_000;
/** Strongest liked titles considered as graph seeds; hydrated one AniList page per load. */
const MAX_SEEDS = 48;
const SEED_PAGE_SIZE = 24;
const SEED_TTL_MS = 7 * 86_400_000;
const INTERESTED_AFFINITY = 0.5;
/** Ignored-pick memory: impressions from this many days count (user request 2026-10-10). */
const IGNORED_WINDOW_MS = 30 * 86_400_000;
/** Cached titles taste retrieval reads, and how many it adds as candidates. */
const RETRIEVAL_CORPUS = 1_500;
const RETRIEVAL_LIMIT = 40;
/** How strongly the main rail follows the viewer's genre mix (0 = off). */
const CALIBRATION = 0.3;
const CONTINUATION_ROW_MIN = 2;
const HALF_LIFE_MS = HYBRID_WEIGHTS.halfLifeDays * 86_400_000;
interface CandidatePool {
  items: RecommendationItemFeatures[];
  expiresAt: number;
  message?: string;
}

export class DiscoveryService {
  private readonly now: () => number;
  private readonly providerTimeoutMs: number;
  private readonly pools = new Map<AniListMediaType, CandidatePool>();
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

  /** Accepts feedback for a feed saved in an earlier session, as if it had just been loaded. */
  adopt(feed: DiscoveryFeed): void {
    const owner = this.deps.owner();
    if (!feed.requestId || !owner) return;
    this.requests.set(feed.requestId, {
      owner,
      items: [...feed.items, ...(feed.rows ?? []).flatMap((row) => row.items)],
      expiresAt: this.now() + 60 * 60_000,
    });
    if (this.requests.size > 32) this.requests.delete(this.requests.keys().next().value!);
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

  /**
   * The viewer's AniList taste as ranker history from cached features only (no provider
   * requests), used as the cross-section prior for More.
   */
  tasteHistory(): HybridHistoryItem[] {
    const owner = this.deps.owner();
    const now = this.now();
    const dashboard = this.deps.dashboard();
    const evidence = discoveryEvidence(
      this.deps.activity(),
      dashboard?.profile.id === owner ? dashboard : undefined,
    );
    const features = new Map(
      this.deps.store
        .features(evidence.history.map((row) => row.anilistId))
        .map((row) => [row.anilistId, row]),
    );
    for (const media of evidence.historyMedia)
      if (!features.has(media.id)) features.set(media.id, recommendationFeatures(media, now));
    return evidence.history.flatMap((row) => {
      const item = features.get(row.anilistId);
      return item ? [{ features: item, affinity: row.affinity, occurredAt: row.occurredAt }] : [];
    });
  }

  /** AniList titles the viewer has started (any list status but Planning, or local progress). */
  watchedAniList(): Set<number> {
    const owner = this.deps.owner();
    const dashboard = this.deps.dashboard();
    return discoveryEvidence(
      this.deps.activity(),
      dashboard?.profile.id === owner ? dashboard : undefined,
    ).watched;
  }

  /** Distinct titles of one type with real progress (the hero personalizes from three). */
  private sectionTitles(type: AniListMediaType, owner: number): number {
    const dashboard = this.deps.dashboard();
    const evidence = discoveryEvidence(
      this.deps.activity(),
      dashboard?.profile.id === owner ? dashboard : undefined,
    );
    return new Set(
      evidence.events.filter((row) => row.mediaType === type).map((row) => row.anilistId),
    ).size;
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
      const feed = await this.loadWithinDeadline(type, owner, controller.signal);
      return { ...feed, sectionTitles: this.sectionTitles(type, owner) };
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
    if (new Set(evidence.events.map((row) => row.anilistId)).size < MIN_TITLES)
      return {
        status: "learning",
        items: [],
        message:
          "Watch or read three titles to shape your recommendations. Opening a title alone does not count.",
      };
    const feedback = this.deps.store.events(owner);
    const dismissed = new Set(
      feedback.filter((row) => row.eventType === "dismissed").map((row) => row.anilistId),
    );
    // Title-page choices: "Not interested" behaves like a dismissal, "Interested" like a liked
    // title (it seeds rows and never comes back as a recommendation).
    for (const choice of this.deps.feedback?.() ?? []) {
      if (choice.type !== "ANIME" && choice.type !== "MANGA") continue;
      if (choice.value === "not-interested") {
        if (choice.type === type) dismissed.add(choice.id);
        continue;
      }
      evidence.excluded.add(choice.id);
      const known = evidence.history.find((row) => row.anilistId === choice.id);
      if (known) known.affinity = Math.max(known.affinity, INTERESTED_AFFINITY);
      else
        evidence.history.push({
          anilistId: choice.id,
          mediaType: choice.type,
          affinity: INTERESTED_AFFINITY,
          occurredAt: choice.updatedAt,
        });
    }
    const features = new Map(
      this.deps.store
        .features([...evidence.history.map((row) => row.anilistId), ...dismissed])
        .map((row) => [row.anilistId, row]),
    );
    for (const media of evidence.historyMedia)
      if (!features.has(media.id)) features.set(media.id, recommendationFeatures(media, now));

    // Hydrate the strongest liked titles lacking fresh recommendation edges, one bounded page per
    // load; later refreshes continue down the list, so the cache converges without bursts.
    const missing = evidence.history
      .filter((row) => row.affinity > 0)
      .map((row) => ({
        id: row.anilistId,
        weight:
          row.affinity *
          Math.pow(0.5, Math.max(0, now - row.occurredAt) / HALF_LIFE_MS) *
          (row.mediaType === type ? 1 : HYBRID_WEIGHTS.crossTypePrior),
      }))
      .sort((a, b) => b.weight - a.weight || a.id - b.id)
      .slice(0, MAX_SEEDS)
      .filter(({ id }) => {
        const row = features.get(id);
        return !row?.recommendations || !row.relations || row.updatedAt < now - SEED_TTL_MS;
      })
      .map(({ id }) => id)
      .slice(0, SEED_PAGE_SIZE);
    let message: string | undefined;
    if (missing.length) {
      try {
        const hydrated = await this.deps.seeds(missing, signal);
        this.assertOwner(owner);
        for (const row of hydrated.neighbors)
          if (!features.get(row.anilistId)?.recommendations) features.set(row.anilistId, row);
        for (const row of hydrated.seeds) features.set(row.anilistId, row);
        this.deps.store.saveFeatures([...hydrated.neighbors, ...hydrated.seeds]);
      } catch (reason) {
        this.assertOwner(owner);
        // Degrade to cached edges and trending candidates instead of failing the whole rail.
        message = providerMessage(reason, "AniList history metadata could not be checked.");
      }
    }
    this.assertOwner(owner);

    const history: HybridHistoryItem[] = [
      ...evidence.history.flatMap((row) => {
        const item = features.get(row.anilistId);
        return item && !dismissed.has(row.anilistId)
          ? [{ features: item, affinity: row.affinity, occurredAt: row.occurredAt }]
          : [];
      }),
      ...[...dismissed].flatMap((id) => {
        const item = features.get(id);
        const occurredAt = feedback.find((row) => row.anilistId === id)?.occurredAt ?? now;
        return item ? [{ features: item, affinity: -1, occurredAt }] : [];
      }),
    ];
    let pool = this.pools.get(type);
    // After a failed seed request the shared transport is cooling down; never fan out further.
    if (message) pool ??= { items: [], expiresAt: 0 };
    else if (!pool || pool.expiresAt <= now) {
      // Trending covers titles too new for recommendation edges. Genre pages added no measured
      // recall over graph neighbors (2026-10-04 harness) and surfaced unwatched later seasons.
      try {
        const items = await this.deps.trending(type, signal);
        this.assertOwner(owner);
        pool = { items, expiresAt: now + 10 * 60_000 };
      } catch (reason) {
        this.assertOwner(owner);
        pool = {
          items: pool?.items ?? [],
          expiresAt: now + 60_000,
          message: providerMessage(
            reason,
            "AniList recommendation check failed. Available results may be incomplete or out of date.",
          ),
        };
      }
      this.pools.set(type, pool);
    }
    this.assertOwner(owner);
    this.deps.store.saveFeatures(pool.items.filter((row) => !features.has(row.anilistId)));
    message ??= pool.message;

    // Graph neighbors come from the local feature cache: no extra provider requests.
    const neighborIds = new Set<number>();
    for (const item of history)
      if (item.affinity > 0)
        for (const edge of item.features.recommendations ?? [])
          if (edge.mediaType === type) neighborIds.add(edge.id);
    const known = new Map(features);
    for (const row of this.deps.store.features([...neighborIds].filter((id) => !known.has(id))))
      known.set(row.anilistId, row);
    const links = this.deps.links?.();
    const watchedMore = this.deps.watchedMore?.() ?? new Set<string>();
    const watchedInMore = (row: RecommendationItemFeatures): boolean =>
      Boolean(links) &&
      row.mediaType === "ANIME" &&
      links!.tmdbKeysFor(row.anilistId).some((key) => watchedMore.has(key));
    const eligible = eligibilityFilter(
      history.map((row) => row.features),
      evidence.watched,
    );
    const hidden = new Set(
      (this.deps.hiddenTags?.() ?? []).map((name) => name.toLocaleLowerCase()),
    );
    const allowed = (row: RecommendationItemFeatures): boolean =>
      row.mediaType === type &&
      !row.isAdult &&
      !evidence.excluded.has(row.anilistId) &&
      !dismissed.has(row.anilistId) &&
      !watchedInMore(row) &&
      !isHidden(row, hidden);
    // "In-network" source: released sequels of titles the viewer liked (and has not started).
    const continuationIds = new Set<number>();
    for (const item of history)
      if (item.affinity >= 0.5 && item.features.mediaType === type)
        for (const relation of item.features.relations ?? [])
          if (
            relation.relationType === "SEQUEL" &&
            relation.mediaType === type &&
            !evidence.watched.has(relation.id)
          )
            continuationIds.add(relation.id);
    // Taste retrieval over the local cache: candidates no graph edge or trending list reached.
    const retrieved = tasteRetrieval(
      history,
      this.deps.store.cachedFeatures(RETRIEVAL_CORPUS).filter(allowed),
      RETRIEVAL_LIMIT,
    );
    const raw = [
      ...[...neighborIds].flatMap((id) => known.get(id) ?? []),
      ...pool.items,
      ...retrieved,
    ];
    const continuationRows = () =>
      [...continuationIds].flatMap((id) => {
        const row = known.get(id);
        return row && row.status !== "NOT_YET_RELEASED" ? [row] : [];
      });
    // A later season whose prequel was never started is recommended as its first season instead
    // (release order, exact AniList relations only), inheriting its "similar to" links.
    const gather = () => {
      const candidates = new Map<number, RecommendationItemFeatures>();
      const redirects = new Map<number, number>();
      const missing = new Set<number>(
        [...continuationIds].filter((id) => !known.has(id)).slice(0, 8),
      );
      for (const row of [...raw, ...continuationRows()]) {
        if (!allowed(row) || candidates.has(row.anilistId)) continue;
        if (eligible(row)) {
          candidates.set(row.anilistId, row);
          continue;
        }
        const start = firstSeason(row, (id) => known.get(id), evidence.watched);
        if (start && "missing" in start) missing.add(start.missing);
        else if (
          start &&
          allowed(start.entry) &&
          !candidates.has(start.entry.anilistId) &&
          eligible(start.entry, start.storyPrequels)
        ) {
          if (start.entry !== row) redirects.set(row.anilistId, start.entry.anilistId);
          candidates.set(start.entry.anilistId, start.entry);
        } else if (
          start &&
          "entry" in start &&
          start.entry !== row &&
          candidates.has(start.entry.anilistId)
        )
          redirects.set(row.anilistId, start.entry.anilistId);
      }
      return { candidates, redirects, missing };
    };
    let gathered = gather();
    // Earlier seasons not cached yet: one bounded lookup, cached for later loads.
    if (gathered.missing.size && !message) {
      try {
        const hydrated = await this.deps.seeds(
          [...gathered.missing].slice(0, SEED_PAGE_SIZE),
          signal,
        );
        this.assertOwner(owner);
        for (const row of hydrated.seeds) known.set(row.anilistId, row);
        this.deps.store.saveFeatures([...hydrated.neighbors, ...hydrated.seeds]);
        gathered = gather();
      } catch {
        this.assertOwner(owner);
        // Without them those sequels simply stay out, as before.
      }
    }
    const { candidates } = gathered;
    const ranked = redirectEdges(history, gathered.redirects);
    const continuation = new Set(
      continuationRows()
        .filter((row) => candidates.has(row.anilistId))
        .map((row) => itemKey(row)),
    );
    const ignored = new Map(
      [...this.deps.store.ignoredDays(owner, now - IGNORED_WINDOW_MS)].map(([id, days]) => [
        `${type}:${id}`,
        days,
      ]),
    );
    const scored = adjustScores(
      rankHybrid({
        section: type,
        history: ranked,
        candidates: [...candidates.values()],
        now,
      }),
      { now, ignored, continuation },
    );
    // With enough of them, next seasons keep their own row instead of flickering into the rail.
    const ownRow = continuation.size >= CONTINUATION_ROW_MIN;
    const items = selectHybrid(
      ownRow ? scored.filter((row) => !continuation.has(itemKey(row.features))) : scored,
      ranked,
      10,
      { calibrate: CALIBRATION },
    );
    const shown = new Set(items.map((row) => row.anilistId));
    // Released next seasons of liked shows get their own row (when the main rail left some).
    const nextUp = continuationPicks(
      scored,
      ranked,
      continuation,
      new Set([...shown].map((id) => `${type}:${id}`)),
      10,
    );
    const continuationRow =
      nextUp.length >= CONTINUATION_ROW_MIN
        ? {
            seedId: 0,
            seedTitle: "",
            continuation: true,
            items: toAniListResults(nextUp),
          }
        : undefined;
    for (const pick of nextUp) shown.add(pick.features.anilistId);
    const seedRows = buildSeedRows(scored, ranked, type, shown);
    for (const row of seedRows) for (const item of row.items) shown.add(item.anilistId);
    const themeRow = buildThemeRow(scored, ranked, type, shown);
    // Strongest row first, so the best match is the first thing the viewer sees.
    const rows = [
      // The continuation row leads: the most dependable picks (X's in-network source).
      ...(continuationRow ? [continuationRow] : []),
      ...(themeRow ? [...seedRows, themeRow] : seedRows)
        .map((row) => ({ row, strength: rowStrength(row.items) }))
        .sort((a, b) => b.strength - a.strength)
        .map(({ row }) => row),
    ];
    const requestId = randomUUID();
    for (const [id, request] of this.requests)
      if (request.expiresAt <= now || request.owner !== owner) this.requests.delete(id);
    this.requests.set(requestId, {
      owner,
      items: [...items, ...rows.flatMap((row) => row.items)],
      expiresAt: now + 60 * 60_000,
    });
    if (this.requests.size > 32) this.requests.delete(this.requests.keys().next().value!);
    return {
      status: message && !items.length ? "unavailable" : "ready",
      items,
      rows,
      requestId,
      message,
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
