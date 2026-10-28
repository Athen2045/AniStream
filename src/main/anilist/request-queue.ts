export interface RequestGate {
  run<T>(
    dedupeKey: string | undefined,
    fn: () => Promise<T>,
    signal?: AbortSignal,
    options?: RequestGateRunOptions,
  ): Promise<T>;
  /** Pause every future request until `retryAfterMs` has elapsed (see API.md: "On 429, stop the
   * queue until Retry-After/reset; do not send speculative retries."). Safe to call repeatedly;
   * only ever extends the pause, never shortens it. */
  reportRateLimited(retryAfterMs: number): void;
}

export interface RequestGateRunOptions {
  /** Something the viewer is looking at now: waits ahead of background requests (same budget). */
  priority?: boolean;
}

export interface RequestGateOptions {
  requestsPerMinute: number;
  windowMs?: number;
  /** Minimum spacing between request starts, independent of the per-minute budget.
   * Used by providers (e.g. the anime episode index) that document a strict inter-request gap rather
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
  // Requests waiting for a slot: priority ones first, each lane first-come first-served.
  const waiters: Waiter[] = [];
  let pumping = false;
  let blockedUntil = 0;
  let lastStartAt = 0;

  function enqueue(waiter: Waiter): void {
    const at = waiter.priority ? waiters.findIndex((other) => !other.priority) : -1;
    if (at === -1) waiters.push(waiter);
    else waiters.splice(at, 0, waiter);
  }

  /** Resolves with the slot's start time, so a request that never left can give it back. */
  function acquireSlot(signal?: AbortSignal, priority = false, key?: string): Promise<number> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    return new Promise<number>((resolve, reject) => {
      const waiter: Waiter = { priority, key, resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const at = waiters.indexOf(waiter);
          if (at !== -1) waiters.splice(at, 1);
          reject(abortReason(signal));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      enqueue(waiter);
      void pump();
    });
  }

  /** A priority caller joining a queued request moves that request into the priority lane. */
  function promote(key: string): void {
    const at = waiters.findIndex((waiter) => waiter.key === key && !waiter.priority);
    if (at === -1) return;
    const [waiter] = waiters.splice(at, 1);
    waiter.priority = true;
    enqueue(waiter);
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (waiters.length) {
        const now = Date.now();
        let waitMs = 0;
        if (now < blockedUntil) waitMs = blockedUntil - now;
        else if (minIntervalMs && now - lastStartAt < minIntervalMs)
          waitMs = minIntervalMs - (now - lastStartAt);
        else {
          while (startTimestamps.length && now - startTimestamps[0] >= windowMs) {
            startTimestamps.shift();
          }
          if (startTimestamps.length >= limit) waitMs = windowMs - (now - startTimestamps[0]) + 1;
        }
        if (waitMs > 0) {
          await sleep(waitMs);
          continue;
        }
        const waiter = waiters.shift();
        if (!waiter) break;
        if (waiter.signal && waiter.onAbort)
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        startTimestamps.push(now);
        lastStartAt = now;
        waiter.resolve(now);
      }
    } finally {
      pumping = false;
    }
  }

  function run<T>(
    dedupeKey: string | undefined,
    fn: () => Promise<T>,
    signal?: AbortSignal,
    options: RequestGateRunOptions = {},
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (dedupeKey) {
      const existing = inFlight.get(dedupeKey);
      if (existing) {
        if (options.priority) promote(dedupeKey);
        return raceWithAbort(existing as Promise<T>, signal).catch((error: unknown) => {
          // The shared request belonged to another caller who cancelled it. This caller did not
          // cancel, so it runs the request itself instead of inheriting someone else's abort.
          if (!isCancellation(error) || signal?.aborted) throw error;
          if (inFlight.get(dedupeKey) === existing) inFlight.delete(dedupeKey);
          return run(dedupeKey, fn, signal, options);
        });
      }
    }

    const execution = (async () => {
      const startedAt = await acquireSlot(signal, options.priority === true, dedupeKey);
      throwIfAborted(signal);
      try {
        return await fn();
      } catch (error) {
        // No connection (or DNS/refused): the server never saw it, so it uses none of its limit.
        // Offline browsing would otherwise fill the window and delay what loads on reconnect.
        if (neverReachedServer(error)) {
          const at = startTimestamps.indexOf(startedAt);
          if (at !== -1) startTimestamps.splice(at, 1);
        }
        throw error;
      }
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
  }

  return {
    run,
    reportRateLimited(retryAfterMs: number): void {
      blockedUntil = Math.max(blockedUntil, Date.now() + Math.max(0, retryAfterMs));
    },
  };
}

/**
 * Node's `fetch` rejects with `TypeError("fetch failed")` when no connection was made (offline,
 * DNS, refused, reset before a response). Timeouts and HTTP answers are not this: the server may
 * have seen those requests.
 */
function neverReachedServer(error: unknown): boolean {
  return error instanceof TypeError && /fetch failed/i.test(error.message);
}

interface Waiter {
  priority: boolean;
  key?: string;
  resolve: (startedAt: number) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
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

/** A caller's cancellation, as opposed to a timeout or a provider failure. */
function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
