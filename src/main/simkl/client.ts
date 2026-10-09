import { createHash, randomBytes } from "node:crypto";
import type { SimklAuthState } from "../../shared/contracts";
import { AuthorizationTransaction } from "../anilist/authorization-transaction";
import { createRequestGate, type RequestGate } from "../anilist/request-queue";
import { ProviderTransport } from "../provider-transport";

// Public AUTH V2 client ("Mobile, desktop & browser apps"): PKCE only, no client secret exists.
// Warning: never put a client secret or a token beside it.
export const SIMKL_CLIENT_ID = "92202fe5177e1108fd83c35004445a7adb5b0acc4e4293c20f6af6c7b4ac4753";
export const SIMKL_REDIRECT_URI = "anistream://auth/simkl";
const AUTHORIZE_URL = "https://simkl.com/oauth2/authorize";
const ISSUER = "https://simkl.com";
const API_URL = "https://api.simkl.com";
const APP_NAME = "anistream";
// Write lets "+" set Plan to Watch / Completed; reads stay the default use.
const SCOPE = "media:read media:write";
const AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** Refresh this long before the 7-day access token expires. */
const REFRESH_MARGIN_MS = 24 * 60 * 60_000;
const DEFAULT_RETRY_AFTER_MS = 60 * 60_000;
const PROFILE_TTL_MS = 24 * 60 * 60_000;

export interface SimklSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  userName?: string;
  /** Granted scope as Simkl reported it; older read-only grants lack `media:write`. */
  scope?: string;
  accountId?: number;
  /** `free`, `pro` or `vip`; Custom Lists need PRO or VIP. */
  accountType?: string;
  /** The viewer's Simkl picture (`simkl.in/avatars/...`, 512 px). */
  avatarUrl?: string;
  /** ISO time the Simkl account was created. */
  joinedAt?: string;
  /** Epoch ms of the last `/users/settings` read; the profile refreshes at most daily. */
  profileCheckedAt?: number;
}

/** Encrypted session persistence; the Electron implementation lives in `session-file.ts`. */
export interface SimklSessionStorage {
  load(): Promise<SimklSession | undefined>;
  save(session: SimklSession): Promise<void>;
  remove(): Promise<void>;
}

export interface SimklClientOptions {
  appVersion: string;
  storage: SimklSessionStorage;
  openExternal: (url: string) => Promise<void>;
  emitState: (state: SimklAuthState) => void;
  fetcher?: typeof fetch;
  now?: () => number;
}

export class SimklUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SimklUnavailableError";
  }
}

/**
 * Simkl AUTH V2 (authorization code + PKCE) and authenticated reads. This process is the single
 * owner of the grant: it alone refreshes, so no second copy can invalidate the access token.
 */
export class SimklClient {
  private session?: SimklSession;
  private pkce?: { verifier: string; state: string };
  private refreshing?: Promise<SimklSession>;
  private lastError?: string;
  private readonly authorization: AuthorizationTransaction;
  private readonly gate: RequestGate;
  private readonly transport: ProviderTransport;
  private readonly now: () => number;
  private readonly userAgent: string;

  public constructor(private readonly options: SimklClientOptions) {
    this.now = options.now ?? Date.now;
    this.userAgent = `AniStream/${options.appVersion}`;
    // Simkl allows 10 GET and 1 POST per second; one request per second stays well inside both.
    this.gate = createRequestGate({ requestsPerMinute: 60, minIntervalMs: 1_000 });
    this.transport = new ProviderTransport({
      gate: this.gate,
      fetcher: options.fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: { Accept: "application/json", "User-Agent": this.userAgent },
    });
    this.authorization = new AuthorizationTransaction({
      timeoutMs: AUTHORIZATION_TIMEOUT_MS,
      onTimeout: () => {
        this.pkce = undefined;
        this.publish("Simkl sign-in timed out. Start it again when you are ready.");
      },
    });
  }

  public static isCallback(url: string): boolean {
    return url.startsWith(SIMKL_REDIRECT_URI);
  }

  public get connected(): boolean {
    return Boolean(this.session);
  }

  public async restore(): Promise<SimklAuthState> {
    try {
      this.session = await this.options.storage.load();
    } catch {
      this.session = undefined;
      this.lastError = "AniStream could not restore the saved Simkl connection. Connect it again.";
    }
    return this.getState();
  }

  public getState(): SimklAuthState {
    if (this.authorization.active) return { status: "authorizing" };
    if (this.session)
      return {
        status: "connected",
        userName: this.session.userName,
        canWrite: (this.session.scope ?? "").split(" ").includes("media:write"),
        premium: this.session.accountType === "pro" || this.session.accountType === "vip",
        avatarUrl: this.session.avatarUrl,
        joinedAt: this.session.joinedAt,
      };
    if (this.lastError) return { status: "error", message: this.lastError };
    return { status: "disconnected" };
  }

  public async startLogin(): Promise<void> {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(16).toString("base64url");
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", SIMKL_CLIENT_ID);
    url.searchParams.set("redirect_uri", SIMKL_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set(
      "code_challenge",
      createHash("sha256").update(verifier).digest("base64url"),
    );
    url.searchParams.set("code_challenge_method", "S256");
    this.authorization.begin();
    this.pkce = { verifier, state };
    this.lastError = undefined;
    this.publish();
    try {
      await this.options.openExternal(url.toString());
    } catch (error) {
      this.authorization.cancel();
      this.pkce = undefined;
      this.publish(error instanceof Error ? error.message : "Simkl sign-in could not be started.");
      throw error;
    }
  }

  /** Completes sign-in from `anistream://auth/simkl?code=…&state=…&iss=…`. */
  public async handleCallback(callbackUrl: string): Promise<void> {
    const pkce = this.pkce;
    // Reconnecting (for example to grant write access) keeps the old grant until the new one works.
    const previous = this.session;
    try {
      const result = await this.authorization.handleCallback(async (signal) => {
        const url = new URL(callbackUrl);
        if (`${url.protocol}//${url.host}${url.pathname}` !== SIMKL_REDIRECT_URI)
          throw new Error("AniStream received an invalid Simkl callback.");
        const params = url.searchParams;
        // Mix-up defence (RFC 9207): the response must come from Simkl itself.
        if (params.get("iss") !== ISSUER)
          throw new Error("The sign-in response did not come from Simkl.");
        if (!pkce || params.get("state") !== pkce.state)
          throw new Error("The Simkl sign-in response did not match this request. Try again.");
        const error = params.get("error");
        if (error)
          throw new Error(
            error === "access_denied"
              ? "Simkl sign-in was cancelled."
              : `Simkl sign-in failed (${error}).`,
          );
        const code = params.get("code");
        if (!code) throw new Error("Simkl did not return an authorization code.");
        // The code is consumed even when the exchange fails, so it is never retried.
        const tokens = await this.tokenRequest(
          {
            grant_type: "authorization_code",
            client_id: SIMKL_CLIENT_ID,
            code,
            redirect_uri: SIMKL_REDIRECT_URI,
            code_verifier: pkce.verifier,
          },
          signal,
        );
        const session: SimklSession = { ...tokens };
        this.session = session;
        Object.assign(session, await this.fetchProfile(signal).catch(() => ({})));
        if (signal.aborted) throw new DOMException("Simkl sign-in was cancelled.", "AbortError");
        await this.options.storage.save(session);
      });
      if (!result.handled) return;
      if (previous) void this.revoke(previous.refreshToken);
      this.lastError = undefined;
      this.publish();
    } catch (error) {
      this.session = previous;
      this.publish(error instanceof Error ? error.message : "Simkl sign-in failed.");
    } finally {
      this.pkce = undefined;
    }
  }

  public cancelLogin(): void {
    if (!this.authorization.cancel()) return;
    this.pkce = undefined;
    this.publish();
  }

  /** Forgets the grant locally and asks Simkl to revoke it; revoke has no success signal. */
  public async logout(): Promise<void> {
    this.authorization.cancel();
    const session = this.session;
    this.session = undefined;
    this.lastError = undefined;
    await this.options.storage.remove();
    this.publish();
    if (session) await this.revoke(session.refreshToken);
  }

  /** Revoking either token ends the whole grant; Simkl always answers 200, so nothing is checked. */
  private async revoke(token: string): Promise<void> {
    await this.transport
      .request(new URL("/oauth2/revoke", API_URL), {
        method: "POST",
        dedupeKey: uniqueKey(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: SIMKL_CLIENT_ID, token }),
      })
      .catch(() => undefined);
  }

  /** Authenticated GET returning parsed JSON; refreshes once on expiry or a 401. */
  public async get(
    path: string,
    params: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    let session = await this.validSession(signal);
    let response = await this.send(path, params, session, signal);
    if (response.status === 401) {
      session = await this.refresh(session, signal);
      response = await this.send(path, params, session, signal);
      if (response.status === 401) {
        await this.expire("Simkl disconnected AniStream. Connect it again in Settings.");
        throw new SimklUnavailableError("Simkl rejected the saved connection.");
      }
    }
    if (!response.ok) throw new SimklUnavailableError(`Simkl request failed (${response.status}).`);
    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new SimklUnavailableError("Simkl returned an unreadable response.");
    }
  }

  /** Authenticated JSON POST (writes need the `media:write` scope); refreshes once on a 401. */
  public async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    let session = await this.validSession(signal);
    const send = (current: SimklSession): Promise<Response> =>
      this.transport.request(this.apiUrl(path, {}), {
        method: "POST",
        signal,
        dedupeKey: uniqueKey(),
        headers: {
          Authorization: `Bearer ${current.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        onResponse: (response, gate) => this.checkRateLimit(response, gate),
      });
    let response = await send(session);
    if (response.status === 401) {
      session = await this.refresh(session, signal);
      response = await send(session);
    }
    if (!response.ok) throw new SimklUnavailableError(`Simkl update failed (${response.status}).`);
    return response.json().catch(() => null) as Promise<unknown>;
  }

  /** Public CDN data files (Trending): required app parameters, never the user token. */
  public async getPublic(url: string, signal?: AbortSignal): Promise<unknown> {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.hostname !== "data.simkl.in")
      throw new SimklUnavailableError("Unexpected Simkl data host.");
    target.searchParams.set("client_id", SIMKL_CLIENT_ID);
    target.searchParams.set("app-name", APP_NAME);
    target.searchParams.set("app-version", this.options.appVersion);
    const response = await this.transport.request(target, {
      signal,
      onResponse: (result, gate) => this.checkRateLimit(result, gate),
    });
    if (!response.ok) throw new SimklUnavailableError(`Simkl data failed (${response.status}).`);
    return response.json() as Promise<unknown>;
  }

  private send(
    path: string,
    params: Record<string, string>,
    session: SimklSession,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = this.apiUrl(path, params);
    return this.transport.request(url, {
      signal,
      dedupeKey: `${session.accessToken.slice(-6)}:${url.toString()}`,
      headers: { Authorization: `Bearer ${session.accessToken}` },
      onResponse: (response, gate) => this.checkRateLimit(response, gate),
    });
  }

  private apiUrl(path: string, params: Record<string, string>): URL {
    const url = new URL(path, API_URL);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("client_id", SIMKL_CLIENT_ID);
    url.searchParams.set("app-name", APP_NAME);
    url.searchParams.set("app-version", this.options.appVersion);
    return url;
  }

  private checkRateLimit(response: Response, gate: RequestGate): void {
    if (response.status !== 429 && response.status !== 403) return;
    const seconds = Number(response.headers.get("retry-after"));
    // Stop on 429/403: the daily quota resets at midnight US Eastern, so wait it out.
    gate.reportRateLimited(
      Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS,
    );
    throw new SimklUnavailableError(
      response.status === 429
        ? "Simkl asked AniStream to slow down. Sync will resume later."
        : "Simkl refused the request (403).",
    );
  }

  private async validSession(signal?: AbortSignal): Promise<SimklSession> {
    const session = this.session;
    if (!session) throw new SimklUnavailableError("Simkl is not connected.");
    if (session.expiresAt - REFRESH_MARGIN_MS > this.now()) return session;
    return this.refresh(session, signal);
  }

  private refresh(session: SimklSession, signal?: AbortSignal): Promise<SimklSession> {
    this.refreshing ??= (async () => {
      try {
        const tokens = await this.tokenRequest(
          {
            grant_type: "refresh_token",
            client_id: SIMKL_CLIENT_ID,
            refresh_token: session.refreshToken,
          },
          signal,
        );
        const next = { ...session, ...tokens };
        this.session = next;
        await this.options.storage.save(next);
        return next;
      } catch (error) {
        if (error instanceof SimklGrantError)
          await this.expire("Simkl sign-in expired. Connect it again in Settings.");
        throw error;
      }
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async tokenRequest(
    body: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Pick<SimklSession, "accessToken" | "refreshToken" | "expiresAt" | "scope">> {
    const response = await this.transport.request(new URL("/oauth2/token", API_URL), {
      method: "POST",
      signal,
      dedupeKey: uniqueKey(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      onResponse: (result, gate) => this.checkRateLimit(result, gate),
    });
    const payload = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
      const error = isRecord(payload) && typeof payload.error === "string" ? payload.error : "";
      if (response.status === 400 || response.status === 401)
        throw new SimklGrantError(error || `Simkl sign-in failed (${response.status}).`);
      throw new SimklUnavailableError(`Simkl sign-in failed (${response.status}).`);
    }
    if (
      !isRecord(payload) ||
      typeof payload.access_token !== "string" ||
      typeof payload.refresh_token !== "string" ||
      !payload.access_token ||
      !payload.refresh_token
    )
      throw new SimklUnavailableError("Simkl returned an invalid token response.");
    const expiresIn =
      typeof payload.expires_in === "number" && payload.expires_in > 0
        ? payload.expires_in
        : 604_800;
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: this.now() + expiresIn * 1000,
      scope: typeof payload.scope === "string" ? payload.scope : undefined,
    };
  }

  /**
   * Re-reads the viewer's name and picture at most once a day (sessions saved before AniStream
   * showed the Simkl picture have none). Never throws.
   */
  public async refreshProfile(signal?: AbortSignal): Promise<void> {
    const session = this.session;
    if (!session || (session.profileCheckedAt ?? 0) + PROFILE_TTL_MS > this.now()) return;
    try {
      const profile = await this.fetchProfile(signal ?? new AbortController().signal);
      if (this.session !== session) return;
      Object.assign(session, profile);
      await this.options.storage.save(session);
      this.publish();
    } catch {
      // Keep the saved profile; the next sync tries again.
    }
  }

  /**
   * Public catalog GET (no token, so it never spends the viewer's daily quota). Simkl caches
   * these at its edge.
   */
  public async getCatalog(
    path: string,
    params: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await this.transport.request(this.apiUrl(path, params), {
      signal,
      onResponse: (result, gate) => this.checkRateLimit(result, gate),
    });
    if (!response.ok) throw new SimklUnavailableError(`Simkl request failed (${response.status}).`);
    return response.json() as Promise<unknown>;
  }

  /** Simkl's ID for a TMDB title, read from the documented `/redirect` helper's Location. */
  public async simklIdForTmdb(
    type: "MOVIE" | "TV",
    tmdbId: number,
    signal?: AbortSignal,
  ): Promise<number | undefined> {
    const response = await this.transport.request(
      this.apiUrl("/redirect", {
        to: "simkl",
        tmdb: String(tmdbId),
        type: type === "MOVIE" ? "movie" : "tv",
      }),
      {
        signal,
        redirect: "manual",
        onResponse: (result, gate) => this.checkRateLimit(result, gate),
      },
    );
    const location = response.headers.get("location") ?? "";
    const match = /^https:\/\/simkl\.com\/(?:movies|tv)\/(\d{1,9})(?:\/|$|\?)/.exec(location);
    return match ? Number(match[1]) : undefined;
  }

  private async fetchProfile(signal: AbortSignal): Promise<Partial<SimklSession>> {
    const payload = await this.get("/users/settings", {}, signal);
    const user = isRecord(payload) && isRecord(payload.user) ? payload.user : undefined;
    const account = isRecord(payload) && isRecord(payload.account) ? payload.account : undefined;
    return {
      avatarUrl: simklAvatarUrl(user?.avatar),
      joinedAt:
        typeof user?.joined_at === "string" && Number.isFinite(Date.parse(user.joined_at))
          ? new Date(user.joined_at).toISOString()
          : undefined,
      profileCheckedAt: this.now(),
      userName:
        typeof user?.name === "string" && user.name.trim()
          ? user.name.trim().slice(0, 80)
          : undefined,
      accountId:
        typeof account?.id === "number" && Number.isInteger(account.id) && account.id > 0
          ? account.id
          : undefined,
      accountType:
        typeof account?.type === "string" ? account.type.toLowerCase().slice(0, 20) : undefined,
    };
  }

  /** Simkl's own page for a TMDB title, through its documented `/redirect` helper (no token). */
  public titleLink(type: "MOVIE" | "TV", tmdbId: number): string {
    return this.apiUrl("/redirect", {
      to: "simkl",
      tmdb: String(tmdbId),
      type: type === "MOVIE" ? "movie" : "tv",
    }).toString();
  }

  /** The connected account's numeric ID, needed to read its own Custom Lists. */
  public get accountId(): number | undefined {
    return this.session?.accountId;
  }

  private async expire(message: string): Promise<void> {
    this.session = undefined;
    this.lastError = message;
    await this.options.storage.remove().catch(() => undefined);
    this.publish();
  }

  private publish(error?: string): void {
    if (error) this.lastError = error;
    this.options.emitState(this.getState());
  }
}

class SimklGrantError extends SimklUnavailableError {}

/** Simkl avatars live on `simkl.in/avatars/`; the 512 px size is requested for the profile. */
export function simklAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "simkl.in") return undefined;
    if (!/^\/avatars\/[\w/-]+\.jpg$/.test(url.pathname)) return undefined;
    url.pathname = url.pathname.replace(/(?:_(?:24|100|256|512))?\.jpg$/, "_512.jpg");
    url.search = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** POSTs must never be merged with another in-flight request (the gate dedupes by key). */
function uniqueKey(): string {
  return `post:${randomBytes(8).toString("hex")}`;
}
