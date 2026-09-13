import { describe, expect, it } from "vitest";
import * as motionModule from "../../src/renderer/src/motion";

describe("renderer motion policy", () => {
  it("keeps Windows motion enabled when the operating system prefers reduced motion", () => {
    const resolveReducedMotion = (
      motionModule as unknown as {
        resolveReducedMotion?: (platform: string | undefined, preferred: boolean | null) => boolean;
      }
    ).resolveReducedMotion;

    expect(resolveReducedMotion).toBeTypeOf("function");
    if (!resolveReducedMotion) return;
    expect(resolveReducedMotion("win32", true)).toBe(false);
    expect(resolveReducedMotion("darwin", true)).toBe(true);
    expect(resolveReducedMotion("darwin", false)).toBe(false);
  });

  it("eases programmatic scrolling without overshooting its target", () => {
    const smoothScrollProgress = (
      motionModule as unknown as {
        smoothScrollProgress?: (progress: number) => number;
      }
    ).smoothScrollProgress;

    expect(smoothScrollProgress).toBeTypeOf("function");
    if (!smoothScrollProgress) return;
    expect(smoothScrollProgress(-1)).toBe(0);
    expect(smoothScrollProgress(0)).toBe(0);
    expect(smoothScrollProgress(0.25)).toBeLessThan(0.25);
    expect(smoothScrollProgress(0.5)).toBe(0.5);
    expect(smoothScrollProgress(0.75)).toBeGreaterThan(0.75);
    expect(smoothScrollProgress(1)).toBe(1);
    expect(smoothScrollProgress(2)).toBe(1);
  });

  it("uses elapsed-time damping for continuous document scrolling", () => {
    const smoothFollowStep = (
      motionModule as unknown as {
        smoothFollowStep?: (current: number, target: number, elapsedMs: number) => number;
      }
    ).smoothFollowStep;

    expect(smoothFollowStep).toBeTypeOf("function");
    if (!smoothFollowStep) return;
    const firstFrame = smoothFollowStep(0, 600, 16);
    const laterFrame = smoothFollowStep(0, 600, 48);
    expect(firstFrame).toBeGreaterThan(0);
    expect(firstFrame).toBeLessThan(600);
    expect(laterFrame).toBeGreaterThan(firstFrame);
    expect(smoothFollowStep(600, 0, 16)).toBeLessThan(600);
    expect(smoothFollowStep(600, 0, 16)).toBeGreaterThan(0);
  });

  it("smooths discrete wheel steps while leaving precise touchpad input native", () => {
    const shouldSmoothWheel = (
      motionModule as unknown as {
        shouldSmoothWheel?: (
          deltaY: number,
          deltaMode: number,
          ctrlKey: boolean,
          shiftKey: boolean,
        ) => boolean;
      }
    ).shouldSmoothWheel;
    const wheelDeltaPixels = (
      motionModule as unknown as {
        wheelDeltaPixels?: (deltaY: number, deltaMode: number, viewportHeight: number) => number;
      }
    ).wheelDeltaPixels;

    expect(shouldSmoothWheel).toBeTypeOf("function");
    expect(wheelDeltaPixels).toBeTypeOf("function");
    if (!shouldSmoothWheel || !wheelDeltaPixels) return;
    expect(shouldSmoothWheel(12, 0, false, false)).toBe(false);
    expect(shouldSmoothWheel(100, 0, false, false)).toBe(true);
    expect(shouldSmoothWheel(3, 1, false, false)).toBe(true);
    expect(shouldSmoothWheel(100, 0, true, false)).toBe(false);
    expect(shouldSmoothWheel(100, 0, false, true)).toBe(false);
    expect(wheelDeltaPixels(3, 1, 900)).toBe(120);
    expect(wheelDeltaPixels(1, 2, 900)).toBe(765);
  });
});
