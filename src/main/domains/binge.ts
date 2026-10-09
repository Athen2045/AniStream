import type { AppDatabase } from "../database";
import { registerTrustedIpcHandler } from "../ipc";

/** Up Next and playlists: local SQLite only. */
export function registerBingeDomain(
  trustedRendererOrigin: string,
  database: AppDatabase | undefined,
): void {
  const store = (): AppDatabase => {
    if (!database) throw new Error("AniStream database is not ready.");
    return database;
  };
  registerTrustedIpcHandler(trustedRendererOrigin, "binge:state", () => store().getBingeState());
  registerTrustedIpcHandler(trustedRendererOrigin, "binge:apply", (_event, change) =>
    store().applyBingeChange(change),
  );
}
