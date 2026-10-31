/** What a player that reports it says is playing: AniList id, episode and audio. */
export interface AnimePlayerIdentity {
  aniListId?: number;
  episode?: number;
  language?: "sub" | "dub";
}

export type AnimePlayerMessage =
  | ({
      kind: "progress";
      currentTime: number;
      duration: number;
      percent?: number;
    } & AnimePlayerIdentity)
  | ({ kind: "complete" } & AnimePlayerIdentity)
  | { kind: "error"; message?: string };

/**
 * `eventSource`: for players whose events are `{ source, type: "event", name, data }` with the
 * AniList id, episode and language in `data` (only their own format is accepted then).
 */
export function parseAnimePlayerMessage(
  value: unknown,
  eventSource?: string,
): AnimePlayerMessage | undefined {
  const payload = parsePayload(value);
  if (!payload) return undefined;
  if (eventSource) return parseSourcedEvent(payload, eventSource);

  if (payload.event === "complete") return { kind: "complete" };
  if (payload.event === "error") {
    return {
      kind: "error",
      message: cleanMessage(payload.message),
    };
  }

  if (payload.event === "time") {
    const currentTime = finiteNonNegative(payload.time);
    const duration = finitePositive(payload.duration);
    const percent = finitePercent(payload.percent);
    if (currentTime === undefined || duration === undefined) return undefined;
    return { kind: "progress", currentTime, duration, percent };
  }

  if (payload.type === "watching-log") {
    const currentTime = finiteNonNegative(payload.currentTime);
    const duration = finitePositive(payload.duration);
    if (currentTime === undefined || duration === undefined) return undefined;
    return { kind: "progress", currentTime, duration };
  }

  return undefined;
}

function parseSourcedEvent(
  payload: Record<string, unknown>,
  eventSource: string,
): AnimePlayerMessage | undefined {
  if (payload.source !== eventSource || payload.type !== "event" || !isRecord(payload.data))
    return undefined;
  const data = payload.data;
  const aniListId =
    typeof data.animeId === "string" && /^[1-9]\d{0,9}$/.test(data.animeId)
      ? Number(data.animeId)
      : positiveInteger(data.animeId);
  const identity: AnimePlayerIdentity = {
    ...(aniListId === undefined ? {} : { aniListId }),
    ...(positiveInteger(data.episode) === undefined ? {} : { episode: data.episode as number }),
    ...(data.language === "sub" || data.language === "dub" ? { language: data.language } : {}),
  };
  const name = payload.name;
  if (name === "ended") return { kind: "complete", ...identity };
  if (name === "error")
    return { kind: "error", message: cleanMessage(data.message) ?? cleanMessage(data.error) };
  if (name === "progress" || name === "play" || name === "pause" || name === "seeked") {
    const currentTime = finiteNonNegative(data.currentTime);
    const duration = finitePositive(data.duration);
    if (currentTime === undefined || duration === undefined) return undefined;
    return {
      kind: "progress",
      currentTime,
      duration,
      percent: finitePercent(data.percentage),
      ...identity,
    };
  }
  return undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function parsePayload(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    if (value.length > 4_096) return undefined;
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return isRecord(value) ? value : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finitePercent(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

function cleanMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value.replaceAll(/\s+/g, " ").trim();
  return message ? message.slice(0, 300) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
