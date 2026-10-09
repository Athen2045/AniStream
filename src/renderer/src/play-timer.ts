import type { PersonalizationSection } from "../../shared/contracts";

/**
 * Time to play: seconds from opening a section to starting something in it, the measure behind
 * Netflix's "90-second rule". Only the first start per visit counts; the main process keeps it
 * only while "Learn from my activity" is on.
 */
let browsing: { section: PersonalizationSection; startedAt: number } | undefined;

export function startBrowsing(section: PersonalizationSection): void {
  browsing = { section, startedAt: performance.now() };
}

export function playStarted(section: PersonalizationSection): void {
  if (!browsing || browsing.section !== section) return;
  const seconds = (performance.now() - browsing.startedAt) / 1000;
  browsing = undefined;
  void window.anistream.recordTimeToPlay(section, seconds).catch(() => undefined);
}
