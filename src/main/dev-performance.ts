import { app } from "electron";

/** Opt-in local timings only: never log request arguments, URLs, results, or errors. */
export function startDevTiming(label: string): (outcome?: "ok" | "error") => void {
  if (app.isPackaged || process.env.ANISTREAM_PERF !== "1") return () => undefined;
  const started = performance.now();
  return (outcome = "ok") => {
    // eslint-disable-next-line no-console -- explicitly requested local development diagnostics
    console.info(
      `[AniStream perf] ${label} ${Math.round(performance.now() - started)}ms ${outcome}`,
    );
  };
}
