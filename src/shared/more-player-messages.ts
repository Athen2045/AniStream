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
  | { kind: "status"; httpStatus: number }
  /** Play/pause without a position (prefixed events report those separately). */
  | { kind: "playing"; playing: boolean }
  /** The player moved to another episode itself (its next button or auto-next). */
  | { kind: "episode"; season: number; episode: number };

/**
 * Players whose events are `{ type: "<prefix><event>", ...payload }` and carry no TMDB id. Their
 * events are attributed to the title opened in that frame (origin and source are checked first).
 */
export interface PrefixedPlayerEvents {
  eventPrefix: string;
  id: string;
  mediaType: "movie" | "tv";
}

/** Players that post JSON text send small objects; anything longer is not a player event. */
const MAX_MESSAGE_CHARS = 8_192;

export function parseMorePlayerMessage(
  value: unknown,
  prefixed?: PrefixedPlayerEvents,
): MorePlayerMessage | undefined {
  const parsed = typeof value === "string" ? parseJsonText(value) : value;
  const payload = isRecord(parsed) ? parsed : undefined;
  if (prefixed) {
    const type = payload?.type;
    return payload && typeof type === "string" && type.startsWith(prefixed.eventPrefix)
      ? parsePrefixedEvent(payload, type.slice(prefixed.eventPrefix.length), prefixed)
      : undefined;
  }
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

  // Some players name the TMDB id `id` (as a string) and the media type `type`.
  const id =
    data.tmdbId !== undefined ? cleanId(data.tmdbId) : cleanId(numericText(data.id) ?? data.id);
  const kind = data.mediaType ?? data.type;
  const mediaType = kind === "movie" || kind === "tv" ? kind : undefined;
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

/**
 * Reader for players whose events are `{ source: "<eventSource>", event, info }` (the PlayerJS
 * API) and carry no TMDB id: `time` holds only the position, so the reader keeps the last
 * `duration` of its frame. Their `error` reports one of the player's own servers failing before it
 * tries the next, so it is not a failure of the player; the start timeout covers a player that
 * never plays.
 */
export function createSourcedEventReader(opened: {
  eventSource: string;
  id: string;
  mediaType: "movie" | "tv";
}): (value: unknown) => MorePlayerMessage | undefined {
  let duration: number | undefined;
  const title = { id: opened.id, mediaType: opened.mediaType };
  return (value) => {
    if (!isRecord(value) || value.source !== opened.eventSource) return undefined;
    const event = value.event;
    if (event === "duration") {
      duration = finitePositive(value.info) ?? duration;
      return undefined;
    }
    if (event === "time" || event === "seek") {
      const currentTime = finiteNonNegative(value.info);
      if (currentTime === undefined || duration === undefined) return undefined;
      return { kind: "progress", currentTime, duration, ...title };
    }
    if (event === "play" || event === "pause")
      return { kind: "playing", playing: event === "play" };
    if (event === "ended") return { kind: "ended", ...title };
    return undefined;
  };
}

function parsePrefixedEvent(
  payload: Record<string, unknown>,
  event: string,
  opened: PrefixedPlayerEvents,
): MorePlayerMessage | undefined {
  const title = { id: opened.id, mediaType: opened.mediaType };
  if (event === "timeupdate" || event === "seeked") {
    const currentTime = finiteNonNegative(payload.currentTime);
    const duration = finitePositive(payload.duration);
    if (currentTime === undefined || duration === undefined) return undefined;
    return { kind: "progress", currentTime, duration, ...title };
  }
  if (event === "play" || event === "pause") return { kind: "playing", playing: event === "play" };
  if (event === "ended") return { kind: "ended", ...title };
  if (event === "error") return { kind: "error", message: cleanMessage(payload.error) };
  if (event === "nextepisode" && opened.mediaType === "tv") {
    const position = episodePosition(payload.season, payload.episode);
    return position.season !== undefined && position.episode !== undefined
      ? { kind: "episode", season: position.season, episode: position.episode }
      : undefined;
  }
  return undefined;
}

function episodePosition(season: unknown, episode: unknown): { season?: number; episode?: number } {
  const s = positiveInteger(season);
  const e = positiveInteger(episode);
  return s !== undefined && e !== undefined ? { season: s, episode: e } : {};
}

/** A positive integer, also when a player posts it as text ("3"). */
function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === "string" ? numericText(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : undefined;
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

/** A plain positive integer written as text ("322723"), as the `id` field may carry. */
function numericText(value: unknown): number | undefined {
  return typeof value === "string" && /^[1-9]\d{0,11}$/.test(value) ? Number(value) : undefined;
}

function parseJsonText(value: string): unknown {
  if (value.length > MAX_MESSAGE_CHARS || !value.startsWith("{")) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
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
