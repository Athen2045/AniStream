export interface RequestGate {
  run<T>(dedupeKey: string | undefined, fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** Pause every future request until `retryAfterMs` has elapsed (see API.md: "On 429, stop the
   * queue until Retry-After/reset; do not send speculative retries."). Safe to call repeatedly;
   * only ever extends the pause, never shortens it. */
  reportRateLimited(retryAfterMs: number): void;
}

export interface RequestGateOptions {
  requestsPerMinute: number;
  windowMs?: number;
  /** Minimum spacing between request starts, independent of the per-minute budget.
   * Used by providers (e.g. Anikoto) that document a strict inter-request gap rather
   * than a sliding-window quota. */
  minIntervalMs?: number;
}

/**
 * Enforces AniList's client-side rate-limit policy (see API.md) and deduplicates
 * identical in-flight read requests. Mutations should pass no dedupe key so
 * repeated identical calls are never silently merged.
 */
export function createRequestGate(options: RequestGateOptions): RequestGate {
  const windowMs = options.windowMs ?? 60_000;
  const limit = Math.max(1, Math.floor(options.requestsPerMinute));
  const minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
  const startTimestamps: number[] = [];
  const inFlight = new Map<string, Promise<unknown>>();
  let queueTail: Promise<void> = Promise.resolve();
  let blockedUntil = 0;
  let lastStartAt = 0;

  function acquireSlot(signal?: AbortSignal): Promise<void> {
    const slot = queueTail.then(async () => {
      for (;;) {
        throwIfAborted(signal);
        const now = Date.now();
        if (now < blockedUntil) {
          await sleep(blockedUntil - now, signal);
          continue;
        }
        if (minIntervalMs && now - lastStartAt < minIntervalMs) {
          await sleep(minIntervalMs - (now - lastStartAt), signal);
          continue;
        }
        while (startTimestamps.length && now - startTimestamps[0] >= windowMs) {
          startTimestamps.shift();
        }
        if (startTimestamps.length < limit) {
          startTimestamps.push(now);
          lastStartAt = now;
          return;
        }
        const waitMs = windowMs - (now - startTimestamps[0]) + 1;
        await sleep(waitMs, signal);
      }
    });
    queueTail = slot.then(
      () => undefined,
      () => undefined,
    );
    return slot;
  }

  return {
    run<T>(dedupeKey: string | undefined, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) return Promise.reject(abortReason(signal));
      if (dedupeKey) {
        const existing = inFlight.get(dedupeKey);
        if (existing) return raceWithAbort(existing as Promise<T>, signal);
      }

      const execution = (async () => {
        await acquireSlot(signal);
        throwIfAborted(signal);
        return fn();
      })();

      if (dedupeKey) {
        const key = dedupeKey;
        inFlight.set(key, execution);
        const clearInFlight = (): void => {
          if (inFlight.get(key) === execution) inFlight.delete(key);
        };
        // `finally()` would create a second promise that rejects whenever `execution`
        // rejects. If that cleanup promise is ignored, an expected provider outage is
        // reported by Electron as an unhandled rejection even though the caller handled it.
        void execution.then(clearInFlight, clearInFlight);
      }

      return execution;
    },
    reportRateLimited(retryAfterMs: number): void {
      blockedUntil = Math.max(blockedUntil, Date.now() + Math.max(0, retryAfterMs));
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortError(): DOMException {
  return new DOMException("The request was cancelled.", "AbortError");
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : abortError();
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (reason: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(reason);
      },
    );
  });
}
