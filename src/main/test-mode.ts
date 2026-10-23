import { readFileSync } from "node:fs";
import { app } from "electron";

/**
 * One canned answer for automated UI tests. `match` is a substring of the full request URL;
 * `bodyIncludes` (all of them) narrows GraphQL calls that share one URL.
 */
interface FixtureRoute {
  match: string;
  method?: string;
  bodyIncludes?: string[];
  status?: number;
  json?: unknown;
}

/**
 * Development-only switches for Playwright runs, ignored in packaged builds; call before any client
 * is constructed. ANISTREAM_TEST_USER_DATA keeps a run out of the real profile (also for paced
 * live checks against real providers). ANISTREAM_TEST_FIXTURES=<routes.json> answers every
 * main-process `fetch` from that file and refuses anything else, so a test never reaches a real
 * provider.
 */
export function installTestMode(): boolean {
  const fixtureFile = process.env.ANISTREAM_TEST_FIXTURES;
  const userData = process.env.ANISTREAM_TEST_USER_DATA;
  if (app.isPackaged || (!fixtureFile && !userData)) return false;
  if (userData) app.setPath("userData", userData);
  if (!fixtureFile) return true;
  const routes = parseRoutes(JSON.parse(readFileSync(fixtureFile, "utf8")) as unknown);
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = request ? request.url : String(input);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    const route = routes.find(
      (candidate) =>
        url.includes(candidate.match) &&
        (candidate.method ?? "GET") === method &&
        (candidate.bodyIncludes ?? []).every((part) => body.includes(part)),
    );
    const { origin, pathname } = new URL(url);
    console.warn(`[AniStream test] ${route ? "served" : "refused"} ${method} ${origin}${pathname}`);
    if (!route) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(route.json ?? null), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return true;
}

function parseRoutes(value: unknown): FixtureRoute[] {
  if (!Array.isArray(value)) throw new Error("Test fixtures must be an array of routes.");
  return value.map((route: unknown) => {
    if (typeof route !== "object" || route === null || !("match" in route))
      throw new Error("Each test fixture route needs a match.");
    return route as FixtureRoute;
  });
}
