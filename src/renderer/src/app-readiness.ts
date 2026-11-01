import {
  createLaunchCatalogReadinessStage,
  createReadinessSession,
  type ReadinessSession,
  type ReadinessSnapshot,
  type ReadinessStageResult,
} from "./startup-readiness";
import type { ViewerSessionModule } from "./viewer-session";

/** What the readiness hook reads while no readiness screen is showing. */
export const inactiveReadinessSnapshot: ReadinessSnapshot = {
  attempt: 0,
  mode: "launch",
  progress: 100,
  activeLabel: "AniStream is ready",
  steps: [],
  outcome: "ready",
  canContinue: false,
};
export const subscribeToInactiveReadiness = (): (() => void) => () => undefined;
export const getInactiveReadinessSnapshot = (): ReadinessSnapshot => inactiveReadinessSnapshot;

/** The launch screen: local data, the saved session, the catalog, then anime playback. */
export function createLaunchReadiness(viewerSession: ViewerSessionModule): ReadinessSession {
  return createReadinessSession({
    mode: "launch",
    stages: [
      {
        id: "local",
        label: "Opening local data",
        shortLabel: "Local data",
        weight: 15,
        required: true,
        failureOutcome: "local-error",
        run: async () => {
          const app = await window.anistream.getAppInfo();
          if (!app.databaseReady) {
            return { status: "local-error" } satisfies ReadinessStageResult;
          }
        },
      },
      {
        id: "session",
        label: "Restoring your saved session",
        shortLabel: "Session",
        weight: 25,
        required: false,
        provider: "AniList",
        failureOutcome: "degraded",
        run: async () => {
          await viewerSession.restore();
          if (viewerSession.getSnapshot().error) {
            return {
              status: "degraded",
              provider: "AniList",
              canContinue: true,
            } satisfies ReadinessStageResult;
          }
        },
      },
      createLaunchCatalogReadinessStage(async () => {
        await window.anistream.browseAniList({
          type: "ANIME",
          page: 1,
          perPage: 20,
          sort: "TRENDING_DESC",
        });
      }),
      {
        id: "playback",
        label: "Checking anime playback availability",
        shortLabel: "Anime player",
        weight: 20,
        required: false,
        provider: "The anime player",
        failureOutcome: "degraded",
        run: async () =>
          normalizePlaybackReadiness(await window.anistream.getAnimeProviderReadiness()),
      },
    ],
  });
}

/**
 * The Profile screen's first load when nothing is saved yet: the account, the saved profile, then
 * the library. A saved copy skips this and opens at once (approved 2026-10-07).
 */
export function createProfileReadiness(viewerSession: ViewerSessionModule): ReadinessSession {
  return createReadinessSession({
    mode: "profile",
    stages: [
      {
        id: "account",
        label: "Checking your AniList account",
        shortLabel: "Account",
        weight: 30,
        required: true,
        provider: "AniList",
        failureOutcome: "provider-error",
        run: async () => {
          const current = viewerSession.getSnapshot();
          if (current.auth.status === "error") {
            return {
              status: "provider-error",
              provider: "AniList",
              canContinue: true,
            } satisfies ReadinessStageResult;
          }
        },
      },
      {
        id: "saved-profile",
        label: "Preparing your saved profile",
        shortLabel: "Saved profile",
        weight: 30,
        required: false,
        provider: "AniList",
        failureOutcome: "degraded",
        run: async () => {
          const current = viewerSession.getSnapshot();
          if (current.access.kind === "guest" || current.hasVerifiedDashboard) return;
          return {
            status: "disabled",
            message: "No saved profile data is available yet.",
          } satisfies ReadinessStageResult;
        },
      },
      {
        id: "library",
        label: "Updating your AniList library",
        shortLabel: "Library",
        weight: 40,
        required: true,
        provider: "AniList",
        failureOutcome: "provider-error",
        run: async () => {
          if (viewerSession.getSnapshot().access.kind === "guest") return;
          await viewerSession.refresh();
          const current = viewerSession.getSnapshot();
          if (!current.error) return;
          return {
            status: /connection|internet|could not reach/i.test(current.error)
              ? "offline"
              : "provider-error",
            provider: "AniList",
            canContinue: current.hasVerifiedDashboard,
          } satisfies ReadinessStageResult;
        },
      },
    ],
  });
}

export function normalizePlaybackReadiness(
  result: Awaited<ReturnType<typeof window.anistream.getAnimeProviderReadiness>>,
): void | ReadinessStageResult {
  if (result.status === "ready") return;
  if (result.status === "disabled") return { status: "disabled", message: result.message };
  if (result.status === "offline") return { status: "offline", provider: "The anime player" };
  if (result.status === "rate-limited") {
    return {
      status: "degraded",
      provider: "The anime player",
      message: "The anime player is busy right now. Please wait a few minutes, then try again.",
      canContinue: true,
    };
  }
  return { status: "degraded", provider: "The anime player", canContinue: true };
}
