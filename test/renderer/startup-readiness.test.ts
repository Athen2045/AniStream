import { describe, expect, it, vi } from "vitest";
import {
  createReadinessSession,
  type ReadinessStage,
  type ReadinessStageResult,
} from "../../src/renderer/src/startup-readiness";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function stage(
  id: string,
  weight: number,
  run: () => Promise<void | ReadinessStageResult>,
  overrides: Partial<ReadinessStage> = {},
): ReadinessStage {
  return {
    id,
    label: `Checking ${id}`,
    weight,
    required: true,
    provider: id === "local" ? undefined : id,
    failureOutcome: id === "local" ? "local-error" : "provider-error",
    run,
    ...overrides,
  };
}

describe("readiness session", () => {
  it("publishes only real completed weight and never moves progress backward", async () => {
    const local = deferred();
    const session = createReadinessSession({
      mode: "launch",
      stages: [
        stage("local", 15, () => local.promise),
        stage("session", 25, async () => undefined),
        stage("catalog", 40, async () => undefined),
        stage("playback", 20, async () => undefined, { required: false }),
      ],
    });

    const progress: number[] = [];
    session.subscribe(() => progress.push(session.getSnapshot().progress));
    const started = session.start();
    await vi.waitFor(() => expect(session.getSnapshot().progress).toBe(85));
    local.resolve();
    await started;

    expect(session.getSnapshot()).toMatchObject({ progress: 100, outcome: "ready" });
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(
      true,
    );
  });

  it("degrades optional playback failure with the approved provider message", async () => {
    const session = createReadinessSession({
      mode: "launch",
      stages: [
        stage("local", 80, async () => undefined),
        stage("playback", 20, async () => ({ status: "degraded", provider: "Anikoto" }), {
          required: false,
        }),
      ],
    });

    await session.start();

    expect(session.getSnapshot()).toMatchObject({
      progress: 80,
      outcome: "degraded",
      canContinue: true,
    });
    expect(session.getSnapshot().message).toMatch(
      /Sorry.*Anikoto.*working on the issue.*try again later/i,
    );
  });

  it("classifies connectivity failures as offline", async () => {
    const session = createReadinessSession({
      mode: "profile",
      stages: [
        stage("account", 30, async () => undefined),
        stage("profile", 30, async () => undefined),
        stage("library", 40, async () => {
          throw new Error("fetch failed: ENOTFOUND");
        }),
      ],
    });

    await session.start();

    expect(session.getSnapshot()).toMatchObject({ outcome: "offline", canContinue: false });
    expect(session.getSnapshot().message).toMatch(/offline|connection/i);
  });

  it("retains successful stages and deduplicates an active retry", async () => {
    const firstFailure = deferred<void>();
    const retryAttempt = deferred<void>();
    const local = vi.fn(async () => undefined);
    const catalog = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstFailure.promise)
      .mockImplementationOnce(() => retryAttempt.promise);
    const session = createReadinessSession({
      mode: "launch",
      stages: [stage("local", 40, local), stage("catalog", 60, catalog)],
    });

    const started = session.start();
    firstFailure.reject(new Error("HTTP 503"));
    await started;
    expect(session.getSnapshot().progress).toBe(40);

    const retryOne = session.retry();
    const retryTwo = session.retry();
    expect(retryTwo).toBe(retryOne);
    retryAttempt.resolve();
    await retryOne;

    expect(local).toHaveBeenCalledTimes(1);
    expect(catalog).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot()).toMatchObject({ progress: 100, outcome: "ready" });
  });

  it("ignores stage completion after disposal", async () => {
    const pending = deferred();
    const session = createReadinessSession({
      mode: "launch",
      stages: [stage("local", 100, () => pending.promise)],
    });
    const started = session.start();
    session.dispose();
    pending.resolve();
    await started;
    expect(session.getSnapshot().progress).toBe(0);
  });

  it("validates stage identity and total weight", () => {
    expect(() =>
      createReadinessSession({
        mode: "launch",
        stages: [stage("local", 99, async () => undefined)],
      }),
    ).toThrow(/100/);
    expect(() =>
      createReadinessSession({
        mode: "launch",
        stages: [
          stage("same", 50, async () => undefined),
          stage("same", 50, async () => undefined),
        ],
      }),
    ).toThrow(/unique/i);
  });
});
