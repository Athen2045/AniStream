import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Download, RefreshCw, RotateCw, X } from "lucide-react";
import type {
  UpdateInstallFailure,
  UpdateStatus,
  UpdateUnavailableReason,
} from "../../shared/update-check";
import { createUpdateSession } from "./update-session";

const UpdateContext = createContext<ReturnType<typeof createUpdateSession> | null>(null);
export function UpdateProvider({
  children,
  bridge,
}: {
  children: ReactNode;
  bridge?: Parameters<typeof createUpdateSession>[0];
}): React.JSX.Element {
  const session = useMemo(() => createUpdateSession(bridge ?? window.anistream), [bridge]);
  useEffect(() => {
    void session.activate();
    return () => session.dispose();
  }, [session]);
  return <UpdateContext.Provider value={session}>{children}</UpdateContext.Provider>;
}
function useUpdates() {
  const session = useContext(UpdateContext);
  if (!session) throw new Error("App updates require the app session.");
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  return { session, ...snapshot };
}
const reasons: Record<UpdateUnavailableReason, string> = {
  network: "Could not reach GitHub to check for updates.",
  timeout: "The update check timed out.",
  "rate-limited": "GitHub has temporarily limited update checks.",
  "invalid-response": "GitHub returned release information that could not be verified.",
  "no-release": "No public stable release is available to check.",
  "no-compatible-release": "The latest release has no compatible installer for this app.",
  "unsupported-build":
    "Update checks are available in installed Windows x64 and Apple Silicon Mac releases. Development builds do not check for updates.",
};
const installFailures: Record<UpdateInstallFailure, string> = {
  network: "The download was interrupted. Check your connection and try again.",
  integrity: "The downloaded installer did not match the release, so it was discarded.",
  "version-mismatch": "The release files did not match the expected version.",
  disk: "The update could not be saved. Check your free disk space and try again.",
  unknown: "The update could not be downloaded.",
};
function statusText(status: UpdateStatus): string {
  switch (status.kind) {
    case "idle":
      return "Check GitHub for a newer stable release.";
    case "checking":
      return "Checking for updates…";
    case "up-to-date":
      return "AniStream is up to date.";
    case "update-available":
      return `AniStream ${status.version} is available.`;
    case "downloading":
      return `Downloading AniStream ${status.version}… ${Math.floor(status.percent)}%`;
    case "ready-to-install":
      return `AniStream ${status.version} is ready. Restart to finish updating.`;
    case "install-failed":
      return installFailures[status.reason];
    case "unavailable":
      return reasons[status.reason];
    case "crash-detected":
      return `Prior startup attempts did not finish. The last stable version was ${status.lastGoodVersion}. Update checks are paused for this launch.`;
  }
}

/** Playback and reading close when the app restarts; ask first only when one is open. */
function confirmRestart(): boolean {
  const busy = document.querySelector(".watch-experience--player, .manga-reader-fullscreen");
  return (
    !busy ||
    window.confirm(
      "Restart AniStream to install the update? What you're watching or reading will close; your progress is saved.",
    )
  );
}

function ReleaseLink({
  status,
  className,
}: {
  status: UpdateStatus;
  className?: string;
}): React.JSX.Element | null {
  if (status.kind === "update-available" || status.kind === "install-failed")
    return (
      <a className={className} href={status.releaseUrl} target="_blank" rel="noreferrer">
        {status.kind === "install-failed" ? "Download from GitHub" : "View release"}
      </a>
    );
  if (status.kind === "downloading" || status.kind === "ready-to-install")
    return (
      <a className={className} href={status.releaseUrl} target="_blank" rel="noreferrer">
        Release notes
      </a>
    );
  if (status.kind === "crash-detected")
    return (
      <a className={className} href={status.lastGoodReleaseUrl} target="_blank" rel="noreferrer">
        Look for the last stable release
      </a>
    );
  return null;
}

/** Download / retry / restart, shared by the notice and Settings. */
function InstallActions({ className }: { className?: string }): React.JSX.Element | null {
  const { session, status, actionPending } = useUpdates();
  if (status.kind === "update-available" && status.canInstall)
    return (
      <button
        type="button"
        className={className}
        disabled={actionPending}
        onClick={() => void session.download()}
      >
        <Download size={15} aria-hidden="true" />
        Download update
      </button>
    );
  if (status.kind === "install-failed")
    return (
      <button
        type="button"
        className={className}
        disabled={actionPending}
        onClick={() => void session.download()}
      >
        <RefreshCw size={15} aria-hidden="true" />
        Try again
      </button>
    );
  if (status.kind === "ready-to-install")
    return (
      <button
        type="button"
        className={className}
        disabled={actionPending}
        onClick={() => {
          if (confirmRestart()) void session.install();
        }}
      >
        <RotateCw size={15} aria-hidden="true" />
        Restart to update
      </button>
    );
  return null;
}

export function UpdateNotice(): React.JSX.Element | null {
  const { session, status, dismissed, preferences, error } = useUpdates();
  // A background download is shown in Settings; the notice returns once it is ready or fails.
  const downloadsAutomatically =
    status.kind === "update-available" && status.canInstall && preferences?.autoDownload;
  const visible =
    status.kind === "ready-to-install" ||
    status.kind === "install-failed" ||
    status.kind === "crash-detected" ||
    (status.kind === "update-available" && !downloadsAutomatically);
  if (dismissed || !visible) return null;
  return (
    <aside className="update-notice" aria-label="App update notice">
      <p role="status">{error ?? statusText(status)}</p>
      <ReleaseLink status={status} />
      <InstallActions className="update-notice-action" />
      <button
        type="button"
        className="update-notice-dismiss"
        aria-label="Dismiss update notice"
        onClick={() => session.dismiss()}
      >
        <X size={16} />
      </button>
    </aside>
  );
}

function UpdateToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      className="set-toggle"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/** Settings → Updates: version, manual check, and (Windows) in-app download and install. */
export function AppUpdates(): React.JSX.Element {
  const { session, status, manualPending, actionPending, preferences, preferencesError, error } =
    useUpdates();
  const retryAt = "retryAt" in status ? status.retryAt : undefined;
  const checkedAt = "checkedAt" in status ? status.checkedAt : undefined;
  const [now, setNow] = useState(Date.now);
  const [refreshSpin, setRefreshSpin] = useState(0);
  useEffect(() => {
    if (!retryAt) return;
    const delay = Date.parse(retryAt) - Date.now();
    if (Date.parse(retryAt) <= now) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(delay + 20, 2_147_483_647)),
    );
    return () => clearTimeout(timer);
  }, [retryAt, now]);
  const coolingDown = Boolean(retryAt && Date.parse(retryAt) > now);
  const unsupported = status.kind === "unavailable" && status.reason === "unsupported-build";
  const upToDate = status.kind === "up-to-date";
  const busy = status.kind === "downloading" || status.kind === "ready-to-install";
  const heading =
    status.kind === "update-available" ||
    status.kind === "downloading" ||
    status.kind === "ready-to-install"
      ? `AniStream ${status.version} is available`
      : status.currentVersion
        ? `AniStream ${status.currentVersion}`
        : "AniStream";
  const detail =
    status.kind === "update-available" && status.currentVersion && !status.canInstall
      ? `You’re on ${status.currentVersion}. The release page has the installer.`
      : statusText(status);
  const setPreference = (patch: { autoDownload?: boolean; installOnQuit?: boolean }): void => {
    if (!preferences) return;
    void session.setPreferences({
      autoDownload: patch.autoDownload ?? preferences.autoDownload,
      installOnQuit: patch.installOnQuit ?? preferences.installOnQuit,
    });
  };
  return (
    <div className="set-card app-updates">
      <div className="set-row">
        <div className="set-text">
          <strong>{heading}</strong>
          <span role="status" className={upToDate && !error ? "set-ok" : undefined}>
            {error ?? detail}
          </span>
          {status.kind === "downloading" && (
            <progress
              className="update-progress"
              max={100}
              value={status.percent}
              aria-label={`Downloading AniStream ${status.version}`}
            />
          )}
          {checkedAt && (
            <span className="update-timing">
              Last check: {new Date(checkedAt).toLocaleString()}
            </span>
          )}
          {coolingDown && (
            <span className="update-timing">
              Next check available: {new Date(retryAt!).toLocaleString()}
            </span>
          )}
        </div>
        <div className="update-actions">
          <ReleaseLink status={status} className="set-button" />
          <InstallActions className="set-button set-button--primary" />
          {status.kind === "downloading" ? (
            <button
              type="button"
              className="set-button"
              disabled={actionPending}
              onClick={() => void session.cancelDownload()}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="set-button"
              onClick={() => {
                setRefreshSpin((spin) => spin + 1);
                void session.check();
              }}
              disabled={
                manualPending ||
                busy ||
                status.kind === "checking" ||
                status.kind === "crash-detected" ||
                unsupported ||
                coolingDown
              }
            >
              <RefreshCw
                key={refreshSpin}
                size={15}
                className={refreshSpin ? "refresh-spin-once" : undefined}
                aria-hidden="true"
              />
              {manualPending || status.kind === "checking" ? "Checking…" : "Check for updates"}
            </button>
          )}
        </div>
      </div>
      {preferences?.supported && (
        <>
          <div className="set-row">
            <div className="set-text">
              <strong>Download updates automatically</strong>
              <span>
                Downloads a new release from GitHub in the background. Nothing is installed until
                you choose Restart to update.
              </span>
            </div>
            <UpdateToggle
              label="Download updates automatically"
              checked={preferences.autoDownload}
              disabled={false}
              onChange={(on) => setPreference({ autoDownload: on })}
            />
          </div>
          <div className="set-row">
            <div className="set-text">
              <strong>Install downloaded updates when I quit</strong>
              <span>
                {preferencesError ??
                  "Installs a downloaded update when you close AniStream, instead of waiting for Restart to update."}
              </span>
            </div>
            <UpdateToggle
              label="Install downloaded updates when I quit"
              checked={preferences.installOnQuit}
              disabled={false}
              onChange={(on) => setPreference({ installOnQuit: on })}
            />
          </div>
        </>
      )}
    </div>
  );
}
