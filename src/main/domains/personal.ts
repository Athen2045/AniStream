import type { AniListClient } from "../anilist";
import type { AppDatabase } from "../database";
import { registerTrustedIpcHandler } from "../ipc";

export function registerPersonalDomain(
  origin: string,
  database: AppDatabase,
  aniList: AniListClient,
): void {
  registerTrustedIpcHandler(origin, "personal:anime-updates", (_event, ids) =>
    aniList.getPersonalAnimeUpdates(ids),
  );
  registerTrustedIpcHandler(origin, "personal:acknowledgements", () =>
    database.getReleaseAcknowledgements(),
  );
  registerTrustedIpcHandler(origin, "personal:acknowledge", (_event, input) =>
    database.acknowledgeRelease(input),
  );
}
