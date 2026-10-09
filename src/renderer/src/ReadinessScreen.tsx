import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import appIcon from "./assets/app-icon.png";
import { motionTransition } from "./motion";
import type { ReadinessSnapshot } from "./startup-readiness";

/** Status, steps and the stream line appear only if a check is still running after this. */
export const READINESS_DETAIL_DELAY_MS = 600;

interface ReadinessScreenProps {
  snapshot: ReadinessSnapshot;
  reducedMotion: boolean;
  onRetry(): void;
  onContinue(): void;
}

/**
 * Launch and first-Profile loading (approved 2026-10-07): the app mark breathing on the app black,
 * a thin stream line whose fill is real completed work, one status line and quiet step dots. A fast
 * start never shows more than the mark; a failure becomes a short card with the next action.
 */
export function ReadinessScreen({
  snapshot,
  reducedMotion,
  onRetry,
  onContinue,
}: ReadinessScreenProps): React.JSX.Element {
  const checking = snapshot.outcome === "checking";
  const failed = !checking && snapshot.outcome !== "ready";
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), READINESS_DETAIL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const detailed = revealed || failed;

  return (
    <motion.section
      className={`readiness-screen${reducedMotion ? " is-reduced" : ""}${failed ? " is-failed" : ""}`}
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
      aria-atomic="true"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reducedMotion ? undefined : { opacity: 0 }}
      transition={motionTransition(reducedMotion, "emphasis")}
    >
      <div className="readiness-content">
        <img className="readiness-mark" src={appIcon} alt="" draggable="false" />
        <p className="readiness-wordmark">AniStream</p>
        <h1 className="sr-only">{headline(snapshot, failed)}</h1>

        {detailed && !failed ? (
          <>
            <div
              className="readiness-stream"
              role="progressbar"
              aria-label="Application readiness"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={snapshot.progress}
              aria-valuetext={`${snapshot.progress}% — ${snapshot.activeLabel}`}
            >
              <motion.span
                className="readiness-stream-fill"
                initial={false}
                animate={{ width: `${snapshot.progress}%` }}
                transition={motionTransition(reducedMotion, "standard")}
              />
              <span className="readiness-stream-flow" aria-hidden="true" />
            </div>
            <p className="readiness-status">
              {snapshot.activeLabel}
              {checking ? "…" : ""}
            </p>
          </>
        ) : null}

        {detailed && snapshot.steps.length ? (
          <ul className="readiness-steps" aria-label="Checks">
            {snapshot.steps.map((step) => (
              <li key={step.id} className={`is-${step.state}`}>
                <i aria-hidden="true" />
                {step.shortLabel}
                <span className="sr-only">: {stepStateLabel(step.state)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {failed ? (
          <div className="readiness-error">
            <h2>{headline(snapshot, true)}</h2>
            <p>{snapshot.message}</p>
            <div className="readiness-actions">
              <button type="button" className="readiness-primary-action" onClick={onRetry}>
                Try again
              </button>
              {snapshot.canContinue ? (
                <button type="button" className="readiness-secondary-action" onClick={onContinue}>
                  {snapshot.mode === "profile" ? "Use saved profile" : "Continue browsing"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}

function headline(snapshot: ReadinessSnapshot, failed: boolean): string {
  if (!failed)
    return snapshot.mode === "profile" ? "Preparing your profile" : "Getting AniStream ready";
  switch (snapshot.outcome) {
    case "offline":
      return "You're offline";
    case "local-error":
      return "AniStream couldn't open its data";
    default:
      return snapshot.provider
        ? `${snapshot.provider} isn't answering right now`
        : "Something isn't answering right now";
  }
}

function stepStateLabel(state: ReadinessSnapshot["steps"][number]["state"]): string {
  return {
    pending: "waiting",
    active: "checking",
    complete: "done",
    failed: "failed",
    disabled: "skipped",
  }[state];
}
