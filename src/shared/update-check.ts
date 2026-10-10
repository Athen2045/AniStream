export type UpdateUnavailableReason =
  | "network"
  | "timeout"
  | "rate-limited"
  | "invalid-response"
  | "no-release"
  | "no-compatible-release"
  | "unsupported-build";

/** Why an in-app (Windows) update download or install did not complete. */
export type UpdateInstallFailure =
  "network" | "integrity" | "version-mismatch" | "disk" | "unknown";

export type UpdateStatus =
  | { kind: "idle"; currentVersion: string }
  | { kind: "checking"; currentVersion: string }
  | { kind: "up-to-date"; currentVersion: string; checkedAt: string; retryAt: string }
  | {
      kind: "update-available";
      currentVersion: string;
      version: string;
      releaseUrl: string;
      checkedAt: string;
      retryAt: string;
      /** True when this build can download and install the release itself (Windows x64). */
      canInstall: boolean;
    }
  | {
      kind: "downloading";
      currentVersion: string;
      version: string;
      releaseUrl: string;
      percent: number;
      transferredBytes: number;
      totalBytes: number;
    }
  | { kind: "ready-to-install"; currentVersion: string; version: string; releaseUrl: string }
  | {
      kind: "install-failed";
      currentVersion: string;
      version: string;
      releaseUrl: string;
      reason: UpdateInstallFailure;
    }
  | {
      kind: "unavailable";
      currentVersion: string;
      reason: UpdateUnavailableReason;
      checkedAt?: string;
      retryAt?: string;
    }
  | {
      kind: "crash-detected";
      currentVersion: string;
      lastGoodVersion: string;
      lastGoodReleaseUrl: string;
    };

/** Local choices for in-app updates; `supported` is false outside packaged Windows x64 builds. */
export interface UpdatePreferences {
  supported: boolean;
  /** Download a found release in the background (default on). */
  autoDownload: boolean;
  /** Install a downloaded release when the app quits (default off; Restart to update always works). */
  installOnQuit: boolean;
}
