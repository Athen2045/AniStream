/**
 * Converts ASS/SSA subtitles to WebVTT for the own player (trial 2026-10-18). Text only: styling,
 * positioning and karaoke are dropped; drawing commands and comment lines are skipped. Cues keep
 * their ASS timing and are sorted by start time.
 */
const MAX_CUES = 20_000;

export function assToVtt(ass: string): string {
  const cues: { start: number; end: number; text: string }[] = [];
  let format: string[] | undefined;
  let inEvents = false;
  for (const raw of ass.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[.+\]$/.test(line)) {
      inEvents = /^\[events\]$/i.test(line);
      continue;
    }
    if (!inEvents) continue;
    if (/^format\s*:/i.test(line)) {
      format = line
        .slice(line.indexOf(":") + 1)
        .split(",")
        .map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(line) || !format) continue;
    const textIndex = format.indexOf("text");
    const startIndex = format.indexOf("start");
    const endIndex = format.indexOf("end");
    if (textIndex < 0 || startIndex < 0 || endIndex < 0) continue;
    // Text is the last field and may itself contain commas.
    const parts = line.slice(line.indexOf(":") + 1).split(",");
    const fields = [...parts.slice(0, textIndex), parts.slice(textIndex).join(",")];
    const start = parseAssTime(fields[startIndex]);
    const end = parseAssTime(fields[endIndex]);
    const text = cleanAssText(fields[textIndex] ?? "");
    if (start === undefined || end === undefined || end <= start || !text) continue;
    cues.push({ start, end, text });
    if (cues.length >= MAX_CUES) break;
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  return [
    "WEBVTT",
    "",
    ...cues.map((cue) => `${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${cue.text}\n`),
  ].join("\n");
}

function parseAssTime(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,3})$/);
  if (!match) return undefined;
  const fraction = Number(match[4].padEnd(3, "0").slice(0, 3)) / 1_000;
  return Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]) + fraction;
}

function cleanAssText(text: string): string {
  // A cue in vector drawing mode (\p1 and above) is a shape, not words.
  if (/\{[^}]*\\p[1-9]/.test(text)) return "";
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\h/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .split("\n")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function vttTime(seconds: number): string {
  const ms = Math.round(seconds * 1_000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const rest = ms % 1_000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(rest).padStart(3, "0")}`;
}
