import type { Transition, Variants } from "framer-motion";

// One small motion vocabulary keeps CSS and Framer Motion from drifting apart.
export const motionTiming = {
  fast: 0.16,
  standard: 0.24,
  emphasis: 0.36,
  entrance: 0.48,
  glide: 0.68,
} as const;

export const motionEase = [0.16, 1, 0.3, 1] as const;

export function smoothScrollProgress(progress: number): number {
  const boundedProgress = Math.min(1, Math.max(0, progress));
  return boundedProgress < 0.5
    ? 4 * Math.pow(boundedProgress, 3)
    : 1 - Math.pow(-2 * boundedProgress + 2, 3) / 2;
}

export function smoothFollowStep(current: number, target: number, elapsedMs: number): number {
  const boundedElapsed = Math.min(64, Math.max(0, elapsedMs));
  const blend = 1 - Math.exp(-boundedElapsed / 110);
  return current + (target - current) * blend;
}

export function shouldSmoothWheel(
  deltaY: number,
  deltaMode: number,
  ctrlKey: boolean,
  shiftKey: boolean,
): boolean {
  if (ctrlKey || shiftKey || deltaY === 0) return false;
  return deltaMode !== 0 || Math.abs(deltaY) >= 48;
}

export function wheelDeltaPixels(
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
): number {
  if (deltaMode === 1) return deltaY * 40;
  if (deltaMode === 2) return deltaY * viewportHeight * 0.85;
  return deltaY;
}

export function resolveReducedMotion(
  platform: string | undefined,
  preferred: boolean | null,
): boolean {
  return platform !== "win32" && preferred === true;
}

export function motionTransition(
  reducedMotion: boolean | null,
  duration: keyof typeof motionTiming = "standard",
): Transition {
  return reducedMotion ? { duration: 0 } : { duration: motionTiming[duration], ease: motionEase };
}

export const routeVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

export const profileRouteVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

/** Tab order for direction-aware section transitions; unknown views count as the far end. */
const SECTION_ORDER: Record<string, number> = {
  ANIME: 0,
  MANGA: 1,
  MORE: 2,
  SEARCH: 3,
  PROFILE: 4,
  SETTINGS: 5,
};

/** 1 when moving right through the tabs, -1 when moving left. */
export function sectionDirection(from: string, to: string): 1 | -1 {
  return (SECTION_ORDER[to] ?? 9) >= (SECTION_ORDER[from] ?? 9) ? 1 : -1;
}

/** Sections slide toward the tab that was chosen; the outgoing page leaves quickly with a soft blur. */
export const sectionVariants: Variants = {
  initial: (direction: number) => ({ opacity: 0, x: 40 * direction }),
  animate: {
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: { duration: motionTiming.emphasis, ease: motionEase },
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: -40 * direction,
    filter: "blur(3px)",
    transition: { duration: motionTiming.fast, ease: motionEase },
  }),
};

/** Spring for indicators that glide between options (navbar underline, filter pills). */
export function navIndicatorTransition(reducedMotion: boolean | null): Transition {
  return reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 };
}
