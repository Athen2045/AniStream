import type { UpdateInstallFailure } from "../shared/update-check";
import { releaseDownloadBase } from "./update-release";

/** The slice of electron-updater's NsisUpdater this module drives (injected for tests). */
export interface UpdaterAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  disableDifferentialDownload: boolean;
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>;
  downloadUpdate(token: CancellationLike): Promise<unknown>;
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
  on(event: "download-progress", listener: (progress: DownloadProgress) => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
  removeAllListeners(): unknown;
}
export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
}
export interface CancellationLike {
  cancel(): void;
}
/** Creates an updater whose feed is the given per-release download base. */
export type UpdaterFactory = (
  feedUrl: string,
) => Promise<{ updater: UpdaterAdapter; createToken(): CancellationLike }>;

export type InstallState =
  | { phase: "idle" }
  | {
      phase: "downloading";
      version: string;
      percent: number;
      transferredBytes: number;
      totalBytes: number;
    }
  | { phase: "ready"; version: string }
  | { phase: "failed"; version: string; reason: UpdateInstallFailure };

interface Options {
  factory: UpdaterFactory;
  onChange?: (state: InstallState) => void;
  installOnQuit?: boolean;
  /** Minimum gap between forwarded progress events. */
  progressIntervalMs?: number;
  now?: () => number;
}

/**
 * Downloads and installs one verified Windows release. The feed is pinned to the exact release the
 * update checker validated; the updater's own `latest.yml` must name the same version, and its
 * SHA-512 is enforced by electron-updater. Nothing installs without `install()` unless the user
 * enabled install-on-quit.
 */
export class WindowsUpdateInstaller {
  private state: InstallState = { phase: "idle" };
  private updater: UpdaterAdapter | undefined;
  private token: CancellationLike | undefined;
  private inFlight: { version: string; promise: Promise<InstallState> } | undefined;
  private attempt = 0;
  private lastProgressAt = Number.NEGATIVE_INFINITY;
  private installOnQuit: boolean;
  private disposed = false;
  private readonly now: () => number;

  constructor(private readonly options: Options) {
    this.installOnQuit = options.installOnQuit ?? false;
    this.now = options.now ?? Date.now;
  }

  getState(): InstallState {
    return this.state;
  }

  download(version: string): Promise<InstallState> {
    if (this.disposed) return Promise.resolve(this.state);
    if (this.inFlight?.version === version) return this.inFlight.promise;
    if (this.state.phase === "ready" && this.state.version === version)
      return Promise.resolve(this.state);
    this.cancel();
    const attempt = ++this.attempt;
    const promise = this.run(version, attempt).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = undefined;
    });
    this.inFlight = { version, promise };
    return promise;
  }

  /** Stops an active download and returns to idle; a downloaded release stays ready. */
  cancel(): void {
    if (this.state.phase !== "downloading") return;
    this.attempt++;
    this.token?.cancel();
    this.release();
    this.inFlight = undefined;
    this.setState({ phase: "idle" });
  }

  /** Quits and runs the downloaded installer silently, reopening AniStream afterwards. */
  install(): boolean {
    if (this.disposed || this.state.phase !== "ready" || !this.updater) return false;
    this.updater.quitAndInstall(true, true);
    return true;
  }

  setInstallOnQuit(enabled: boolean): void {
    this.installOnQuit = enabled;
    if (this.updater) this.updater.autoInstallOnAppQuit = enabled;
  }

  /** App shutdown: stop a partial download. A ready update stays armed for install-on-quit. */
  dispose(): void {
    if (this.state.phase === "downloading") this.cancel();
    this.disposed = true;
  }

  private async run(version: string, attempt: number): Promise<InstallState> {
    const current = (): boolean => attempt === this.attempt && !this.disposed;
    this.lastProgressAt = Number.NEGATIVE_INFINITY;
    this.setState({
      phase: "downloading",
      version,
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0,
    });
    try {
      const { updater, createToken } = await this.options.factory(releaseDownloadBase(version));
      if (!current()) return this.state;
      this.release();
      this.updater = updater;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = this.installOnQuit;
      updater.allowPrerelease = false;
      updater.allowDowngrade = false;
      // Full downloads first; blockmap differential downloads are a later, measured optimization.
      updater.disableDifferentialDownload = true;
      updater.on("error", () => undefined);
      updater.on("download-progress", (progress) => {
        if (!current() || this.state.phase !== "downloading") return;
        const now = this.now();
        if (now - this.lastProgressAt < (this.options.progressIntervalMs ?? 250)) return;
        this.lastProgressAt = now;
        this.setState({
          phase: "downloading",
          version,
          percent: clampPercent(progress.percent),
          transferredBytes: nonNegative(progress.transferred),
          totalBytes: nonNegative(progress.total),
        });
      });

      const result = await updater.checkForUpdates();
      if (!current()) return this.state;
      if (result?.updateInfo.version !== version)
        return this.setState({ phase: "failed", version, reason: "version-mismatch" });

      const token = createToken();
      this.token = token;
      await updater.downloadUpdate(token);
      if (!current()) return this.state;
      this.token = undefined;
      return this.setState({ phase: "ready", version });
    } catch (error) {
      if (!current()) return this.state;
      this.token = undefined;
      return this.setState({ phase: "failed", version, reason: failureReason(error) });
    }
  }

  private release(): void {
    this.updater?.removeAllListeners();
    this.updater = undefined;
    this.token = undefined;
  }

  private setState(state: InstallState): InstallState {
    this.state = state;
    this.options.onChange?.(state);
    return state;
  }
}

/** Maps updater/transport errors to user-facing categories without exposing raw messages. */
export function failureReason(error: unknown): UpdateInstallFailure {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const text = `${code} ${error instanceof Error ? error.message : String(error)}`;
  if (/checksum mismatch|ERR_UPDATER_INVALID_SIGNATURE|ERR_UPDATER_NO_CHECKSUM/iu.test(text))
    return "integrity";
  if (/ENOSPC|EACCES|EPERM|EBUSY|EROFS/u.test(text)) return "disk";
  if (/ERR_UPDATER_INVALID_VERSION/u.test(text)) return "version-mismatch";
  if (
    /ERR_UPDATER_|net::|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|socket|timed? ?out|HttpError|status ?code/iu.test(
      text,
    )
  )
    return "network";
  return "unknown";
}

function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}
function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}
