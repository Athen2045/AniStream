import type { Transition, Variants } from "framer-motion";

// One small motion vocabulary keeps CSS and Framer Motion from drifting apart.
export const motionTiming = {
  fast: 0.16,
  standard: 0.24,
  emphasis: 0.36,
  entrance: 0.48,
} as const;

export const motionEase = [0.16, 1, 0.3, 1] as const;

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

export const motionCssTokens = {
  fast: "160ms",
  standard: "240ms",
  emphasis: "360ms",
  entrance: "480ms",
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;
