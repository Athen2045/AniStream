export type UpdateUnavailableReason =
  | "network"
  | "timeout"
  | "rate-limited"
  | "invalid-response"
  | "no-release"
  | "no-compatible-release"
  | "unsupported-build";

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
