import { randomUUID } from "node:crypto";
import type { MoreCatalogItem, MoreMediaType } from "../../shared/contracts";
import type {
  MoreDiscoveryFeed,
  MoreDiscoveryFeedback,
  MoreRecommendation,
} from "../../shared/discovery";
import {
  HYBRID_WEIGHTS,
  type RecommendationEdge,
  type RecommendationItemFeatures,
} from "../../shared/recommendations";
import type { AnimeTmdbLinkIndex } from "../anime-tmdb-links";
import type { MoreHistoryEntry } from "../more-library";
import type { TitleFeedbackRow } from "./personalization-store";
import type { MoreRecommendationSeed } from "../tmdb";
import {
  itemKey,
  pickHybrid,
  rankHybrid,
  seedRowsHybrid,
  rankThemes,
  rowStrength,
  themeRowHybrid,
  type HybridHistoryItem,
  type HybridPick,
} from "./hybrid";
import type { MoreDiscoveryStore } from "./more-discovery-store";

interface Dependencies {
  store: MoreDiscoveryStore;
  history(): MoreHistoryEntry[];
  /** Cached AniList taste (no requests); the cross-section prior. */
  aniListTaste(): HybridHistoryItem[];
  seed(id: number, type: MoreMediaType, signal?: AbortSignal): Promise<MoreRecommendationSeed>;
  trending(type: MoreMediaType, signal?: AbortSignal): Promise<RecommendationItemFeatures[]>;
  /** Well-known titles in one original language; candidates for viewers of that language. */
  byLanguage?: (type: MoreMediaType, language: string) => Promise<RecommendationItemFeatures[]>;
  /** Well-known titles carrying one TMDB keyword, tagged with it (theme rows). */
  byKeyword?: (
    type: MoreMediaType,
    keyword: { id: number; name: string },
  ) => Promise<RecommendationItemFeatures[]>;
  /** Title-page "Interested" / "Not interested" choices (all sections; More reads MOVIE/TV). */
  feedback?: () => TitleFeedbackRow[];
  /** Simkl co-watched neighbours of one of the viewer's titles, from cache (no requests). */
  collaborative?: (ref: {
    type: MoreMediaType;
    tmdbId: number;
  }) => { edges: RecommendationEdge[]; features: RecommendationItemFeatures[] } | undefined;
  /** Fetches more Simkl co-watched neighbours in the background. */
  warmCollaborative?: (refs: Array<{ type: MoreMediaType; tmdbId: number }>) => Promise<void>;
  /** "Learn from my activity": playback behaviour beyond explicit choices counts. */
  activitySignals?: () => boolean;
  /** Exact AniList ↔ TMDB links; absent means no cross-section identity. */
  links?: () => AnimeTmdbLinkIndex;
  /** AniList titles the viewer has started; their TMDB entries stay out of More. */
  watchedAniList?: () => ReadonlySet<number>;
  now?: () => number;
  providerTimeoutMs?: number;
}

const PROVIDER_DEADLINE_MS = 12_000;
/** TMDB has one request per seed; keep each load small and let the cache converge. */
const SEEDS_PER_LOAD = 4;
/** Extra seeds fetched in the background after a load, so themes cover more of the history. */
const BACKGROUND_SEEDS = 6;
const MAX_SEEDS = 60;
/** Same-language pools (movies and shows each) for this many languages from the history. */
const MAX_LANGUAGES = 2;
const LANGUAGE_POOL_TTL_MS = 24 * 60 * 60_000;
/** Keyword lookups per load for the theme row, movies and shows each (each cached a day). */
const MAX_THEME_FETCHES = 4;
/** For You and "Because you watched" mix movies and shows (user request 2026-10-08). */
const MIN_PER_TYPE = 3;
const CROSS_TYPE_PER_ROW = 3;
/** Unseen titles a theme needs so the rail and the row can both take some. */
const THEME_POOL_TARGET = 12;
const SEED_TTL_MS = 7 * 86_400_000;
const MIN_MORE_TITLES = 2;
/** Progress that shows real interest rather than a player check. */
const STARTED_RATIO = 0.25;
/** Netflix counts a view after two minutes, "enough time to show intentional choice". */
const INTENTIONAL_START_SECONDS = 120;
const INTENTIONAL_START_AFFINITY = 0.15;
const ABANDONED_AFTER_MS = 14 * 86_400_000;
const ABANDONED_AFFINITY = -0.3;
const INTERESTED_AFFINITY = 0.5;

/**
 * For You on More: TMDB recommendation edges and content from the viewer's More history, with
 * AniList taste as a weaker prior. While More history is too thin, it ranks trending titles by
 * that AniList taste alone and says so.
 */
export class MoreDiscoveryService {
  private readonly now: () => number;
  private pending?: Promise<MoreDiscoveryFeed>;
  private trendingPool?: { items: RecommendationItemFeatures[]; expiresAt: number };
  private readonly languagePools = new Map<
    string,
    { items: RecommendationItemFeatures[]; expiresAt: number }
  >();
  private warming?: Promise<void>;
  private readonly requests = new Map<string, { keys: Set<string>; expiresAt: number }>();

  constructor(private readonly deps: Dependencies) {
    this.now = deps.now ?? Date.now;
  }

  getForYou(): Promise<MoreDiscoveryFeed> {
    this.pending ??= this.load().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  feedback(input: MoreDiscoveryFeedback): void {
    const request = this.requests.get(input.requestId);
    if (!request || request.expiresAt <= this.now())
      throw new Error("Recommendations expired. Refresh For You.");
    if (!request.keys.has(`${input.type}:${input.tmdbId}`))
      throw new Error("This recommendation is no longer available. Refresh For You.");
    this.deps.store.setDismissed(input.type, input.tmdbId, input.action === "dismiss", this.now());
  }

  /**
   * Fetches a few more history titles after a load, one at a time through the TMDB gate, so the
   * taste profile and themes cover more than the handful each visible load refreshes. Stops at the
   * first failure; never runs twice at once.
   */
  private warm(entries: MoreHistoryEntry[]): Promise<void> {
    this.warming ??= (async () => {
      for (const entry of entries) {
        try {
          const hydrated = await this.deps.seed(entry.tmdbId, entry.type);
          this.deps.store.saveFeatures([...hydrated.neighbors, hydrated.seed]);
        } catch {
          return;
        }
      }
    })().finally(() => {
      this.warming = undefined;
    });
    return this.warming;
  }

  private async load(): Promise<MoreDiscoveryFeed> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new DOMException("Recommendation request timed out.", "TimeoutError")),
      this.deps.providerTimeoutMs ?? PROVIDER_DEADLINE_MS,
    );
    try {
      const feed = await this.loadWithinDeadline(controller.signal);
      return { ...feed, sectionTitles: moreWatchedTitles(this.deps.history()) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async loadWithinDeadline(signal: AbortSignal): Promise<MoreDiscoveryFeed> {
    const now = this.now();
    const activity = this.deps.activitySignals?.() ?? true;
    const choices = new Map(
      (this.deps.feedback?.() ?? [])
        .filter((row) => row.type === "MOVIE" || row.type === "TV")
        .map((row) => [`${row.type}:${row.id}`, row]),
    );
    const recorded = this.deps.history().map((entry) => {
      const choice = choices.get(`${entry.type}:${entry.tmdbId}`);
      return choice
        ? { ...entry, feedback: choice.value === "interested" ? (1 as const) : (-1 as const) }
        : entry;
    });
    const recordedKeys = new Set(recorded.map((entry) => `${entry.type}:${entry.tmdbId}`));
    // Titles marked on their page without any watching become history of their own.
    const watched: MoreHistoryEntry[] = [
      ...recorded,
      ...[...choices.values()]
        .filter((row) => !recordedKeys.has(`${row.type}:${row.id}`))
        .map((row) => ({
          type: row.type as MoreMediaType,
          tmdbId: row.id,
          watchlisted: false,
          maxRatio: 0,
          finishedEpisodes: 0,
          updatedAt: new Date(row.updatedAt).toISOString(),
          feedback: row.value === "interested" ? (1 as const) : (-1 as const),
        })),
    ];
    const ratings = watched.flatMap((entry) => (entry.rating ? [entry.rating] : []));
    const meanRating = ratings.length
      ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
      : undefined;
    const affinities = watched.map((entry) => ({
      entry,
      affinity: moreAffinity(entry, meanRating, { now, activity }),
    }));
    const evidence = affinities.filter(({ affinity }) => affinity > 0);
    // Disliked titles push the taste profile away when their features are already cached.
    const disliked = affinities.filter(({ affinity }) => affinity < 0);
    const dismissed = this.deps.store.dismissed();
    const excluded = new Set([
      ...watched.map((entry) => `${entry.type}:${entry.tmdbId}`),
      ...dismissed.map((row) => `${row.type}:${row.tmdbId}`),
    ]);
    const aniListTaste = this.deps.aniListTaste();
    const personal = evidence.length >= MIN_MORE_TITLES;
    if (!personal && !aniListTaste.some((row) => row.affinity > 0))
      return {
        status: "learning",
        items: [],
        message:
          "Watch a few movies or shows past the first quarter, add them to My Watch List, or connect Simkl in Settings to shape these picks.",
      };

    const features = new Map(
      this.deps.store
        .features([
          ...evidence.map(({ entry }) => `${entry.type}:${entry.tmdbId}`),
          ...disliked.map(({ entry }) => `${entry.type}:${entry.tmdbId}`),
          ...dismissed.map((row) => `${row.type}:${row.tmdbId}`),
        ])
        .map((row) => [itemKey(row), row]),
    );
    let message: string | undefined;
    const halfLife = HYBRID_WEIGHTS.halfLifeDays * 86_400_000;
    const stale = evidence
      .map(({ entry, affinity }) => ({
        entry,
        weight: affinity * Math.pow(0.5, Math.max(0, now - Date.parse(entry.updatedAt)) / halfLife),
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_SEEDS)
      .filter(({ entry }) => {
        const row = features.get(`${entry.type}:${entry.tmdbId}`);
        // Seeds cached before origin was recorded refresh too, so their rows can follow it.
        return (
          !row?.recommendations || row.updatedAt < now - SEED_TTL_MS || row.origin === undefined
        );
      });
    const missing = stale.slice(0, SEEDS_PER_LOAD);
    const later = stale.slice(SEEDS_PER_LOAD, SEEDS_PER_LOAD + BACKGROUND_SEEDS);
    for (const { entry } of missing) {
      try {
        const hydrated = await this.deps.seed(entry.tmdbId, entry.type, signal);
        for (const row of hydrated.neighbors)
          if (!features.get(itemKey(row))?.recommendations) features.set(itemKey(row), row);
        features.set(itemKey(hydrated.seed), hydrated.seed);
        this.deps.store.saveFeatures([...hydrated.neighbors, hydrated.seed]);
      } catch (reason) {
        message = providerMessage(reason, "TMDB title details could not be checked.");
        break; // The TMDB gate owns cooldown; never fan out after a failure.
      }
    }

    if (!message && (!this.trendingPool || this.trendingPool.expiresAt <= now)) {
      try {
        const items: RecommendationItemFeatures[] = [];
        for (const type of ["MOVIE", "TV"] as const)
          items.push(...(await this.deps.trending(type, signal)));
        this.trendingPool = { items, expiresAt: now + 10 * 60_000 };
      } catch (reason) {
        message ??= providerMessage(
          reason,
          "TMDB trending titles could not be checked. Available results may be incomplete.",
        );
      }
    }
    const trending = this.trendingPool?.items ?? [];

    // Viewers of non-English titles get well-known movies and shows in those languages as
    // candidates (a Malayalam film fan also sees Malayalam series).
    const languages = new Map<string, number>();
    for (const { entry, affinity } of evidence) {
      const origin = features.get(`${entry.type}:${entry.tmdbId}`)?.origin;
      if (!origin || origin === "en") continue;
      languages.set(origin, (languages.get(origin) ?? 0) + affinity);
    }
    const languagePool: RecommendationItemFeatures[] = [];
    const languagePairs = [...languages]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_LANGUAGES)
      .flatMap(([language]) => (["MOVIE", "TV"] as const).map((type) => ({ type, language })));
    for (const { type, language } of languagePairs) {
      const key = `${type}:${language}`;
      let pool = this.languagePools.get(key);
      if ((!pool || pool.expiresAt <= now) && !message && this.deps.byLanguage) {
        try {
          pool = {
            items: await this.deps.byLanguage(type, language),
            expiresAt: now + LANGUAGE_POOL_TTL_MS,
          };
          this.languagePools.set(key, pool);
        } catch {
          // A missing language pool only narrows rows; trending and neighbors still rank.
        }
      }
      languagePool.push(...(pool?.items ?? []));
    }

    // Collaborative filtering: what viewers of each liked title also watched on Simkl joins
    // TMDB's own neighbours as graph edges (cache only; fetched in the background below).
    const collaborativeRefs: Array<{ type: MoreMediaType; tmdbId: number }> = [];
    for (const { entry } of evidence) {
      collaborativeRefs.push({ type: entry.type, tmdbId: entry.tmdbId });
      const key = `${entry.type}:${entry.tmdbId}`;
      const seedFeatures = features.get(key);
      const shared = seedFeatures ? this.deps.collaborative?.(entry) : undefined;
      if (!seedFeatures || !shared?.edges.length) continue;
      const seen = new Set(
        (seedFeatures.recommendations ?? []).map((edge) => `${edge.mediaType}:${edge.id}`),
      );
      features.set(key, {
        ...seedFeatures,
        recommendations: [
          ...shared.edges.filter((edge) => !seen.has(`${edge.mediaType}:${edge.id}`)),
          ...(seedFeatures.recommendations ?? []),
        ],
      });
      for (const row of shared.features)
        if (!features.has(itemKey(row))) features.set(itemKey(row), row);
    }
    if (activity && !message && collaborativeRefs.length)
      void this.deps.warmCollaborative?.(collaborativeRefs.slice(0, 12));

    const moreHistory: HybridHistoryItem[] = [
      ...[...evidence, ...disliked].flatMap(({ entry, affinity }) => {
        const item = features.get(`${entry.type}:${entry.tmdbId}`);
        return item ? [{ features: item, affinity, occurredAt: Date.parse(entry.updatedAt) }] : [];
      }),
      ...dismissed.flatMap((row) => {
        const item = features.get(`${row.type}:${row.tmdbId}`);
        return item ? [{ features: item, affinity: -1, occurredAt: row.updatedAt }] : [];
      }),
    ];
    const history = [...moreHistory, ...aniListTaste];

    // Theme row: choose this load's themes now and fetch titles for the first one, since TMDB list
    // rows carry no keywords that could match a theme otherwise.
    const themes = personal ? rankThemes(moreHistory, "MORE") : [];
    const themePool: RecommendationItemFeatures[] = [];
    // A theme whose best-known titles the viewer has mostly seen gives way to the next one.
    // TMDB keywords are shared by movies and shows, so each theme brings both.
    let themeFetches = 0;
    let stop = false;
    for (const theme of themes) {
      if (stop || theme.id === undefined || message || !this.deps.byKeyword) break;
      const primary: MoreMediaType = theme.mediaType === "TV" ? "TV" : "MOVIE";
      let fresh = 0;
      for (const type of [primary, primary === "TV" ? "MOVIE" : "TV"] as const) {
        const key = `keyword:${type}:${theme.id}`;
        let pool = this.languagePools.get(key);
        if (!pool || pool.expiresAt <= now) {
          if (themeFetches >= MAX_THEME_FETCHES) {
            stop = true;
            break;
          }
          themeFetches += 1;
          try {
            pool = {
              items: await this.deps.byKeyword(type, { id: theme.id, name: theme.name }),
              expiresAt: now + LANGUAGE_POOL_TTL_MS,
            };
            this.languagePools.set(key, pool);
          } catch {
            stop = true;
            break;
          }
        }
        const unseen = pool.items.filter((row) => !excluded.has(itemKey(row)));
        themePool.push(...unseen);
        fresh += unseen.length;
      }
      if (fresh >= THEME_POOL_TARGET) break;
    }

    const neighborKeys = new Set<string>();
    for (const item of moreHistory)
      if (item.affinity > 0)
        for (const edge of item.features.recommendations ?? [])
          neighborKeys.add(`${edge.mediaType}:${edge.id}`);
    const known = new Map(features);
    for (const row of this.deps.store.features([...neighborKeys].filter((key) => !known.has(key))))
      known.set(itemKey(row), row);
    // The same work watched in the Anime section is hidden here (exact Wikidata links only).
    const links = this.deps.links?.();
    const watchedAniList = this.deps.watchedAniList?.() ?? new Set<number>();
    const watchedAsAnime = (row: RecommendationItemFeatures): boolean =>
      Boolean(links) &&
      links!
        .aniListIdsFor(row.mediaType as MoreMediaType, row.anilistId)
        .some((id) => watchedAniList.has(id));
    const candidates = new Map<string, RecommendationItemFeatures>();
    for (const row of [
      ...[...neighborKeys].flatMap((key) => known.get(key) ?? []),
      ...trending,
      ...languagePool,
      ...themePool,
    ]) {
      const key = itemKey(row);
      if (!row.isAdult && !excluded.has(key) && !candidates.has(key) && !watchedAsAnime(row))
        candidates.set(key, row);
    }
    this.deps.store.saveFeatures(trending.filter((row) => !known.has(itemKey(row))));

    const scored = rankHybrid({
      section: "MORE",
      history,
      candidates: [...candidates.values()],
      now,
    });
    const picks = pickHybrid(scored, history, 10, { minPerType: MIN_PER_TYPE });
    const shown = new Set(picks.map((pick) => itemKey(pick.features)));
    const rows = personal
      ? seedRowsHybrid(scored, history, "MORE", shown, { crossType: CROSS_TYPE_PER_ROW })
      : [];
    for (const row of rows) for (const pick of row.items) shown.add(itemKey(pick.features));
    const themeRow = personal
      ? themeRowHybrid(scored, history, "MORE", shown, { themes })
      : undefined;
    if (!message && later.length) void this.warm(later.map(({ entry }) => entry));
    const items = picks.map(toRecommendation);
    const requestId = randomUUID();
    for (const [id, request] of this.requests)
      if (request.expiresAt <= now) this.requests.delete(id);
    this.requests.set(requestId, {
      keys: new Set([
        ...picks.map((pick) => itemKey(pick.features)),
        ...rows.flatMap((row) => row.items.map((pick) => itemKey(pick.features))),
        ...(themeRow?.items ?? []).map((pick) => itemKey(pick.features)),
      ]),
      expiresAt: now + 60 * 60_000,
    });
    if (this.requests.size > 16) this.requests.delete(this.requests.keys().next().value!);
    return {
      status: message && !items.length ? "unavailable" : "ready",
      basis: personal ? "more" : "anime-taste",
      items,
      // Strongest row first: the viewer should find something within seconds, not after scrolling.
      rows: [
        ...rows.map((row) => ({
          strength: rowStrength(row.items),
          row: {
            seedTitle: row.seed.normalizedTitle,
            seedType: row.seed.mediaType as MoreMediaType,
            seedId: row.seed.anilistId,
            items: row.items.map(toRecommendation),
          },
        })),
        ...(themeRow
          ? [
              {
                strength: rowStrength(themeRow.items),
                row: {
                  seedTitle: themeRow.theme,
                  seedType: "MOVIE" as const,
                  seedId: 0,
                  theme: themeRow.theme,
                  items: themeRow.items.map(toRecommendation),
                },
              },
            ]
          : []),
      ]
        .sort((a, b) => b.strength - a.strength)
        .map(({ row }) => row),
      requestId,
      message:
        message ??
        (personal
          ? undefined
          : "Picked from your anime and manga taste. Watch a few movies or shows, or connect Simkl in Settings, to personalize these further."),
    };
  }
}

/**
 * Evidence weight of one More title in [-1, 1]; 0 says nothing about taste yet. A tracker rating
 * is read relative to the viewer's mean rating, exactly like AniList scores; a dropped title
 * counts against its features, and a paused one is neutral.
 */
export function moreAffinity(
  entry: MoreHistoryEntry,
  meanRating = 7,
  options: { now?: number; activity?: boolean } = {},
): number {
  // "Not interested" on the title page is the clearest no; "Interested" is a modest yes.
  if (entry.feedback === -1) return -1;
  const value = moreAffinityFromWatching(entry, meanRating, options);
  return entry.feedback === 1 ? Math.max(value, INTERESTED_AFFINITY) : value;
}

function moreAffinityFromWatching(
  entry: MoreHistoryEntry,
  meanRating: number,
  { now = Date.now(), activity = true }: { now?: number; activity?: boolean },
): number {
  const dropped = entry.trackerStatus === "dropped";
  if (entry.rating !== undefined && entry.rating > 0) {
    const value = Math.max(-1, Math.min(1, (entry.rating - (meanRating - 1)) / 3));
    return dropped ? Math.min(value, -0.3) : value;
  }
  if (dropped) return -0.6;
  if (entry.trackerStatus === "paused") return 0;
  if (entry.trackerStatus === "completed") return 0.6;
  // Playback behaviour, only while "learn from my activity" is on: a movie left between 10% and
  // 70% and untouched for two weeks reads as abandoned; two minutes is an intentional start.
  if (
    activity &&
    entry.type === "MOVIE" &&
    !entry.trackerStatus &&
    entry.finishedEpisodes === 0 &&
    entry.maxRatio >= 0.1 &&
    entry.maxRatio < 0.7 &&
    now - Date.parse(entry.updatedAt) >= ABANDONED_AFTER_MS
  )
    return ABANDONED_AFFINITY;
  if (entry.type === "MOVIE" && entry.finishedEpisodes > 0) return 0.6;
  if (entry.type === "TV" && entry.finishedEpisodes >= 2) return 0.6;
  if (entry.finishedEpisodes > 0 || entry.maxRatio >= STARTED_RATIO) return 0.35;
  if (entry.watchlisted) return 0.25;
  return activity && (entry.maxPositionSeconds ?? 0) >= INTENTIONAL_START_SECONDS
    ? INTENTIONAL_START_AFFINITY
    : 0;
}

function toRecommendation(pick: HybridPick): MoreRecommendation {
  const { features } = pick;
  const type = features.mediaType as MoreMediaType;
  const item: MoreCatalogItem = {
    id: features.anilistId,
    type,
    title: features.normalizedTitle,
    posterUrl: features.coverUrl,
    backdropUrl: features.backdropUrl,
    releaseDate: features.releaseDate,
    year: features.releaseDate ? Number(features.releaseDate.slice(0, 4)) : undefined,
    score: features.averageScore === undefined ? undefined : features.averageScore / 10,
    genres: features.genres,
    siteUrl: `https://www.themoviedb.org/${type === "MOVIE" ? "movie" : "tv"}/${features.anilistId}`,
  };
  const moreSeed =
    pick.seed && (pick.seed.mediaType === "MOVIE" || pick.seed.mediaType === "TV")
      ? pick.seed
      : undefined;
  return {
    item,
    // An AniList seed cannot name a More "because you watched" title.
    reasonCodes: moreSeed
      ? pick.reasonCodes
      : pick.reasonCodes.filter((code) => code !== "similar-to"),
    relatedTitle: moreSeed?.normalizedTitle,
  };
}

function providerMessage(reason: unknown, fallback: string): string {
  const raw = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? "");
  if (/not configured|ANISTREAM_TMDB_ACCESS_TOKEN/i.test(raw))
    return "TMDB is not configured, so More recommendations are unavailable.";
  if (/timeout|aborterror/i.test(raw))
    return "TMDB recommendations are taking longer than expected. Try again in a moment.";
  if (/\b429\b|\b403\b|temporarily refused|rate.?limit/i.test(raw))
    return "TMDB is busy right now. Try recommendations again in a few minutes.";
  if (/failed to fetch|network|offline|enotfound|econn|dns/i.test(raw))
    return "TMDB could not be reached. Check your connection and try again.";
  return fallback;
}

/** Movies and shows actually watched: finished, marked completed, or past the first quarter. */
export function moreWatchedTitles(history: MoreHistoryEntry[]): number {
  return new Set(
    history
      .filter(
        (entry) =>
          entry.finishedEpisodes > 0 ||
          entry.maxRatio >= 0.25 ||
          entry.trackerStatus === "completed",
      )
      .map((entry) => `${entry.type}:${entry.tmdbId}`),
  ).size;
}
