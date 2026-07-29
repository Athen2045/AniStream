import { randomUUID } from "node:crypto";
import { net, protocol } from "electron";
import { requireHttpsUrl, rewriteHlsManifest } from "./hls-manifest";

const SCHEME = "anistream-media";
const TOKEN_TTL_MS = 2 * 60 * 60_000;
const MAX_TOKENS = 4_000;

interface ProxyTarget {
  url: string;
  headers: Record<string, string>;
  expiresAt: number;
}

export interface StreamUrlBroker {
  createUrl(url: string, headers?: Record<string, string>): string;
}

export function registerHlsSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export class HlsProxy implements StreamUrlBroker {
  private readonly targets = new Map<string, ProxyTarget>();
  private registered = false;

  public register(): void {
    if (this.registered) return;
    protocol.handle(SCHEME, (request) => this.handle(request));
    this.registered = true;
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
    return `${SCHEME}://stream/${token}`;
  }

  private async handle(request: Request): Promise<Response> {
    try {
      const requestUrl = new URL(request.url);
      if (requestUrl.hostname !== "stream") return errorResponse(404, "Unknown stream route.");
      const token = requestUrl.pathname.replace(/^\/+/, "");
      const target = this.targets.get(token);
      if (!target || target.expiresAt <= Date.now()) {
        this.targets.delete(token);
        return errorResponse(410, "This playback URL has expired.");
      }

      const range = request.headers.get("range");
      const upstreamResponse = await net.fetch(target.url, {
        headers: {
          ...target.headers,
          ...(range ? { Range: range } : {}),
        },
        redirect: "follow",
      });
      if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
        return errorResponse(upstreamResponse.status, "The video host rejected this request.");
      }

      const finalUrl = upstreamResponse.url || target.url;
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

function isHlsManifest(response: Response, url: string): boolean {
  const contentType = response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
  return (
    contentType.includes("mpegurl") ||
    contentType.includes("vnd.apple") ||
    /\.m3u8(?:$|\?)/i.test(url)
  );
}

function sanitizeRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const allowed = new Set(["referer", "origin", "user-agent"]);
  return Object.fromEntries(
    Object.entries(headers)
      .filter(
        ([name, value]) =>
          allowed.has(name.toLocaleLowerCase()) && value.length > 0 && value.length <= 1_000,
      )
      .map(([name, value]) => [name, value]),
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
