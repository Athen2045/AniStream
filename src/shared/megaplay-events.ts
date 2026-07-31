export type MegaPlayEvent =
  | {
      kind: "progress";
      currentTime: number;
      duration: number;
      percent?: number;
    }
  | { kind: "complete" }
  | { kind: "error"; message?: string };

export function parseMegaPlayEvent(value: unknown): MegaPlayEvent | undefined {
  const payload = parsePayload(value);
  if (!payload) return undefined;

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
