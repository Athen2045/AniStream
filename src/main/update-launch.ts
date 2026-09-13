import type { UpdateStatus } from "../shared/update-check";
import type { UpdateLaunchState, UpdateLaunchStore } from "./update-launch-store";
import { parseLaunchState } from "./update-launch-store";
import { RELEASE_REPOSITORY, stableVersion } from "./update-release";

/** One instance per app process. Window recreation never increments launch attempts. */
export class UpdateLaunch {
  readonly recovery: Extract<UpdateStatus, { kind: "crash-detected" }> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private stable = false;
  private state: UpdateLaunchState = { attempts: 0 };
  private readonly version: string | undefined;

  constructor(
    private readonly store: UpdateLaunchStore,
    currentVersion: string,
    enabled: boolean,
  ) {
    this.version = enabled ? stableVersion(currentVersion) : undefined;
    if (!this.version) return;
    try {
      this.state = parseStored(store);
    } catch {
      /* Startup remains usable without launch history. */
    }
    const priorAttempts = this.state.pendingVersion === this.version ? this.state.attempts : 0;
    if (
      this.state.lastGoodVersion &&
      this.state.lastGoodVersion !== this.version &&
      priorAttempts >= 2
    ) {
      this.recovery = {
        kind: "crash-detected",
        currentVersion,
        lastGoodVersion: this.state.lastGoodVersion,
        lastGoodReleaseUrl: `${RELEASE_REPOSITORY}/releases/tag/v${this.state.lastGoodVersion}`,
      };
    }
    this.state = {
      ...this.state,
      pendingVersion: this.version,
      attempts: Math.min(3, priorAttempts + 1),
    };
    this.persist();
  }

  rendererLoaded(isHealthy: () => boolean): void {
    this.cancelTimer();
    if (this.disposed || this.stable || !this.version) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.disposed || !isHealthy()) return;
      this.stable = true;
      this.state = { lastGoodVersion: this.version, attempts: 0 };
      this.persist();
    }, 8_000);
  }

  cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }
  private persist(): void {
    try {
      this.store.write(this.state);
    } catch {
      /* Best-effort local health history must never block startup. */
    }
  }
}

function parseStored(store: UpdateLaunchStore): UpdateLaunchState {
  return parseLaunchState(store.read());
}
