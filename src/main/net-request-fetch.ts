import { Readable } from "node:stream";
import { net } from "electron";

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * A `fetch` for `createPublicFetch` on Chromium's network stack that never follows a redirect and
 * never sends the session's cookies. Electron's `net.fetch` cannot do this: with
 * `redirect: "manual"` it throws "Redirect was cancelled" instead of returning the 3xx, and by
 * default it sends the default session's cookies (both checked live, Electron 44.9.3, 2026-10-28).
 * A redirect comes back as a bodiless response carrying its status and `Location`.
 */
export const netRequestFetch = ((input: string | URL | Request, init: RequestInit = {}) =>
  new Promise<Response>((resolve, reject) => {
    const signal = init.signal ?? undefined;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const request = net.request({
      url: String(input),
      method: init.method ?? "GET",
      redirect: "manual",
      credentials: "omit",
      useSessionCookies: false,
    });
    for (const [name, value] of new Headers(init.headers)) request.setHeader(name, value);
    let body: Readable | undefined;
    // Cancelling also stops a body that is still streaming (download timeouts and cancels).
    const onAbort = (): void => {
      request.abort();
      body?.destroy(signal?.reason instanceof Error ? signal.reason : new Error("Aborted"));
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const settle = (): void => signal?.removeEventListener("abort", onAbort);

    request.on("redirect", (status, _method, location) => {
      settle();
      request.abort();
      resolve(new Response(null, { status, headers: { Location: location } }));
    });
    request.on("response", (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers))
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const status = response.statusCode;
      if (NULL_BODY_STATUSES.has(status)) {
        settle();
        request.abort();
        resolve(new Response(null, { status, statusText: response.statusMessage, headers }));
        return;
      }
      body = response as unknown as Readable;
      body.once("close", settle);
      const stream = Readable.toWeb(body) as ReadableStream<Uint8Array>;
      resolve(new Response(stream, { status, statusText: response.statusMessage, headers }));
    });
    request.on("error", (error) => {
      settle();
      reject(error);
    });
    request.end();
  })) as typeof fetch;
