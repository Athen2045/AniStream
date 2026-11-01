import type {
  AnimePlaybackCandidate,
  AnimePlaybackInput,
  AnimePlaybackResult,
} from "../shared/contracts";
import { fillUrlTemplate, type AnimeAniListEmbedProvider } from "./provider-config";

/** Audio order for one player: the requested audio first. */
function audioOrder(input: AnimePlaybackInput): readonly ("sub" | "dub")[] {
  return input.audio === "dub" ? ["dub", "sub"] : ["sub", "dub"];
}

/**
 * Candidates for a player addressed by AniList id (no episode index): one per audio. Its own
 * previous/next buttons show only where AniStream's episode list has those episodes
 * (`episodeButtonParams`); AniStream plays them. The saved position goes in `startAtParam`.
 */
export function aniListEmbedCandidates(
  config: AnimeAniListEmbedProvider,
  input: AnimePlaybackInput,
): AnimePlaybackCandidate[] {
  if (!Number.isSafeInteger(input.aniListId) || input.aniListId <= 0)
    throw new Error("Invalid AniList media ID.");
  if (!Number.isSafeInteger(input.episode) || input.episode <= 0)
    throw new Error("Invalid episode number.");
  return audioOrder(input).map((audio) => {
    const url = new URL(
      fillUrlTemplate(config.episodeUrl, {
        aniListId: input.aniListId,
        episode: input.episode,
        audio,
      }),
    );
    if (url.origin !== config.playerOrigin) throw new Error("Player URL left its origin.");
    if (config.episodeButtonParams) {
      url.searchParams.set(config.episodeButtonParams.previous, input.hasPrevious ? "1" : "0");
      url.searchParams.set(config.episodeButtonParams.next, input.hasNext ? "1" : "0");
    }
    const startAt = Math.floor(input.startAtSeconds ?? 0);
    if (config.startAtParam && Number.isFinite(startAt) && startAt > 0)
      url.searchParams.set(config.startAtParam, String(startAt));
    return {
      id: `${config.id}:${input.aniListId}:${input.episode}:${audio}`,
      label: audio === "sub" ? "Japanese · subtitles" : "English dub",
      kind: "embed",
      url: url.toString(),
      language: audio,
      provider: "anime-source",
      player: config.id,
      ...(config.eventSource ? { eventSource: config.eventSource } : {}),
    };
  });
}

export type AnimePlayers = readonly (
  | { kind: "anilist-embed"; config: AnimeAniListEmbedProvider }
  | {
      kind: "indexed";
      id: string;
      getPlayback: (input: AnimePlaybackInput) => Promise<AnimePlaybackResult>;
    }
)[];

/**
 * The anime players in configured order: AniList-addressed players build their candidates here;
 * the indexed player (`indexed`) supplies its own. A player that fails is skipped, so one broken
 * source never hides the others.
 */
export async function animePlaybackFromPlayers(
  players: AnimePlayers,
  input: AnimePlaybackInput,
): Promise<AnimePlaybackResult> {
  const candidates: AnimePlaybackCandidate[] = [];
  const attemptedSources: string[] = [];
  let message: string | undefined;
  for (const player of players) {
    try {
      if (player.kind === "anilist-embed") {
        attemptedSources.push(player.config.id);
        candidates.push(...aniListEmbedCandidates(player.config, input));
      } else {
        const result = await player.getPlayback(input);
        attemptedSources.push(...result.attemptedSources);
        candidates.push(
          ...result.candidates.map((candidate) => ({ ...candidate, player: player.id })),
        );
        message ??= result.message;
      }
    } catch (reason) {
      message ??= reason instanceof Error ? reason.message : String(reason);
    }
  }
  return {
    status: candidates.length > 0 ? "available" : "unavailable",
    candidates,
    attemptedSources,
    ...(message && candidates.length === 0 ? { message } : {}),
  };
}
