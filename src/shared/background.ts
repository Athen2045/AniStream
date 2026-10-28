/**
 * Running in the background (user decision 2026-10-27: opt-in, never forced). Closing the window
 * normally quits; `keepRunning` hides it to the system tray instead, so reopening is instant.
 * `whileDownloading` decides what closing does while downloads are still queued, when
 * `keepRunning` is off: ask each time, keep downloading in the tray (then quit once they finish),
 * or quit (they continue at the next start).
 */
export interface BackgroundPreferences {
  keepRunning: boolean;
  whileDownloading: "ask" | "background" | "quit";
}

export const DEFAULT_BACKGROUND_PREFERENCES: BackgroundPreferences = {
  keepRunning: false,
  whileDownloading: "ask",
};

const WHILE_DOWNLOADING = new Set(["ask", "background", "quit"]);

export function parseBackgroundPreferences(value: unknown): BackgroundPreferences | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.keepRunning !== "boolean") return undefined;
  if (
    typeof record.whileDownloading !== "string" ||
    !WHILE_DOWNLOADING.has(record.whileDownloading)
  )
    return undefined;
  return {
    keepRunning: record.keepRunning,
    whileDownloading: record.whileDownloading as BackgroundPreferences["whileDownloading"],
  };
}
