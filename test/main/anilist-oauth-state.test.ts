import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  loadSession: vi.fn(),
  saveSession: vi.fn(async () => undefined),
  deleteSession: vi.fn(async () => undefined),
  isMissingFileError: () => false,
}));
const opened = vi.hoisted(() => [] as string[]);
vi.mock("electron", () => ({
  shell: { openExternal: vi.fn(async (url: string) => void opened.push(url)) },
}));
vi.mock("../../src/main/anilist/session-store", () => session);

const { AniListClient } = await import("../../src/main/anilist/client");

const viewerResponse = () =>
  Response.json({
    data: {
      Viewer: {
        id: 7,
        name: "Viewer",
        avatar: { large: "https://s4.anilist.co/file/anilistcdn/user/avatar/large/b7.png" },
        bannerImage: null,
        siteUrl: "https://anilist.co/user/Viewer",
        statistics: {
          anime: { count: 1, episodesWatched: 1, minutesWatched: 24 },
          manga: { count: 0, chaptersRead: 0, volumesRead: 0 },
        },
      },
    },
  });

const callback = (state?: string, token = "token-1") =>
  `anistream://auth/anilist#access_token=${token}&token_type=Bearer&expires_in=31536000${
    state === undefined ? "" : `&state=${encodeURIComponent(state)}`
  }`;

describe("AniList sign-in state (audit finding 12)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    opened.length = 0;
    session.saveSession.mockClear();
    fetchMock = vi.fn(async () => viewerResponse());
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function startedLogin() {
    const emit = vi.fn();
    const client = new AniListClient("session.bin", emit);
    await client.startLogin();
    const state = new URL(opened.at(-1)!).searchParams.get("state")!;
    return { client, emit, state };
  }

  it("sends a fresh random state with each sign-in", async () => {
    const first = await startedLogin();
    const second = await startedLogin();
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(second.state).not.toBe(first.state);
  });

  it("signs in only with the callback that carries this sign-in's state", async () => {
    const { client, state } = await startedLogin();
    await client.handleCallback(callback(state));
    expect(client.getState()).toMatchObject({ status: "signed-in", profile: { id: 7 } });
    expect(session.saveSession).toHaveBeenCalled();
  });

  it("ignores a forged callback and keeps the real sign-in going", async () => {
    const { client, state } = await startedLogin();
    for (const forged of [
      callback(undefined, "evil"),
      callback("guess", "evil"),
      callback(`${state}x`, "evil"),
    ])
      await client.handleCallback(forged);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.getState()).toEqual({ status: "authorizing" });

    await client.handleCallback(callback(state));
    expect(client.getState()).toMatchObject({ status: "signed-in" });
  });

  it("accepts a state only once, and none when no sign-in is pending", async () => {
    const { client, state } = await startedLogin();
    await client.handleCallback(callback(state));
    session.saveSession.mockClear();
    await client.handleCallback(callback(state, "replayed"));
    expect(session.saveSession).not.toHaveBeenCalled();

    const idle = new AniListClient("session.bin", vi.fn());
    await idle.handleCallback(callback("anything"));
    expect(idle.getState()).toEqual({ status: "signed-out" });
  });
});
