import { motion } from "framer-motion";
import loadingArtwork from "./assets/chromevt-vtuber.gif";
import { motionTransition } from "./motion";
import type { ReadinessSnapshot } from "./startup-readiness";

interface ReadinessScreenProps {
  snapshot: ReadinessSnapshot;
  reducedMotion: boolean;
  onRetry(): void;
  onContinue(): void;
}

export function ReadinessScreen({
  snapshot,
  reducedMotion,
  onRetry,
  onContinue,
}: ReadinessScreenProps): React.JSX.Element {
  const checking = snapshot.outcome === "checking";
  const failed = snapshot.outcome !== "checking" && snapshot.outcome !== "ready";
  const title =
    snapshot.mode === "profile"
      ? checking
        ? "Preparing your profile"
        : "Profile needs attention"
      : checking
        ? "Getting AniStream ready"
        : "AniStream needs attention";

  return (
    <motion.section
      className="readiness-screen"
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
      aria-atomic="true"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reducedMotion ? undefined : { opacity: 0 }}
      transition={motionTransition(reducedMotion, "emphasis")}
    >
      <div className="readiness-content">
        <img
          className="readiness-artwork"
          src={loadingArtwork}
          alt="AniStream loading character"
          draggable="false"
        />
        <div className="readiness-copy">
          <p className="readiness-eyebrow">ANISTREAM</p>
          <h1>{title}</h1>
          <p>{failed ? snapshot.message : snapshot.activeLabel}</p>
        </div>
        <div className="readiness-progress-row">
          <div
            className="readiness-progress"
            role="progressbar"
            aria-label="Application readiness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={snapshot.progress}
            aria-valuetext={`${snapshot.progress}% — ${snapshot.activeLabel}`}
          >
            <motion.span
              initial={false}
              animate={{ width: `${snapshot.progress}%` }}
              transition={motionTransition(reducedMotion, "standard")}
            />
          </div>
          <strong>{snapshot.progress}%</strong>
        </div>
        <ol className="sr-only">
          {snapshot.steps.map((step) => (
            <li key={step.id}>
              {step.label}: {step.state}
              {step.message ? ` — ${step.message}` : ""}
            </li>
          ))}
        </ol>
        {failed ? (
          <div className="readiness-actions">
            <button type="button" className="readiness-primary-action" onClick={onRetry}>
              Retry
            </button>
            {snapshot.canContinue ? (
              <button type="button" className="readiness-secondary-action" onClick={onContinue}>
                {snapshot.mode === "profile" ? "Use saved profile" : "Continue browsing"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}
