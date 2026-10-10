import type { UpdatePreferences, UpdateStatus } from "../shared/update-check";
import type { InstallState } from "./update-install";
import type { StoredUpdatePreferences, UpdatePreferencesStore } from "./update-preferences-store";
import { DEFAULT_UPDATE_PREFERENCES } from "./update-preferences-store";
import { RELEASE_REPOSITORY } from "./update-release";

interface CheckerLike {
  getStatus(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  dispose(): void;
}
interface InstallerLike {
  getState(): InstallState;
  download(version: string): Promise<InstallState>;
  cancel(): void;
  install(): boolean;
  setInstallOnQuit(enabled: boolean): void;
  dispose(): void;
}
interface Options {
  checker: CheckerLike;
  /** Present only in packaged Windows x64 builds. */
  installer?: InstallerLike;
  preferences?: UpdatePreferencesStore;
  onChange?: (status: UpdateStatus) => void;
}

/**
 * One update status for the renderer: the release check, plus (Windows) the in-app download and
 * install. A found release downloads in the background once per version when the user allows it.
 */
export class UpdateService {
  private readonly autoAttempted = new Set<string>();
  private lastSent: UpdateStatus | undefined;

  constructor(private readonly options: Options) {}

  getStatus(): UpdateStatus {
    const base = this.options.checker.getStatus();
    const install = this.options.installer?.getState();
    if (!install || install.phase === "idle") return base;
    // A newer release found after an earlier download replaces the stale install state.
    if (base.kind === "update-available" && base.version !== install.version) return base;
    const shared = {
      currentVersion: base.currentVersion,
      version: install.version,
      releaseUrl: `${RELEASE_REPOSITORY}/releases/tag/v${install.version}`,
    };
    switch (install.phase) {
      case "downloading":
        return {
          kind: "downloading",
          ...shared,
          percent: install.percent,
          transferredBytes: install.transferredBytes,
          totalBytes: install.totalBytes,
        };
      case "ready":
        return { kind: "ready-to-install", ...shared };
      case "failed":
        return { kind: "install-failed", ...shared, reason: install.reason };
    }
  }

  async check(): Promise<UpdateStatus> {
    await this.options.checker.check();
    return this.handleChange();
  }

  /** Starts (or retries) the in-app download for the release currently on offer. */
  async download(): Promise<UpdateStatus> {
    const installer = this.options.installer;
    const version = this.downloadableVersion();
    if (!installer || !version) return this.getStatus();
    await installer.download(version);
    return this.handleChange();
  }

  cancelDownload(): UpdateStatus {
    this.options.installer?.cancel();
    return this.handleChange();
  }

  install(): boolean {
    return this.options.installer?.install() ?? false;
  }

  getPreferences(): UpdatePreferences {
    return { supported: Boolean(this.options.installer), ...this.readPreferences() };
  }

  setPreferences(next: StoredUpdatePreferences): UpdatePreferences {
    const store = this.options.preferences;
    if (!this.options.installer || !store) return this.getPreferences();
    store.write(next);
    this.options.installer.setInstallOnQuit(next.installOnQuit);
    this.handleChange();
    return this.getPreferences();
  }

  /** Re-derives the status, starts an allowed background download, and notifies on change. */
  handleChange(): UpdateStatus {
    const status = this.getStatus();
    const installer = this.options.installer;
    if (
      installer &&
      status.kind === "update-available" &&
      status.canInstall &&
      !this.autoAttempted.has(status.version) &&
      this.readPreferences().autoDownload
    ) {
      this.autoAttempted.add(status.version);
      void installer.download(status.version).then(() => this.handleChange());
      return this.emit(this.getStatus());
    }
    return this.emit(status);
  }

  dispose(): void {
    this.options.checker.dispose();
    this.options.installer?.dispose();
  }

  private downloadableVersion(): string | undefined {
    const status = this.getStatus();
    if (status.kind === "update-available" && status.canInstall) return status.version;
    if (status.kind === "install-failed") return status.version;
    return undefined;
  }

  private readPreferences(): StoredUpdatePreferences {
    try {
      return this.options.preferences?.read() ?? { ...DEFAULT_UPDATE_PREFERENCES };
    } catch {
      return { ...DEFAULT_UPDATE_PREFERENCES };
    }
  }

  private emit(status: UpdateStatus): UpdateStatus {
    if (!sameStatus(this.lastSent, status)) {
      this.lastSent = status;
      this.options.onChange?.(status);
    }
    return status;
  }
}

function sameStatus(left: UpdateStatus | undefined, right: UpdateStatus): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}
