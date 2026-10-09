import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import {
  dismissContinueNotice,
  removeFromContinue,
  restoreToContinue,
  useContinueRemovals,
  type ContinueSection,
} from "./continue-dismissals";
import { motionTransition } from "./motion";
import { useAppReducedMotion } from "./useAppReducedMotion";

/** Top-right X on a Continue card; shown on hover or keyboard focus. */
export function ContinueRemoveButton({
  section,
  id,
  title,
}: {
  section: ContinueSection;
  id: string | number;
  title: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="continue-remove"
      aria-label={`Remove ${title} from Continue`}
      title="Remove from Continue"
      onClick={(event) => {
        event.stopPropagation();
        removeFromContinue(section, id, title);
      }}
    >
      <X size={15} strokeWidth={2.6} aria-hidden="true" />
    </button>
  );
}

const TOAST_MS = 6_000;

/** "Removed from Continue · Undo", once for the whole app. */
export function ContinueUndoToast(): React.JSX.Element {
  const { notice } = useContinueRemovals();
  const reducedMotion = useAppReducedMotion();
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => dismissContinueNotice(notice.id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const list = notice?.section === "MANGA" ? "Continue Reading" : "Continue Watching";
  return (
    <div className="continue-toast-region" role="status" aria-live="polite">
      <AnimatePresence>
        {notice ? (
          <motion.div
            key={notice.id}
            className="continue-toast"
            initial={reducedMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: 16 }}
            transition={motionTransition(reducedMotion)}
          >
            <p>
              <strong>{notice.title}</strong> removed from {list}
            </p>
            <button type="button" onClick={() => restoreToContinue(notice.key)}>
              Undo
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
