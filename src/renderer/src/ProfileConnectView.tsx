import { ShieldCheck } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { AniListAuthState } from "../../shared/contracts";

export function ProfileConnectView({
  auth,
  restoring,
  error,
  onConnect,
  onCancel,
}: {
  auth: AniListAuthState;
  restoring: boolean;
  error?: string;
  onConnect: () => Promise<void>;
  onCancel: () => Promise<void>;
}): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const authorizing = auth.status === "authorizing";
  const connectionState = restoring ? "restoring" : authorizing ? "authorizing" : "ready";
  const transition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const };
  const message = restoring
    ? "Checking this Mac for a saved AniList session."
    : authorizing
      ? "AniList is open in your browser. Approve AniStream there to finish connecting."
      : "Sign in to AniList in your browser to bring in your lists, ratings, and Continue rows.";
  const buttonLabel = restoring
    ? "Restoring session…"
    : authorizing
      ? "Finish in your browser…"
      : "Continue with AniList";

  return (
    <section className="profile-connect-page" aria-labelledby="profile-connect-title">
      <motion.article
        className="profile-connect-panel"
        initial={reducedMotion ? false : { opacity: 0, y: 24, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reducedMotion ? { duration: 0 } : { duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        aria-busy={restoring || authorizing}
      >
        <p className="sr-only" role="status" aria-live="polite">
          {restoring
            ? "Checking for a saved AniList session."
            : authorizing
              ? "AniList authorization is open in your browser."
              : "Ready to connect an AniList account."}
        </p>
        <div className="brand-mark" aria-hidden="true">
          A
        </div>
        <p className="profile-connect-label">AniList connection</p>
        <h1 id="profile-connect-title">Make AniStream yours</h1>

        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            className="profile-connect-message"
            key={connectionState}
            initial={reducedMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -5 }}
            transition={transition}
          >
            {message}
          </motion.p>
        </AnimatePresence>

        <motion.button
          className="primary-button"
          type="button"
          onClick={() => void onConnect()}
          disabled={restoring || authorizing}
          whileHover={reducedMotion || restoring || authorizing ? undefined : { scale: 1.012 }}
          whileTap={reducedMotion || restoring || authorizing ? undefined : { scale: 0.985 }}
          transition={transition}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              className="profile-connect-button-label"
              key={connectionState}
              initial={reducedMotion ? false : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -5 }}
              transition={transition}
            >
              {buttonLabel}
            </motion.span>
          </AnimatePresence>
        </motion.button>
        <AnimatePresence initial={false}>
          {authorizing ? (
            <motion.button
              className="secondary-button"
              type="button"
              onClick={() => void onCancel()}
              initial={reducedMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={transition}
            >
              Cancel sign-in
            </motion.button>
          ) : null}
        </AnimatePresence>

        <p className="privacy-note">
          <ShieldCheck size={15} aria-hidden="true" />
          No AniList password or Developer API setup is required. Your connection stays on this
          device.
        </p>
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
      </motion.article>
    </section>
  );
}
