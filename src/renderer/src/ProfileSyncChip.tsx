import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { SourceLogo } from "./SourceLogo";
import { useAppReducedMotion } from "./useAppReducedMotion";

export interface ProfileSyncSource {
  source: "anilist" | "simkl";
  state: "busy" | "done" | "failed";
}

const LABELS: Record<ProfileSyncSource["source"], string> = { anilist: "AniList", simkl: "Simkl" };

/**
 * Profile opens from the saved copy at once (approved 2026-10-07); this chip shows each account
 * still updating. It disappears once every source is done, and stays to say which one failed.
 */
export function ProfileSyncChip({
  sources,
}: {
  sources: readonly ProfileSyncSource[];
}): React.JSX.Element {
  const reducedMotion = useAppReducedMotion();
  const visible = sources.some((source) => source.state !== "done");
  const single = sources.length === 1;
  return (
    <AnimatePresence>
      {visible ? (
        <motion.p
          className="profile-sync-chip"
          role="status"
          aria-live="polite"
          initial={reducedMotion ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
        >
          {sources.map(({ source, state }, index) => (
            <span key={source} className={`profile-sync-source is-${state}`}>
              {index ? <i className="profile-sync-dot" aria-hidden="true" /> : null}
              <SourceLogo source={source} />
              {label(source, state, single)}
              {state === "busy" ? (
                <i className="profile-sync-spin" aria-hidden="true" />
              ) : state === "done" ? (
                <em className="profile-sync-ok" aria-hidden="true">
                  <Check size={11} strokeWidth={3} />
                </em>
              ) : (
                <em className="profile-sync-warn" aria-hidden="true">
                  !
                </em>
              )}
            </span>
          ))}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

function label(
  source: ProfileSyncSource["source"],
  state: ProfileSyncSource["state"],
  single: boolean,
): string {
  const name = LABELS[source];
  if (state === "failed") return `${name} couldn't update · showing saved copy`;
  if (state === "done") return name;
  if (single) return source === "anilist" ? "Updating your AniList library" : "Updating from Simkl";
  return `${name} updating`;
}
