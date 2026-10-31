import type { AnimePlaybackCandidate } from "../../shared/contracts";

/** The own player (direct streams, downloads): always last in the order. */
export const ANIME_BACKUP_PLAYER = "backup";

const MAX_REMEMBERED_TITLES = 200;

/**
 * The player chosen with "Switch player" per AniList title, for this app session only (nothing is
 * persisted), so the next episode opens on the same player. Bounded, oldest first out.
 */
export const animePlayerChoice = {
  chosen: new Map<number, string>(),
  get(mediaId: number): string | undefined {
    return this.chosen.get(mediaId);
  },
  set(mediaId: number, player: string): void {
    this.chosen.delete(mediaId);
    this.chosen.set(mediaId, player);
    if (this.chosen.size > MAX_REMEMBERED_TITLES)
      this.chosen.delete(this.chosen.keys().next().value!);
  },
  delete(mediaId: number): void {
    this.chosen.delete(mediaId);
  },
};

/**
 * Audio picked in a player's own menu during playback, per AniList title for this app session:
 * the title's next episodes open in it (Settings keeps the default for everything else).
 */
export const animeAudioChoice = new Map<number, "sub" | "dub">();

/** Embedded players in the order main returned their candidates, then the backup player. */
export function animePlayerOrder(candidates: readonly AnimePlaybackCandidate[]): string[] {
  const players: string[] = [];
  for (const candidate of candidates) {
    const player = candidate.player ?? "main";
    if (!players.includes(player)) players.push(player);
  }
  return [...players, ANIME_BACKUP_PLAYER];
}
