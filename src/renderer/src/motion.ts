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

export const motionCssTokens = {
  fast: "160ms",
  standard: "240ms",
  emphasis: "360ms",
  entrance: "480ms",
  glide: "680ms",
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;
