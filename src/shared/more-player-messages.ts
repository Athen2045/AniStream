export type MorePlayerMessage =
  | {
      kind: "progress";
      currentTime: number;
      duration: number;
      /** From the documented `playing` field, or implied by play/pause events. */
      playing?: boolean;
      id: string;
      mediaType: "movie" | "tv";
      season?: number;
      episode?: number;
    }
  | { kind: "ended"; id: string; mediaType: "movie" | "tv"; season?: number; episode?: number }
  | { kind: "error"; message?: string }
  | { kind: "status"; httpStatus: number };

export function parseMorePlayerMessage(value: unknown): MorePlayerMessage | undefined {
  const payload = isRecord(value) ? value : undefined;
  // Undocumented but observed 2026-10-01: after loading, the player posts the HTTP status of
  // its own server-list request. A 4xx/5xx here means no source could be loaded.
  if (payload?.event === "status") {
    const httpStatus = payload.data;
    return typeof httpStatus === "number" &&
      Number.isInteger(httpStatus) &&
      httpStatus >= 100 &&
      httpStatus <= 599
      ? { kind: "status", httpStatus }
      : undefined;
  }
  if (!payload || payload.type !== "PLAYER_EVENT" || !isRecord(payload.data)) return undefined;

  const data = payload.data;
  const event = data.event;
  if (event === "error") return { kind: "error", message: cleanMessage(data.message) };

  const id = cleanId(data.tmdbId);
  const mediaType =
    data.mediaType === "movie" || data.mediaType === "tv" ? data.mediaType : undefined;
  if (!id || !mediaType) return undefined;
  // Season/episode are optional; TV auto-next changes them inside the same player.
  const position = mediaType === "tv" ? episodePosition(data.season, data.episode) : ({} as const);
  if (event === "ended") return { kind: "ended", id, mediaType, ...position };
  if (
    event === "timeupdate" ||
    event === "playerstatus" ||
    event === "pause" ||
    event === "seeked" ||
    event === "play"
  ) {
    const currentTime = finiteNonNegative(data.currentTime);
    const duration = finitePositive(data.duration);
    if (currentTime === undefined || duration === undefined) return undefined;
    const playing =
      typeof data.playing === "boolean"
        ? data.playing
        : event === "play"
          ? true
          : event === "pause"
            ? false
            : undefined;
    return {
      kind: "progress",
      currentTime,
      duration,
      id,
      mediaType,
      ...position,
      ...(playing === undefined ? {} : { playing }),
    };
  }
  return undefined;
}

function episodePosition(season: unknown, episode: unknown): { season?: number; episode?: number } {
  const s = positiveInteger(season);
  const e = positiveInteger(episode);
  return s !== undefined && e !== undefined ? { season: s, episode: e } : {};
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanId(value: unknown): string | undefined {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > 999_999_999_999
  )
    return undefined;
  return String(value);
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function cleanMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value.replaceAll(/\s+/gu, " ").trim();
  return message ? message.slice(0, 300) : undefined;
}
