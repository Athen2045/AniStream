import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { extname, relative, resolve, sep } from "node:path";

/**
 * Renderer CSP. Only the configured anime embed origin may be framed; the origins come from the
 * gitignored provider config, so none are hardcoded here.
 */
export function buildContentSecurityPolicy(frameOrigins: readonly string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob: anistream-art:",
    "media-src 'self' https: blob:",
    "connect-src 'self' https: blob:",
    `frame-src ${frameOrigins.length ? frameOrigins.join(" ") : "'none'"}`,
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The packaged renderer's preferred loopback port. Chromium keys localStorage by origin, so a
 * random port per launch silently reset every renderer-saved choice (appearance, autoplay,
 * Continue removals) on restart. A busy port falls back to a random one for that launch only.
 */
export const RENDERER_PORT = 41728;

export interface RendererServer {
  origin: string;
  url: string;
  close(): Promise<void>;
}

export async function startRendererServer(
  rendererRoot: string,
  options: { frameOrigins: readonly string[]; port?: number } = { frameOrigins: [] },
): Promise<RendererServer> {
  const root = resolve(rendererRoot);
  const contentSecurityPolicy = buildContentSecurityPolicy(options.frameOrigins);
  let expectedHost = "";

  const server = createServer((request, response) => {
    response.setHeader("Content-Security-Policy", contentSecurityPolicy);
    if (expectedHost && request.headers.host !== expectedHost) {
      sendText(response, 421, "Misdirected request");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendText(response, 405, "Method not allowed");
      return;
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    } catch {
      sendText(response, 400, "Invalid path");
      return;
    }

    const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = resolve(root, requestedPath);
    const relativePath = relative(root, filePath);
    if (
      !relativePath ||
      relativePath.startsWith(`..${sep}`) ||
      relativePath === ".." ||
      relativePath.includes("\0")
    ) {
      sendText(response, 404, "Not found");
      return;
    }

    void stat(filePath)
      .then((file) => {
        if (!file.isFile()) {
          sendText(response, 404, "Not found");
          return;
        }

        setSecurityHeaders(response);
        response.statusCode = 200;
        response.setHeader("Content-Type", contentType(filePath));
        response.setHeader("Content-Length", file.size);
        setAssetCacheHeaders(response, requestedPath);
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        createReadStream(filePath)
          .on("error", () => {
            if (!response.headersSent) sendText(response, 500, "Unable to read renderer asset");
            else response.destroy();
          })
          .pipe(response);
      })
      .catch(() => sendText(response, 404, "Not found"));
  });

  const listen = (port: number) =>
    new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
  try {
    await listen(options.port ?? 0);
  } catch (error) {
    if (!options.port || (error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    await listen(0);
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("AniStream could not start its loopback renderer.");
  }

  expectedHost = `127.0.0.1:${address.port}`;
  const origin = `http://${expectedHost}`;
  server.unref();

  return {
    origin,
    url: `${origin}/index.html`,
    close: () =>
      new Promise<void>((resolveClose) => {
        if (!server.listening) {
          resolveClose();
          return;
        }
        server.close(() => resolveClose());
      }),
  };
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function setAssetCacheHeaders(response: ServerResponse, requestedPath: string): void {
  // Vite fingerprints every production asset under /assets. Let Chromium reuse
  // those bytes on same-session reloads while keeping index.html revalidated so
  // it can never point at a stale chunk after an update.
  response.setHeader("Cache-Control", rendererAssetCacheControl(requestedPath));
}

export function rendererAssetCacheControl(requestedPath: string): string {
  return requestedPath.startsWith("assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache, no-store, must-revalidate";
}

function sendText(response: ServerResponse, status: number, message: string): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  setSecurityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(message);
}

function contentType(filePath: string): string {
  switch (extname(filePath).toLocaleLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    default:
      return "application/octet-stream";
  }
}
