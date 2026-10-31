import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { motionTransition } from "./motion";
import type { ReadinessSnapshot } from "./startup-readiness";

/** The bar and its line appear only if a check is still running after this. */
export const READINESS_DETAIL_DELAY_MS = 600;

interface ReadinessScreenProps {
  snapshot: ReadinessSnapshot;
  reducedMotion: boolean;
  onRetry(): void;
  onContinue(): void;
}

/**
 * Launch and first-Profile loading (redesign 2026-10-31, mockup 01): the website's "Ani" intro (a
 * light blade wipes the mark in, a sheen crosses it, the sparkle lands on the i), then a thin bar
 * whose fill is real completed work and one plain line. A fast start never shows more than the
 * mark; a failure becomes a short card with the checks and the next action.
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
        <div className="readiness-mark" aria-hidden="true">
          <span className="readiness-mark-body" />
          <span className="readiness-mark-sheen" />
          <span className="readiness-mark-blade" />
          <svg className="readiness-mark-star" viewBox="0 0 100 100">
            <path d="M50 0C55 31 69 45 100 50 69 55 55 69 50 100 45 69 31 55 0 50 31 45 45 31 50 0Z" />
          </svg>
        </div>
        <p className="sr-only">AniStream</p>
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
            </div>
            <p className="readiness-status">
              {snapshot.mode === "profile" ? "Loading your profile" : "Loading your library"}
            </p>
          </>
        ) : null}

        {failed && snapshot.steps.length ? (
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
      <p className="readiness-credit">Data from AniList, MangaDex and TMDB</p>
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
