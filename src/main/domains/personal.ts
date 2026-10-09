import type { AniListClient } from "../anilist";
import { registerTrustedIpcHandler } from "../ipc";

export function registerPersonalDomain(origin: string, aniList: AniListClient): void {
  registerTrustedIpcHandler(origin, "personal:anime-updates", (_event, ids) =>
    aniList.getPersonalAnimeUpdates(ids),
  );
}
