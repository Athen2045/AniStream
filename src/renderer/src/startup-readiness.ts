export type ReadinessMode = "launch" | "profile";

export type ReadinessOutcome =
  "checking" | "ready" | "degraded" | "provider-error" | "offline" | "local-error";

export type ReadinessStepState = "pending" | "active" | "complete" | "failed" | "disabled";

export interface ReadinessStageResult {
  status: Exclude<ReadinessOutcome, "checking" | "ready"> | "ready" | "disabled";
  provider?: string;
  message?: string;
  canContinue?: boolean;
}

export interface ReadinessStage {
  id: string;
  label: string;
  weight: number;
  required: boolean;
  provider?: string;
  failureOutcome: Exclude<ReadinessOutcome, "checking" | "ready">;
  run(): Promise<void | ReadinessStageResult>;
}

export interface ReadinessStepSnapshot {
  id: string;
  label: string;
  weight: number;
  state: ReadinessStepState;
  message?: string;
}

export interface ReadinessSnapshot {
  attempt: number;
  mode: ReadinessMode;
  progress: number;
  activeLabel: string;
  steps: readonly ReadinessStepSnapshot[];
  outcome: ReadinessOutcome;
  message?: string;
  canContinue: boolean;
}

export interface ReadinessSession {
  start(): Promise<void>;
  retry(): Promise<void>;
  continueDegraded(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ReadinessSnapshot;
  dispose(): void;
}

/**
 * Public catalog data improves the first paint but must never prevent a guest
 * from opening the shell when AniList is unavailable.
 */
export function createLaunchCatalogReadinessStage(run: () => Promise<void>): ReadinessStage {
  return {
    id: "catalog",
    label: "Loading AniList trending titles",
    weight: 40,
    required: false,
    provider: "AniList",
    failureOutcome: "provider-error",
    run,
  };
}

interface MutableStep extends ReadinessStepSnapshot {
  definition: ReadinessStage;
  failureOutcome?: Exclude<ReadinessOutcome, "checking" | "ready">;
  canContinue?: boolean;
}

const OFFLINE_PATTERN = /failed to fetch|network|offline|enotfound|econn|dns|internet|socket/i;
const RATE_LIMIT_PATTERN =
  /\b429\b|rate.?limit|too many requests|temporarily busy|paused? (?:new )?requests/i;

function providerApology(provider: string): string {
  return `Sorry, AniStream can't reach ${provider} right now. We're working on the issue. Please try again later.`;
}

function safeFailureMessage(
  outcome: Exclude<ReadinessOutcome, "checking" | "ready">,
  provider: string | undefined,
  reason?: unknown,
): string {
  const raw = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? "");
  if (outcome === "offline" || OFFLINE_PATTERN.test(raw)) {
    return "AniStream could not reach the internet. Check your connection, then try again.";
  }
  if (RATE_LIMIT_PATTERN.test(raw)) {
    return `${provider ?? "The service"} is busy right now. Please wait a few minutes, then try again.`;
  }
  if (outcome === "local-error") {
    return "AniStream could not finish opening its local data. Restart the app and try again.";
  }
  return providerApology(provider ?? "the service");
}

function calculateOutcome(steps: readonly MutableStep[]): {
  outcome: ReadinessOutcome;
  message?: string;
  canContinue: boolean;
} {
  if (steps.some((step) => step.state === "active" || step.state === "pending")) {
    return { outcome: "checking", canContinue: false };
  }
  const failed = steps.filter((step) => step.state === "failed");
  if (failed.length === 0) return { outcome: "ready", canContinue: false };

  const priority: ReadonlyArray<Exclude<ReadinessOutcome, "checking" | "ready">> = [
    "offline",
    "local-error",
    "provider-error",
    "degraded",
  ];
  const chosen = priority.find((outcome) => failed.some((step) => step.failureOutcome === outcome));
  const outcome = chosen ?? "provider-error";
  const representative = failed.find((step) => step.failureOutcome === outcome) ?? failed[0]!;
  return {
    outcome,
    message: representative.message,
    canContinue:
      outcome === "degraded" ||
      failed.every((step) => step.canContinue === true || !step.definition.required),
  };
}

export function createReadinessSession({
  mode,
  stages,
}: {
  mode: ReadinessMode;
  stages: readonly ReadinessStage[];
}): ReadinessSession {
  const ids = new Set(stages.map((stage) => stage.id));
  if (ids.size !== stages.length) throw new Error("Readiness stage IDs must be unique.");
  if (stages.some((stage) => !Number.isInteger(stage.weight) || stage.weight <= 0)) {
    throw new Error("Readiness stage weights must be positive integers.");
  }
  if (stages.reduce((total, stage) => total + stage.weight, 0) !== 100) {
    throw new Error("Readiness stage weights must total 100.");
  }

  const listeners = new Set<() => void>();
  const steps: MutableStep[] = stages.map((definition) => ({
    definition,
    id: definition.id,
    label: definition.label,
    weight: definition.weight,
    state: "pending",
  }));
  let attempt = 0;
  let generation = 0;
  let disposed = false;
  let activeRun: Promise<void> | undefined;
  let snapshot: ReadinessSnapshot = buildSnapshot();

  function buildSnapshot(): ReadinessSnapshot {
    const result = calculateOutcome(steps);
    const active = steps.find((step) => step.state === "active");
    const progress = steps.reduce(
      (total, step) =>
        total + (step.state === "complete" || step.state === "disabled" ? step.weight : 0),
      0,
    );
    return {
      attempt,
      mode,
      progress,
      activeLabel:
        active?.label ??
        (result.outcome === "ready" ? "AniStream is ready" : "Readiness check needs attention"),
      steps: steps.map(({ id, label, weight, state, message }) => ({
        id,
        label,
        weight,
        state,
        message,
      })),
      ...result,
    };
  }

  function publish(): void {
    if (disposed) return;
    snapshot = buildSnapshot();
    listeners.forEach((listener) => listener());
  }

  function normalizeResult(step: MutableStep, result: void | ReadinessStageResult): void {
    if (!result || result.status === "ready") {
      step.state = "complete";
      return;
    }
    if (result.status === "disabled") {
      step.state = "disabled";
      step.message = result.message;
      return;
    }
    step.state = "failed";
    step.failureOutcome = result.status;
    step.canContinue = result.canContinue;
    step.message =
      result.message ??
      safeFailureMessage(result.status, result.provider ?? step.definition.provider);
  }

  function normalizeError(step: MutableStep, reason: unknown): void {
    const raw = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? "");
    const outcome = OFFLINE_PATTERN.test(raw) ? "offline" : step.definition.failureOutcome;
    step.state = "failed";
    step.failureOutcome = outcome;
    step.canContinue = !step.definition.required;
    step.message = safeFailureMessage(outcome, step.definition.provider, reason);
  }

  function runPending(): Promise<void> {
    if (activeRun) return activeRun;
    disposed = false;
    attempt += 1;
    const runGeneration = ++generation;
    const runnable = steps.filter((step) => step.state !== "complete" && step.state !== "disabled");
    for (const step of runnable) {
      step.state = "active";
      step.message = undefined;
      step.failureOutcome = undefined;
      step.canContinue = undefined;
    }
    publish();

    activeRun = Promise.allSettled(
      runnable.map(async (step) => {
        try {
          const result = await step.definition.run();
          if (disposed || generation !== runGeneration) return;
          normalizeResult(step, result);
        } catch (reason) {
          if (disposed || generation !== runGeneration) return;
          normalizeError(step, reason);
        }
        publish();
      }),
    ).then(() => {
      if (generation !== runGeneration) return;
      if (!disposed) publish();
      activeRun = undefined;
    });
    return activeRun;
  }

  return {
    start: runPending,
    retry: runPending,
    continueDegraded() {
      if (!snapshot.canContinue) return;
      for (const step of steps) {
        if (step.state === "failed") step.state = "disabled";
      }
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    dispose() {
      disposed = true;
      generation += 1;
      activeRun = undefined;
      listeners.clear();
    },
  };
}
