import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { net, protocol } from "electron";
import { requireHttpsUrl, rewriteHlsManifest } from "./hls-manifest";
import { PROVIDER_USER_AGENT } from "./provider-transport";

/**
 * Main-process stream proxy for AniStream's own player (user decision 2026-10-18; restores the
 * removed HLS proxy as the base for playback and, later, offline downloads).
 *
 * The renderer gets opaque `anistream-media://stream/<token>` URLs; this process fetches the HTTPS
 * upstream with the app's truthful User-Agent plus only allowlisted headers a source's config asks
 * for (e.g. `Referer`), and rewrites HLS playlists so segments, keys and renditions come through
 * here too. Never cookies, never the user's credentials. Tokens expire.
 */
export const STREAM_SCHEME = "anistream-media";
const TOKEN_TTL_MS = 6 * 60 * 60_000;
const MAX_TOKENS = 8_000;
const ALLOWED_HEADERS = new Set(["referer", "origin"]);

interface ProxyTarget {
  url: string;
  headers: Record<string, string>;
  expiresAt: number;
}

export interface StreamUrlBroker {
  createUrl(url: string, headers?: Record<string, string>): string;
}

/** Must run before the app is ready. */
export function streamSchemePrivileges(): Electron.CustomScheme {
  return {
    scheme: STREAM_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  };
}

export class StreamProxy implements StreamUrlBroker {
  private readonly targets = new Map<string, ProxyTarget>();
  private registered = false;
  private offlineFiles?: (id: string, relative: string) => string | undefined;

  public constructor(
    private readonly fetcher: typeof net.fetch = (url, init) => net.fetch(url, init),
  ) {}

  public register(): void {
    if (this.registered) return;
    protocol.handle(STREAM_SCHEME, (request) => this.handle(request));
    this.registered = true;
  }

  /** Where downloaded episodes' files live: (download ID, relative path) → absolute file. */
  public setOfflineFiles(resolver: (id: string, relative: string) => string | undefined): void {
    this.offlineFiles = resolver;
  }

  /** A downloaded episode's file, served from disk with no network. */
  public offlineUrl(id: string, relative: string): string {
    return `${STREAM_SCHEME}://offline/${encodeURIComponent(id)}/${relative
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }

  public createUrl(url: string, headers: Record<string, string> = {}): string {
    const upstream = requireHttpsUrl(url);
    this.prune();
    const token = randomUUID();
    this.targets.set(token, {
      url: upstream.toString(),
      headers: sanitizeRequestHeaders(headers),
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
    return `${STREAM_SCHEME}://stream/${token}`;
  }

  public async handle(request: Request): Promise<Response> {
    try {
      const requestUrl = new URL(request.url);
      if (requestUrl.hostname === "offline") return await this.offline(requestUrl);
      if (requestUrl.hostname !== "stream") return errorResponse(404, "Unknown stream route.");
      const token = requestUrl.pathname.replace(/^\/+/, "");
      const target = this.targets.get(token);
      if (!target || target.expiresAt <= Date.now()) {
        this.targets.delete(token);
        return errorResponse(410, "This playback URL has expired.");
      }

      const range = request.headers.get("range");
      const upstreamResponse = await this.fetcher(target.url, {
        headers: {
          "User-Agent": PROVIDER_USER_AGENT,
          ...target.headers,
          ...(range ? { Range: range } : {}),
        },
        redirect: "follow",
      });
      if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
        return errorResponse(upstreamResponse.status, "The video host rejected this request.");
      }

      const finalUrl = upstreamResponse.url || target.url;
      // A redirect may not leave HTTPS or reach a private host.
      requireHttpsUrl(finalUrl);
      if (isHlsManifest(upstreamResponse, finalUrl)) {
        const manifest = await upstreamResponse.text();
        const rewritten = rewriteHlsManifest(manifest, finalUrl, (childUrl) =>
          this.createUrl(childUrl, target.headers),
        );
        return new Response(rewritten, {
          status: upstreamResponse.status,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
            "Content-Type": "application/vnd.apple.mpegurl",
          },
        });
      }

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: copyResponseHeaders(upstreamResponse.headers),
      });
    } catch {
      return errorResponse(502, "Unable to proxy the selected video stream.");
    }
  }

  /** Serves a downloaded episode's playlist, segment, key, subtitle or font from disk. */
  private async offline(requestUrl: URL): Promise<Response> {
    const [id, ...rest] = requestUrl.pathname
      .replace(/^\/+/, "")
      .split("/")
      .map((part) => decodeURIComponent(part));
    const relative = rest.join("/");
    if (!id || !relative || rest.some((part) => !part || part === "." || part === ".."))
      return errorResponse(404, "Unknown offline file.");
    const file = this.offlineFiles?.(id, relative);
    if (!file) return errorResponse(404, "This download is not available.");
    try {
      const body = await readFile(file);
      return new Response(body, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "Content-Type": offlineContentType(relative),
          "Content-Length": String(body.length),
        },
      });
    } catch {
      return errorResponse(404, "This downloaded file is missing.");
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, target] of this.targets) {
      if (target.expiresAt <= now) this.targets.delete(token);
    }
    while (this.targets.size >= MAX_TOKENS) {
      const oldest = this.targets.keys().next().value as string | undefined;
      if (!oldest) break;
      this.targets.delete(oldest);
    }
  }
}

function offlineContentType(relative: string): string {
  const extension = relative.split(".").pop()?.toLowerCase();
  if (extension === "m3u8") return "application/vnd.apple.mpegurl";
  if (extension === "ts") return "video/mp2t";
  if (extension === "vtt") return "text/vtt; charset=utf-8";
  if (extension === "ass") return "text/plain; charset=utf-8";
  if (extension === "woff2") return "font/woff2";
  if (extension === "woff") return "font/woff";
  if (extension === "otf") return "font/otf";
  if (extension === "ttf" || extension === "ttc") return "font/ttf";
  return "application/octet-stream";
}

function isHlsManifest(response: Response, url: string): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return (
    contentType.includes("mpegurl") ||
    contentType.includes("vnd.apple") ||
    /\.m3u8(?:$|\?)/i.test(url)
  );
}

function sanitizeRequestHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) =>
        ALLOWED_HEADERS.has(name.toLowerCase()) &&
        value.length > 0 &&
        value.length <= 1_000 &&
        /^https:\/\//i.test(value),
    ),
  );
}

function copyResponseHeaders(headers: Headers): Headers {
  const copied = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": headers.get("cache-control") ?? "no-store",
  });
  for (const name of ["content-type", "content-length", "accept-ranges", "content-range"]) {
    const value = headers.get(name);
    if (value) copied.set(name, value);
  }
  return copied;
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
