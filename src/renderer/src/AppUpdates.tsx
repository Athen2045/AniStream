import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { RefreshCw, X } from "lucide-react";
import type { UpdateStatus, UpdateUnavailableReason } from "../../shared/update-check";
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
    case "unavailable":
      return reasons[status.reason];
    case "crash-detected":
      return `Prior startup attempts did not finish. The last stable version was ${status.lastGoodVersion}. Update checks are paused for this launch.`;
  }
}
function ReleaseLink({
  status,
  className,
}: {
  status: UpdateStatus;
  className?: string;
}): React.JSX.Element | null {
  if (status.kind === "update-available")
    return (
      <a className={className} href={status.releaseUrl} target="_blank" rel="noreferrer">
        View release
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
export function UpdateNotice(): React.JSX.Element | null {
  const { session, status, dismissed } = useUpdates();
  if (dismissed || (status.kind !== "update-available" && status.kind !== "crash-detected"))
    return null;
  return (
    <aside className="update-notice" aria-label="App update notice">
      <p role="status">{statusText(status)}</p>
      <ReleaseLink status={status} />
      <button type="button" aria-label="Dismiss update notice" onClick={() => session.dismiss()}>
        <X size={16} />
      </button>
    </aside>
  );
}
/** Settings → Updates: the installed version and a manual check against GitHub releases. */
export function AppUpdates(): React.JSX.Element {
  const { session, status, manualPending, error } = useUpdates();
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
  return (
    <div className="set-card app-updates">
      <div className="set-row">
        <div className="set-text">
          <strong>
            {status.kind === "update-available"
              ? `AniStream ${status.version} is available`
              : status.currentVersion
                ? `AniStream ${status.currentVersion}`
                : "AniStream"}
          </strong>
          <span role="status" className={upToDate && !error ? "set-ok" : undefined}>
            {error ??
              (status.kind === "update-available" && status.currentVersion
                ? `You’re on ${status.currentVersion}. The release page has the installer.`
                : statusText(status))}
          </span>
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
          <ReleaseLink status={status} className="set-button set-button--primary" />
          <button
            type="button"
            className="set-button"
            onClick={() => {
              setRefreshSpin((spin) => spin + 1);
              void session.check();
            }}
            disabled={
              manualPending ||
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
        </div>
      </div>
    </div>
  );
}
