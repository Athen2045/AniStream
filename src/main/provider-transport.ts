import type { RequestGate } from "./anilist/request-queue";

type Fetcher = typeof fetch;

export interface ProviderTransportOptions {
  gate: RequestGate;
  fetcher?: Fetcher;
  timeoutMs: number;
  headers?: HeadersInit;
  redirect?: RequestRedirect;
}

export interface ProviderRequestOptions extends RequestInit {
  dedupeKey?: string;
  onResponse?: (response: Response, gate: RequestGate) => void | Promise<void>;
}

/**
 * Shared trusted-process request lifecycle. Provider adapters still own endpoint
 * semantics, status messages, response parsing, and normalized domain values.
 */
export class ProviderTransport {
  private readonly fetcher: Fetcher;

  public constructor(private readonly options: ProviderTransportOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  public request(url: URL, request: ProviderRequestOptions = {}): Promise<Response> {
    const { dedupeKey = url.toString(), signal } = request;
    return this.options.gate.run(dedupeKey, () => this.dispatch(url, request), signal ?? undefined);
  }

  public requestJson(url: URL, request: ProviderRequestOptions = {}): Promise<unknown> {
    return this.requestParsed(url, request, (response) => response.json() as Promise<unknown>);
  }

  public requestParsed<T>(
    url: URL,
    request: ProviderRequestOptions,
    parse: (response: Response) => Promise<T>,
  ): Promise<T> {
    const { dedupeKey = url.toString(), signal } = request;
    return this.options.gate.run(
      dedupeKey,
      async () => parse(await this.dispatch(url, request)),
      signal ?? undefined,
    );
  }

  private async dispatch(url: URL, request: ProviderRequestOptions): Promise<Response> {
    const { dedupeKey: _dedupeKey, onResponse, signal, ...init } = request;
    const timeout = new AbortController();
    const timeoutId = setTimeout(() => timeout.abort(), this.options.timeoutMs);
    const combined = combineAbortSignals(signal, timeout.signal);
    try {
      const response = await this.fetcher(url, {
        ...init,
        headers: mergeHeaders(this.options.headers, init.headers),
        redirect: init.redirect ?? this.options.redirect,
        signal: combined.signal,
      });
      await onResponse?.(response, this.options.gate);
      return response;
    } finally {
      clearTimeout(timeoutId);
      combined.dispose();
    }
  }
}

export async function mapSettledWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let nextIndex = 0;
  const count = Math.max(1, Math.min(Math.floor(concurrency), values.length));
  await Promise.all(
    Array.from({ length: count }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        try {
          results[index] = { status: "fulfilled", value: await worker(values[index], index) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}

function mergeHeaders(defaults?: HeadersInit, overrides?: HeadersInit): Record<string, string> {
  const headers = new Headers(defaults);
  new Headers(overrides).forEach((value, key) => headers.set(key, value));
  return Object.fromEntries(headers.entries());
}

function combineAbortSignals(
  caller: AbortSignal | null | undefined,
  timeout: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const signals = caller ? [caller, timeout] : [timeout];
  for (const signal of signals) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => signals.forEach((signal) => signal.removeEventListener("abort", abort)),
  };
}
