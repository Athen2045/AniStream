import { afterEach, expect, it, vi } from "vitest";
import { UpdateChecker } from "../../src/main/update-check";
import {
  parseRelease as parseTargetRelease,
  updateTarget,
  type UpdateTarget,
  RELEASE_ENDPOINT,
  RELEASE_REPOSITORY,
} from "../../src/main/update-release";
import { ipcArgValidators } from "../../src/main/ipc-validation";

const release = (version = "0.1.4") => ({
  id: 1,
  tag_name: `v${version}`,
  html_url: `${RELEASE_REPOSITORY}/releases/tag/v${version}`,
  draft: false,
  prerelease: false,
  assets: [{ id: 2, name: `AniStream-${version}-arm64.dmg`, state: "uploaded", size: 123 }],
});
const parseRelease = (value: unknown) => parseTargetRelease(value, "mac-arm64");

it.each([
  [true, "win32", "x64", "win-x64"],
  [true, "darwin", "arm64", "mac-arm64"],
  [false, "win32", "x64", undefined],
  [false, "darwin", "arm64", undefined],
  [true, "linux", "x64", undefined],
  [true, "win32", "arm64", undefined],
  [true, "darwin", "x64", undefined],
] as const)("selects supported packaged target %s/%s/%s", (packaged, platform, arch, expected) => {
  expect(updateTarget(packaged, platform, arch)).toBe(expected);
});

it.each(["AniStream.Setup.0.1.4.exe", "AniStream Setup 0.1.4.exe"])(
  "accepts the exact Windows installer %s",
  (name) => {
    const data = { ...release(), assets: [{ ...release().assets[0], name }] };
    expect(parseTargetRelease(data, "win-x64").kind).toBe("release");
    expect(parseTargetRelease(data, "mac-arm64").kind).toBe("no-compatible-release");
  },
);

it.each(["0.1.4", "0.1.3", "0.1.2"])(
  "checks Windows release %s independently of the Mac asset",
  async (version) => {
    const data = release(version);
    data.assets[0]!.name = `AniStream.Setup.${version}.exe`;
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json(data));
    expect(await setup(transport, { target: "win-x64" }).check()).toMatchObject({
      kind: version === "0.1.4" ? "update-available" : "up-to-date",
    });
  },
);

it.each([
  "AniStream-0.1.4-arm64.dmg",
  "AniStream.Setup.0.1.3.exe",
  "AniStream.Setup.0.1.4.exe.blockmap",
  "AniStream.Setup.0.1.4-arm64.exe",
  "Unrelated.Setup.0.1.4.exe",
])("does not treat %s as a compatible Windows release", async (name) => {
  const data = { ...release(), assets: [{ ...release().assets[0], name }] };
  const transport = vi.fn<typeof fetch>().mockResolvedValue(json(data));
  expect(await setup(transport, { target: "win-x64" }).check()).toMatchObject({
    kind: "unavailable",
    reason: "no-compatible-release",
  });
});

it.each([{ size: 0 }, { state: "starter" }])(
  "rejects incomplete Windows installers %#",
  (patch) => {
    const data = {
      ...release(),
      assets: [{ ...release().assets[0], name: "AniStream.Setup.0.1.4.exe", ...patch }],
    };
    expect(parseTargetRelease(data, "win-x64").kind).toBe("no-compatible-release");
  },
);
const json = (value: unknown, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), { headers });
function setup(
  transport: typeof fetch,
  options: { target?: UpdateTarget; currentVersion?: string } = {},
) {
  return new UpdateChecker({
    currentVersion: "0.1.3",
    target: "mac-arm64",
    fetch: transport,
    ...options,
  });
}
afterEach(() => vi.useRealTimers());

it.each([
  ["0.1.4", "update-available"],
  ["0.1.3", "up-to-date"],
  ["0.1.2", "up-to-date"],
  ["0.10.0", "update-available"],
])("compares validated stable release %s", async (version, kind) => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(json(release(version)));
  expect(await setup(transport).check()).toMatchObject({ kind, currentVersion: "0.1.3" });
  expect(transport).toHaveBeenCalledWith(
    RELEASE_ENDPOINT,
    expect.objectContaining({
      redirect: "manual",
      credentials: "omit",
      headers: expect.objectContaining({ "X-GitHub-Api-Version": "2026-03-10" }),
    }),
  );
});

it.each([
  null,
  {},
  { ...release(), draft: true },
  { ...release(), prerelease: true },
  { ...release(), id: -1 },
  { ...release(), assets: [{}] },
  { ...release(), assets: null },
])("rejects malformed release %#", (value) => {
  expect(parseRelease(value).kind).toBe("invalid-response");
});
it.each(["0.1", "01.1.4", "0.1.4-beta", "0.1.4+build", "9007199254740992.0.0", "0.1.4/../../evil"])(
  "rejects unsafe version %s",
  (tag) => {
    expect(
      parseRelease({
        ...release(),
        tag_name: tag,
        html_url: `${RELEASE_REPOSITORY}/releases/tag/${tag}`,
      }).kind,
    ).toBe("invalid-response");
  },
);
it.each([
  "https://evil.test/release",
  `${RELEASE_REPOSITORY}/releases/tag/v0.1.5`,
  `${RELEASE_REPOSITORY}/releases/tag/v0.1.4?x=1`,
  `${RELEASE_REPOSITORY}/releases/tag/v0.1.4#x`,
  "https://user:pass@github.com/Athen2045/AniStream/releases/tag/v0.1.4",
])("rejects release URL %s", (html_url) => {
  expect(parseRelease({ ...release(), html_url }).kind).toBe("invalid-response");
});
it.each(
  [
    [],
    [{ ...release().assets[0], name: "AniStream.Setup.0.1.4.exe" }],
    [{ ...release().assets[0], size: 0 }],
    [{ ...release().assets[0], state: "starter" }],
  ].map((assets) => ({ assets })),
)("requires an uploaded compatible installer %#", async ({ assets }) => {
  expect(
    await setup(vi.fn<typeof fetch>().mockResolvedValue(json({ ...release(), assets }))).check(),
  ).toMatchObject({ kind: "unavailable", reason: "no-compatible-release" });
});
it("accepts a tag without a v prefix", () => {
  expect(
    parseRelease({
      ...release(),
      tag_name: "0.1.4",
      html_url: `${RELEASE_REPOSITORY}/releases/tag/0.1.4`,
    }).kind,
  ).toBe("release");
});
it.each([
  [404, "no-release"],
  [403, "rate-limited"],
  [429, "rate-limited"],
  [500, "network"],
  [302, "invalid-response"],
])("reports HTTP %s truthfully", async (status, reason) => {
  expect(
    await setup(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: Number(status) })),
    ).check(),
  ).toMatchObject({ kind: "unavailable", reason });
});
it("reports offline and malformed or oversized bodies as unavailable", async () => {
  expect(
    await setup(vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"))).check(),
  ).toMatchObject({ reason: "network" });
  for (const response of [
    new Response("{"),
    new Response("x".repeat(512 * 1024 + 1)),
    json(release(), { "content-length": "600000" }),
    new Response(new Uint8Array([0xff])),
  ]) {
    expect(await setup(vi.fn<typeof fetch>().mockResolvedValue(response)).check()).toMatchObject({
      kind: "unavailable",
      reason: "invalid-response",
    });
  }
});
it.each([false, true])(
  "times out the entire request including a slow body (%s)",
  async (slowBody) => {
    vi.useFakeTimers();
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        slowBody
          ? Promise.resolve(new Response(new ReadableStream({ start() {} })))
          : new Promise(() => {}),
      );
    const pending = setup(transport).check();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await pending).toMatchObject({ kind: "unavailable", reason: "timeout" });
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  },
);
it("deduplicates concurrent checks and never bypasses the minimum interval", async () => {
  vi.useFakeTimers();
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => json(release()));
  const checker = setup(transport);
  const first = checker.check();
  expect(checker.check()).toBe(first);
  const result = await first;
  await vi.advanceTimersByTimeAsync(59_999);
  expect(await checker.check()).toBe(result);
  expect(transport).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await checker.check();
  expect(transport).toHaveBeenCalledTimes(2);
});
it.each([200, 429])("honors the later cooldown on HTTP %s", async (status) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
  const headers = {
    "retry-after": "120",
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": String(Date.now() / 1000 + 180),
  };
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify(release()), { status, headers }));
  const checker = setup(transport);
  expect(await checker.check()).toMatchObject({ retryAt: "2026-09-09T00:03:00.000Z" });
  await vi.advanceTimersByTimeAsync(179_999);
  await checker.check();
  expect(transport).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await checker.check();
  expect(transport).toHaveBeenCalledTimes(2);
});
it("honors HTTP dates and ignores invalid cooldown headers", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
  for (const [header, expected] of [
    ["Wed, 09 Sep 2026 00:05:00 GMT", "00:05"],
    ["nonsense", "00:01"],
  ]) {
    expect(
      await setup(
        vi.fn<typeof fetch>().mockResolvedValue(json(release(), { "retry-after": header })),
      ).check(),
    ).toMatchObject({ retryAt: `2026-09-09T${expected}:00.000Z` });
  }
});
it("aborts on disposal and sends no late event", async () => {
  const onChange = vi.fn();
  const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
  const checker = new UpdateChecker({
    currentVersion: "0.1.3",
    target: "mac-arm64",
    fetch: transport,
    onChange,
  });
  const pending = checker.check();
  checker.dispose();
  await pending;
  expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(onChange).toHaveBeenCalledTimes(1);
  await checker.check();
  expect(transport).toHaveBeenCalledTimes(1);
});
it("does not request updates for unsupported builds or during recovery", async () => {
  const transport = vi.fn<typeof fetch>();
  expect(await setup(transport, { target: undefined }).check()).toMatchObject({
    reason: "unsupported-build",
  });
  expect(await setup(transport, { currentVersion: "0.1.4-beta" }).check()).toMatchObject({
    reason: "unsupported-build",
  });
  const recovery = {
    kind: "crash-detected",
    currentVersion: "0.1.4",
    lastGoodVersion: "0.1.3",
    lastGoodReleaseUrl: `${RELEASE_REPOSITORY}/releases/tag/v0.1.3`,
  } as const;
  const checker = new UpdateChecker({
    currentVersion: "0.1.4",
    target: "win-x64",
    recovery,
    fetch: transport,
  });
  expect(await checker.check()).toEqual(recovery);
  expect(transport).not.toHaveBeenCalled();
});
it("rejects unexpected arguments on both update IPC endpoints", () => {
  for (const channel of ["app:update-status", "app:check-updates"] as const) {
    expect(ipcArgValidators[channel]([])).toEqual([]);
    expect(() => ipcArgValidators[channel](["https://evil.test"])).toThrow();
  }
});
