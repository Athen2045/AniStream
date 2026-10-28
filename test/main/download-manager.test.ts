import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadManager, episodeFolder } from "../../src/main/downloads/download-manager";
import { createDownloadStore } from "../../src/main/downloads/download-store";
import {
  chooseAudio,
  chooseVariant,
  localMasterPlaylist,
  parseMasterPlaylist,
  planMediaPlaylist,
} from "../../src/main/downloads/hls-download-plan";
import { ipcArgValidators } from "../../src/main/ipc-validation";
import {
  estimateDownloadBytes,
  parseDownloadChange,
  projectDownloadBytes,
} from "../../src/shared/downloads";

const BASE = "https://cdn.example/show/ep1/";
const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Hindi",LANGUAGE="hi",DEFAULT=NO,URI="audio/hi.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",LANGUAGE="ja",DEFAULT=NO,URI="audio/ja.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=946000,RESOLUTION=640x360,AUDIO="aud"
v360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2376000,RESOLUTION=1280x720,AUDIO="aud"
v720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3476000,RESOLUTION=1920x1080,AUDIO="aud"
v1080.m3u8
`;
const media = (prefix: string) => `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k1",IV=0x01
#EXTINF:6.0,
${prefix}-a
#EXTINF:6.0,
${prefix}-b
#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k2",IV=0x02
#EXTINF:4.0,
${prefix}-c
#EXT-X-ENDLIST
`;

describe("HLS download plan", () => {
  it("picks the quality, keeps default + Japanese + English audio, and keeps keys as keys", () => {
    const master = parseMasterPlaylist(MASTER, `${BASE}master.m3u8`);
    expect(chooseVariant(master.variants, "720p").height).toBe(720);
    expect(chooseVariant(master.variants, "1080p").height).toBe(1080);
    const variant = chooseVariant(master.variants, "360p");
    expect(variant.uri).toBe(`${BASE}v360.m3u8`);
    const audio = chooseAudio(master, variant);
    expect(audio.map((rendition) => rendition.language)).toEqual(["en", "ja"]);

    const plan = planMediaPlaylist(media("seg"), variant.uri, "video");
    expect(plan.durationSeconds).toBe(16);
    expect(plan.files.map((file) => file.path)).toEqual([
      "video/k001.key",
      "video/s00001.ts",
      "video/s00002.ts",
      "video/k002.key",
      "video/s00003.ts",
    ]);
    // The key tags stay, pointing at the local key files: nothing is decrypted.
    expect(plan.text).toContain('#EXT-X-KEY:METHOD=AES-128,URI="k001.key",IV=0x01');
    expect(plan.text).not.toContain("https://");

    const local = localMasterPlaylist(
      variant,
      audio.map((rendition, index) => ({ rendition, folder: `audio-${index + 1}` })),
      "video",
    );
    expect(local).toContain('URI="audio-1/index.m3u8"');
    expect(local).toContain('AUDIO="audio"');
    expect(local).toContain("video/index.m3u8");
    expect(local).not.toContain("https://");
  });

  it("refuses live playlists and protections other than AES-128", () => {
    expect(() => planMediaPlaylist("#EXTM3U\n#EXTINF:6,\na\n", `${BASE}v.m3u8`, "video")).toThrow(
      /live stream/,
    );
    expect(() =>
      planMediaPlaylist(
        '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n#EXTINF:6,\na\n#EXT-X-ENDLIST\n',
        `${BASE}v.m3u8`,
        "video",
      ),
    ).toThrow(/protection/);
    expect(() => parseMasterPlaylist("<html>", `${BASE}m.m3u8`)).toThrow(/not an HLS/);
  });
});

describe("download requests", () => {
  it("validates adds and settings", () => {
    expect(
      parseDownloadChange({ op: "add", episodes: [{ aniListId: 1, episode: 2, title: "Show" }] }),
    ).toEqual({ op: "add", episodes: [{ aniListId: 1, episode: 2, title: "Show" }] });
    expect(parseDownloadChange({ op: "add", episodes: [] })).toBeUndefined();
    expect(parseDownloadChange({ op: "settings", limitBytes: 100 })).toBeUndefined();
    expect(parseDownloadChange({ op: "settings", quality: "4k" })).toBeUndefined();
    expect(parseDownloadChange({ op: "remove", id: "../x" })).toBeUndefined();
    expect(() => ipcArgValidators["downloads:apply"]([{ op: "add", episodes: [] }])).toThrow(
      /malformed/,
    );
    expect(estimateDownloadBytes(24, "1080p")).toBeGreaterThan(estimateDownloadBytes(24, "360p"));
  });

  it("names episode folders safely", () => {
    expect(
      episodeFolder(path.join("C:", "Root"), {
        aniListId: 9,
        episode: 3,
        title: 'Re:Zero <"S2">.',
      }),
    ).toBe(path.join("C:", "Root", "Re Zero S2 (9)", "Episode 003"));
  });
});

describe("download sizes", () => {
  // Bytes of finished episodes measured 2026-10-27 (Japanese and English audio kept); AniList lists
  // all three titles at 24 minutes (Frieren runs 26).
  const measured = {
    "360p": [141_376_656, 140_050_560, 142_489_558],
    "720p": [329_095_392, 247_594_176, 229_413_408],
    "1080p": [558_387_712, 379_759_760, 355_803_688],
  } as const;

  it("estimates at or just above the largest measured episode, not double it", () => {
    for (const [quality, sizes] of Object.entries(measured)) {
      const estimate = estimateDownloadBytes(24, quality as keyof typeof measured);
      expect(estimate).toBeGreaterThanOrEqual(Math.max(...sizes));
      expect(estimate).toBeLessThan(Math.max(...sizes) * 1.2);
    }
  });

  it("projects the real size from the files fetched so far, once there are enough", () => {
    expect(projectDownloadBytes(700, 7, 100, 50_000)).toBe(50_000);
    expect(projectDownloadBytes(800, 8, 100, 50_000)).toBe(10_000);
    // A short episode with fewer files than the sample projects once all are in.
    expect(projectDownloadBytes(500, 5, 5, 50_000)).toBe(500);
    expect(projectDownloadBytes(0, 0, 0, 123)).toBe(123);
  });
});

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function setup(
  options: {
    limitBytes?: number;
    fail?: (url: string) => number | undefined;
    /** Redirect target for a URL, answered as a 302. */
    redirect?: (url: string) => string | undefined;
    /** The device's connection, flipped by the test; requests throw while it is false. */
    network?: { online: boolean };
  } = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), "anistream-downloads-"));
  directories.push(root);
  const store = createDownloadStore(
    (() => {
      const db = new Database(":memory:");
      db.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      return db;
    })(),
  );
  if (options.limitBytes)
    store.saveSettings({ folder: root, limitBytes: options.limitBytes, quality: "720p" });
  const requests: string[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (options.network && !options.network.online) throw new TypeError("fetch failed");
    requests.push(url);
    const status = options.fail?.(url);
    if (status) return new Response("no", { status });
    const location = options.redirect?.(url);
    if (location) return new Response(null, { status: 302, headers: { Location: location } });
    const files: Record<string, string> = {
      [`${BASE}master.m3u8`]: MASTER,
      [`${BASE}v720.m3u8`]: media("v"),
      [`${BASE}v1080.m3u8`]: media("v"),
      [`${BASE}audio/en.m3u8`]: media("en"),
      [`${BASE}audio/ja.m3u8`]: media("ja"),
    };
    const body = files[url] ?? `bytes:${url}`;
    return new Response(body, { status: 200 });
  });
  const changed = vi.fn();
  const manager = new DownloadManager({
    store,
    defaultFolder: root,
    resolve: async () => ({
      src: `${BASE}master.m3u8`,
      headers: {},
      subtitles: [
        { label: "English", language: "en", default: true, url: "https://subs.example/en.ass" },
      ],
      fonts: ["https://subs.example/font.ttf"],
      subtitle: async () => ({ format: "ass", text: "[Script Info]\n[Events]\n", vtt: "WEBVTT" }),
    }),
    fetcher: fetcher as unknown as typeof fetch,
    lookup: async () => ["93.184.216.34"],
    ...(options.network ? { isOnline: () => options.network!.online, onlinePollMs: 10 } : {}),
    onChange: changed,
  });
  return { root, store, manager, fetcher, requests, changed };
}

async function settle(manager: DownloadManager): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    const state = await manager.state();
    if (state.items.every((item) => item.status !== "queued" && item.status !== "downloading"))
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Downloads did not settle.");
}

describe("download manager", () => {
  it("downloads an episode as encrypted segments, keys, playlists and a manifest", async () => {
    const { root, manager } = setup();
    const result = await manager.add([{ aniListId: 5, episode: 1, title: "Show", minutes: 24 }]);
    expect(result.added).toBe(1);
    await settle(manager);
    const [item] = (await manager.state()).items;
    expect(item).toMatchObject({ status: "done", audio: ["en", "ja"], quality: "1080p" });
    const folder = path.join(root, "Show (5)", "Episode 001");
    expect(readdirSync(folder).sort()).toEqual(
      ["audio-1", "audio-2", "episode.json", "fonts", "master.m3u8", "subs", "video"].sort(),
    );
    // Segments are written exactly as served (the stream's own encrypted bytes).
    expect(readFileSync(path.join(folder, "video", "s00001.ts"), "utf8")).toBe(
      "bytes:https://cdn.example/show/ep1/v-a",
    );
    expect(readFileSync(path.join(folder, "video", "k001.key"), "utf8")).toBe(
      "bytes:https://keys.example/k1",
    );
    const offline = await manager.offlineEpisode(5, 1);
    expect(offline).toMatchObject({ master: "master.m3u8", fonts: ["fonts/f1.ttf"] });
    expect(offline?.subtitles[0]).toMatchObject({ format: "ass", file: "subs/1.ass" });
    expect(manager.filePath(item!.id, "video/s00001.ts")).toBe(
      path.join(folder, "video", "s00001.ts"),
    );
    expect(manager.filePath(item!.id, "../../escape.txt")).toBeUndefined();
    // Parallel workers must not lose counts: the recorded size is what is on disk.
    const onDisk = ["video", "audio-1", "audio-2", "fonts"]
      .flatMap((sub) =>
        readdirSync(path.join(folder, sub)).map((name) => path.join(folder, sub, name)),
      )
      .filter((file) => !file.endsWith(".m3u8"))
      .reduce((sum, file) => sum + readFileSync(file).length, 0);
    expect(item!.bytesDone).toBe(onDisk);
  });

  it("fetches without cookies and follows redirects itself", async () => {
    const { manager, fetcher } = setup();
    await manager.add([{ aniListId: 5, episode: 1, title: "Show", minutes: 24 }]);
    await settle(manager);
    expect(fetcher.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetcher.mock.calls) {
      const init = (call as unknown[])[1] as RequestInit | undefined;
      expect(init).toMatchObject({ redirect: "manual", credentials: "omit" });
    }
  });

  it("fails an episode whose segments redirect into the local network", async () => {
    const { manager, requests } = setup({
      redirect: (url) => (url === `${BASE}v-a` ? "https://192.168.1.1/admin" : undefined),
    });
    await manager.add([{ aniListId: 5, episode: 1, title: "Show", minutes: 24 }]);
    await settle(manager);
    const [item] = (await manager.state()).items;
    expect(item?.status).toBe("failed");
    expect(requests.some((url) => url.includes("192.168."))).toBe(false);
  });

  it("skips files already on disk when an episode resumes", async () => {
    const { manager, requests } = setup();
    await manager.add([{ aniListId: 5, episode: 1, title: "Show" }]);
    await settle(manager);
    const [item] = (await manager.state()).items;
    // Pretend it was interrupted: resume should not fetch any segment again.
    const store = (
      manager as unknown as { deps: { store: ReturnType<typeof createDownloadStore> } }
    ).deps.store;
    store.update(item!.id, { status: "queued" });
    requests.length = 0;
    manager.start();
    await settle(manager);
    expect(requests.filter((url) => /-[abc]$/.test(url))).toEqual([]);
  });

  it("fetches video and audio interleaved and ends with the size actually written", async () => {
    const { manager, requests } = setup();
    await manager.add([{ aniListId: 5, episode: 1, title: "Show", minutes: 24 }]);
    await settle(manager);
    const segments = requests
      .map((url) => url.match(/\/(v|en|ja)-[abc]$/)?.[1])
      .filter((kind): kind is string => kind !== undefined);
    // The first video segment is followed by the audio ones, not by the rest of the video.
    expect(new Set(segments.slice(0, 3))).toEqual(new Set(["v", "en", "ja"]));
    const [item] = (await manager.state()).items;
    expect(item?.bytesExpected).toBe(item?.bytesDone);
  });

  it("stops at the storage limit and never deletes anything to make room", async () => {
    const tiny = 1024 ** 3;
    const { manager } = setup({ limitBytes: tiny });
    const result = await manager.add(
      Array.from({ length: 10 }, (_, index) => ({
        aniListId: 7,
        episode: index + 1,
        title: "Long",
        minutes: 24,
      })),
    );
    // 720p is estimated at ~320 MB per 24 minutes: only three fit in 1 GB.
    expect(result.added).toBe(3);
    expect(result.message).toMatch(/do not fit in your 1\.0 GB download limit/);
    const again = await manager.add([{ aniListId: 7, episode: 1, title: "Long" }]);
    expect(again).toMatchObject({ added: 0, skipped: 1 });
  });

  it("waits for the connection instead of failing, then continues by itself", async () => {
    const network = { online: true };
    const { manager, requests } = setup({ network });
    // The connection drops once the first video segment is in.
    const original = requests.push.bind(requests);
    requests.push = (url: string) => {
      if (url.endsWith("v-a")) network.online = false;
      return original(url);
    };
    await manager.add([{ aniListId: 5, episode: 3, title: "Show", minutes: 24 }]);
    await vi.waitFor(async () => {
      const [item] = (await manager.state()).items;
      expect(item).toMatchObject({ status: "queued", error: "Waiting for a connection" });
    });
    network.online = true;
    await settle(manager);
    const [item] = (await manager.state()).items;
    expect(item).toMatchObject({ status: "done" });
    expect(item?.error).toBeUndefined();
    // The segment saved before the drop is not fetched again.
    expect(requests.filter((url) => url.endsWith("v-a"))).toHaveLength(1);
  });

  it("stops an episode on 403/429 without retrying and lets it resume later", async () => {
    let refuse = true;
    const { manager, requests } = setup({
      fail: (url) => (refuse && url.endsWith("v-b") ? 429 : undefined),
    });
    await manager.add([{ aniListId: 5, episode: 2, title: "Show" }]);
    await settle(manager);
    const [failed] = (await manager.state()).items;
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed?.error).toMatch(/refused the download \(429\)/);
    expect(requests.filter((url) => url.endsWith("v-b"))).toHaveLength(1);
    refuse = false;
    await manager.apply({ op: "retry", id: failed!.id });
    await settle(manager);
    expect((await manager.state()).items[0]).toMatchObject({ status: "done" });
  });

  it("removes a download and its files", async () => {
    const { root, manager } = setup();
    await manager.add([{ aniListId: 5, episode: 1, title: "Show" }]);
    await settle(manager);
    const [item] = (await manager.state()).items;
    await manager.apply({ op: "remove", id: item!.id });
    expect((await manager.state()).items).toEqual([]);
    expect(existsSync(path.join(root, "Show (5)"))).toBe(false);
    expect(await manager.offlineEpisode(5, 1)).toBeUndefined();
  });
});
