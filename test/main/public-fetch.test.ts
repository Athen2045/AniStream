import { describe, expect, it, vi } from "vitest";
import { requireHttpsUrl } from "../../src/main/hls-manifest";
import { isPrivateAddress } from "../../src/main/private-address";
import { createPublicFetch, type HostLookup } from "../../src/main/public-fetch";
import { environmentFiles } from "../../src/main/config";

vi.mock("electron", () => ({ net: { request: vi.fn() }, protocol: { handle: vi.fn() } }));
const { StreamProxy } = await import("../../src/main/stream-proxy");

const PUBLIC_IP = "93.184.216.34";
const publicLookup: HostLookup = async () => [PUBLIC_IP];

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

/** A fetcher answering from a URL → response table; anything else is a test failure. */
function fakeFetcher(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const route = routes[String(input)];
    if (!route) throw new Error(`unexpected request to ${String(input)}`);
    return route();
  });
}

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.31.255.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "[::1]",
    "::ffff:7f00:1",
    "::ffff:192.168.1.1",
    "fe80::1",
    "fd12:3456::1",
    "ff02::1",
  ])("refuses %s", (address) => expect(isPrivateAddress(address)).toBe(true));

  it.each([PUBLIC_IP, "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"])("allows %s", (address) =>
    expect(isPrivateAddress(address)).toBe(false),
  );
});

describe("requireHttpsUrl", () => {
  it("refuses private literals in any spelling the URL parser normalizes", () => {
    for (const host of ["[::ffff:127.0.0.1]", "0x7f.1", "2130706433", "224.0.0.1", "[fd00::1]"])
      expect(() => requireHttpsUrl(`https://${host}/a`)).toThrow();
  });
});

describe("createPublicFetch", () => {
  it("follows a public redirect itself, without cookies, and reports the final URL", async () => {
    const fetcher = fakeFetcher({
      "https://cdn.example/a.m3u8": () => redirect("/b.m3u8"),
      "https://cdn.example/b.m3u8": () => new Response("#EXTM3U"),
    });
    const fetchPublic = createPublicFetch({
      fetcher: fetcher as typeof fetch,
      lookup: publicLookup,
    });

    const { response, url } = await fetchPublic("https://cdn.example/a.m3u8", {
      headers: { Referer: "https://site.example/" },
    });

    expect(await response.text()).toBe("#EXTM3U");
    expect(url).toBe("https://cdn.example/b.m3u8");
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ redirect: "manual", credentials: "omit" });
      expect(init?.headers).toEqual({ Referer: "https://site.example/" });
    }
  });

  it.each([
    ["a private address", "https://192.168.1.1/admin"],
    ["plain HTTP", "http://cdn.example/b.m3u8"],
    ["a mapped loopback address", "https://[::ffff:127.0.0.1]/"],
    ["a local name", "https://router.local/"],
  ])("never requests a redirect to %s", async (_label, location) => {
    const fetcher = fakeFetcher({ "https://cdn.example/a.m3u8": () => redirect(location) });
    const fetchPublic = createPublicFetch({
      fetcher: fetcher as typeof fetch,
      lookup: publicLookup,
    });

    await expect(fetchPublic("https://cdn.example/a.m3u8")).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses a public-looking name that resolves to a private address", async () => {
    const fetcher = fakeFetcher({});
    const lookup: HostLookup = async (host) =>
      host === "evil.example" ? ["10.0.0.5"] : [PUBLIC_IP];
    const fetchPublic = createPublicFetch({ fetcher: fetcher as typeof fetch, lookup });

    await expect(fetchPublic("https://evil.example/seg.ts")).rejects.toThrow(/public host/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a name when any of its addresses is private", async () => {
    const fetcher = fakeFetcher({});
    const fetchPublic = createPublicFetch({
      fetcher: fetcher as typeof fetch,
      lookup: async () => [PUBLIC_IP, "127.0.0.1"],
    });

    await expect(fetchPublic("https://mixed.example/")).rejects.toThrow(/public host/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stops after five redirects", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => redirect(`${String(input)}x`));
    const fetchPublic = createPublicFetch({
      fetcher: fetcher as typeof fetch,
      lookup: publicLookup,
    });

    await expect(fetchPublic("https://cdn.example/a")).rejects.toThrow(/too many/);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("refuses redirects it cannot inspect or that name no location", async () => {
    const opaque = Object.defineProperty(new Response(null, { status: 200 }), "type", {
      value: "opaqueredirect",
    });
    const fetchPublic = createPublicFetch({
      fetcher: fakeFetcher({
        "https://cdn.example/opaque": () => opaque,
        "https://cdn.example/nowhere": () => new Response(null, { status: 302 }),
      }) as typeof fetch,
      lookup: publicLookup,
    });

    await expect(fetchPublic("https://cdn.example/opaque")).rejects.toThrow(/could not be checked/);
    await expect(fetchPublic("https://cdn.example/nowhere")).rejects.toThrow(/without a location/);
  });

  it("looks a host up once a minute, not once per segment", async () => {
    let time = 0;
    const lookup = vi.fn(publicLookup);
    const fetchPublic = createPublicFetch({
      fetcher: vi.fn(async () => new Response("ok")) as typeof fetch,
      lookup,
      now: () => time,
    });

    await fetchPublic("https://cdn.example/s1.ts");
    await fetchPublic("https://cdn.example/s2.ts");
    expect(lookup).toHaveBeenCalledTimes(1);
    time = 61_000;
    await fetchPublic("https://cdn.example/s3.ts");
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe("StreamProxy", () => {
  it("rewrites a redirected playlist against its final URL", async () => {
    const fetcher = fakeFetcher({
      "https://cdn.example/start.m3u8": () => redirect("https://media.example/v/index.m3u8"),
      "https://media.example/v/index.m3u8": () =>
        new Response("#EXTM3U\n#EXTINF:6,\nseg1.ts\n", {
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        }),
      "https://media.example/v/seg1.ts": () => new Response("segment"),
    });
    const proxy = new StreamProxy(fetcher as typeof fetch, publicLookup);

    const playlist = await proxy.handle(
      new Request(proxy.createUrl("https://cdn.example/start.m3u8")),
    );
    const segmentUrl = (await playlist.text())
      .split("\n")
      .find((line) => line.startsWith("anistream-media://"));
    const segment = await proxy.handle(new Request(segmentUrl!));

    expect(await segment.text()).toBe("segment");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toContain(
      "https://media.example/v/seg1.ts",
    );
    for (const [, init] of fetcher.mock.calls) expect(init?.credentials).toBe("omit");
  });

  it("answers 502 and never contacts the LAN when a source redirects there", async () => {
    const fetcher = fakeFetcher({
      "https://cdn.example/start.m3u8": () => redirect("https://192.168.0.1/"),
    });
    const proxy = new StreamProxy(fetcher as typeof fetch, publicLookup);

    const response = await proxy.handle(
      new Request(proxy.createUrl("https://cdn.example/start.m3u8")),
    );

    expect(response.status).toBe(502);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("environmentFiles", () => {
  it("reads the working-folder .env only in development", () => {
    const paths = { cwd: "C:\\Somewhere", userData: "C:\\Profile" };
    expect(environmentFiles({ packaged: true, ...paths })).toHaveLength(1);
    expect(environmentFiles({ packaged: true, ...paths })[0]).toContain("Profile");
    const dev = environmentFiles({ packaged: false, ...paths });
    expect(dev).toHaveLength(2);
    expect(dev[0]).toContain("Somewhere");
  });
});
