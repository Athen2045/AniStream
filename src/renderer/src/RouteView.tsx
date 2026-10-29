import { motion, type Variants } from "framer-motion";
import { motionTransition } from "./motion";

/**
 * One page of the app's route stack, animated in and out by its variants (none with Reduce
 * motion). Rendered directly inside the route `AnimatePresence`, which tracks it by its key.
 */
export function RouteView({
  variants,
  reducedMotion,
  custom,
  className = "route-view",
  emphasis = false,
  children,
}: {
  variants: Variants;
  reducedMotion: boolean;
  /** Section pages slide toward the section being opened. */
  custom?: 1 | -1;
  className?: string;
  /** Profile pages use the slower emphasis timing. */
  emphasis?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <motion.div
      className={className}
      custom={custom}
      variants={variants}
      initial={reducedMotion ? false : "initial"}
      animate="animate"
      exit={reducedMotion ? undefined : "exit"}
      transition={motionTransition(reducedMotion, emphasis ? "emphasis" : "standard")}
    >
      {children}
    </motion.div>
  );
}
