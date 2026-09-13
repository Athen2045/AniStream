import type { UpdateStatus, UpdateUnavailableReason } from "../shared/update-check";
import {
  newerVersion,
  parseRelease,
  RELEASE_ENDPOINT,
  stableVersion,
  type UpdateTarget,
} from "./update-release";

const MAX_BYTES = 512 * 1024;
const MIN_INTERVAL = 60_000;
interface Options {
  currentVersion: string;
  target?: UpdateTarget;
  recovery?: Extract<UpdateStatus, { kind: "crash-detected" }>;
  fetch?: typeof fetch;
  now?: () => number;
  onChange?: (state: UpdateStatus) => void;
}

export class UpdateChecker {
  private state: UpdateStatus;
  private inFlight: Promise<UpdateStatus> | undefined;
  private controller: AbortController | undefined;
  private retryAt = 0;
  private disposed = false;
  private readonly now: () => number;
  private readonly transport: typeof fetch;

  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
    this.transport = options.fetch ?? fetch;
    this.state =
      options.recovery ??
      (!options.target || !stableVersion(options.currentVersion)
        ? {
            kind: "unavailable",
            currentVersion: options.currentVersion,
            reason: "unsupported-build",
          }
        : { kind: "idle", currentVersion: options.currentVersion });
  }
  getStatus(): UpdateStatus {
    return this.state;
  }
  check(): Promise<UpdateStatus> {
    if (
      this.disposed ||
      this.state.kind === "crash-detected" ||
      (this.state.kind === "unavailable" && this.state.reason === "unsupported-build")
    )
      return Promise.resolve(this.state);
    if (this.inFlight) return this.inFlight;
    if (this.now() < this.retryAt) return Promise.resolve(this.state);
    this.retryAt = this.now() + MIN_INTERVAL;
    this.setState({ kind: "checking", currentVersion: this.options.currentVersion });
    this.inFlight = this.request().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }
  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
  }
  private setState(state: UpdateStatus): UpdateStatus {
    if (!this.disposed) {
      this.state = state;
      this.options.onChange?.(state);
    }
    return state;
  }
  private async request(): Promise<UpdateStatus> {
    const controller = new AbortController();
    this.controller = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12_000);
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new Error("Update request aborted.")),
        { once: true },
      );
    });
    const unavailable = (reason: UpdateUnavailableReason): UpdateStatus => ({
      kind: "unavailable",
      currentVersion: this.options.currentVersion,
      reason,
      checkedAt: new Date(this.now()).toISOString(),
      retryAt: new Date(this.retryAt).toISOString(),
    });
    try {
      const response = await Promise.race([
        this.transport(RELEASE_ENDPOINT, {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": `AniStream/${this.options.currentVersion} (+https://github.com/Athen2045/AniStream)`,
          },
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal,
        }),
        aborted,
      ]);
      this.retryAt = cooldown(response.headers, this.now(), this.retryAt);
      if (
        (response.url && response.url !== RELEASE_ENDPOINT) ||
        response.redirected ||
        (response.status >= 300 && response.status < 400)
      )
        return this.setState(unavailable("invalid-response"));
      if (response.status === 403 || response.status === 429)
        return this.setState(unavailable("rate-limited"));
      if (response.status === 404) return this.setState(unavailable("no-release"));
      if (!response.ok) return this.setState(unavailable("network"));
      let payload: unknown;
      try {
        payload = await Promise.race([readJson(response), aborted]);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        return this.setState(unavailable("invalid-response"));
      }
      const release = parseRelease(payload, this.options.target!);
      if (release.kind !== "release") return this.setState(unavailable(release.kind));
      const times = {
        currentVersion: this.options.currentVersion,
        checkedAt: new Date(this.now()).toISOString(),
        retryAt: new Date(this.retryAt).toISOString(),
      };
      return this.setState(
        newerVersion(release.version, stableVersion(this.options.currentVersion)!)
          ? {
              kind: "update-available",
              ...times,
              version: release.version,
              releaseUrl: release.releaseUrl,
            }
          : { kind: "up-to-date", ...times },
      );
    } catch {
      return this.setState(unavailable(timedOut ? "timeout" : "network"));
    } finally {
      clearTimeout(timer);
      controller.abort();
      this.controller = undefined;
    }
  }
}

function cooldown(headers: Headers, now: number, minimum: number): number {
  let deadline = minimum;
  const retry = headers.get("retry-after");
  if (retry) {
    const parsed = /^\d+(\.\d+)?$/.test(retry.trim())
      ? now + Number(retry) * 1000
      : Date.parse(retry);
    if (Number.isFinite(parsed) && parsed <= 8.64e15) deadline = Math.max(deadline, parsed);
  }
  if (headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(headers.get("x-ratelimit-reset")) * 1000;
    if (Number.isFinite(reset) && reset <= 8.64e15) deadline = Math.max(deadline, reset);
  }
  return deadline;
}

async function readJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_BYTES || !response.body)
    throw new Error("Invalid release body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("Release response too large.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
