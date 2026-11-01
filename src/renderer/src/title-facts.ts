import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  MangaEnrichment,
} from "../../shared/contracts";
import { formatMediaLabel } from "./format-label";
import { decodeHtmlEntities } from "../../shared/text";

export function titleKicker(media: AniListCatalogMedia, detail?: AniListMediaDetail): string[] {
  const parts: string[] = [];
  if (media.type === "MANGA") {
    parts.push(publicationKind(detail?.countryOfOrigin, media.format));
    const start = detail?.startDate?.slice(0, 4);
    const end = detail?.endDate?.slice(0, 4);
    if (start) parts.push(end && end !== start ? `${start}–${end}` : start);
  } else {
    parts.push(formatMediaLabel(media.format, "Anime"));
    if (media.season && media.seasonYear)
      parts.push(`${formatMediaLabel(media.season)} ${media.seasonYear}`);
    else if (media.seasonYear) parts.push(String(media.seasonYear));
    if (media.totalProgress) parts.push(`${media.totalProgress} episodes`);
    if (detail?.studios[0]) parts.push(detail.studios[0]);
  }
  if (media.status) parts.push(formatMediaLabel(media.status));
  return parts.filter((part, index, all) => part && all.indexOf(part) === index);
}

export function titleFacts(
  detail: AniListMediaDetail,
  enrichment?: MangaEnrichment,
): Array<[string, string]> {
  const facts: Array<[string, string | undefined]> =
    detail.type === "ANIME"
      ? [
          ["Status", formatMediaLabel(detail.status, "—")],
          ["Aired", dateRange(detail.startDate, detail.endDate, detail.status)],
          [
            "Episodes",
            detail.totalProgress
              ? `${detail.totalProgress}${detail.duration ? ` × ${detail.duration}m` : ""}`
              : undefined,
          ],
          ["Studio", detail.studios.join(", ") || undefined],
          // The original creator replaces the source medium (user request 2026-10-08).
          ["Original Creator", staffWithRole(detail, ORIGINAL_CREATOR_ROLE)],
          ["Country", countryName(detail.countryOfOrigin)],
        ]
      : [
          ["Status", formatMediaLabel(detail.status, "—")],
          ["Published", dateRange(detail.startDate, detail.endDate, detail.status)],
          ["Chapters", detail.totalProgress ? String(detail.totalProgress) : "Ongoing"],
          ["Volumes", detail.totalVolumes ? String(detail.totalVolumes) : undefined],
          ["Original language", languageName(detail.countryOfOrigin)],
          // Story credits only (user request 2026-10-08); MangaBaka's writers fill in when AniList
          // lists none of these roles.
          ...mangaStoryCredits(detail, enrichment),
          ...(enrichment?.status === "available"
            ? ([["Publishers", enrichment.publishers.join(", ") || undefined]] satisfies Array<
                [string, string | undefined]
              >)
            : []),
        ];
  return facts.filter((fact): fact is [string, string] => Boolean(fact[1]));
}

function dateRange(start?: string, end?: string, status?: string): string | undefined {
  if (!start) return undefined;
  const from = formatFuzzyDate(start);
  if (end && end !== start) return `${from} – ${formatFuzzyDate(end)}`;
  return status === "RELEASING" ? `${from} – present` : from;
}

function formatFuzzyDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!month) return String(year);
  return new Date(year, month - 1, day || 1).toLocaleDateString("en-US", {
    month: "short",
    ...(day ? { day: "numeric" } : {}),
    year: "numeric",
  });
}

function publicationKind(country?: string, format?: string): string {
  if (format && format !== "MANGA") return formatMediaLabel(format);
  if (country === "KR") return "Manhwa";
  if (country === "CN" || country === "TW") return "Manhua";
  return "Manga";
}

function countryName(country?: string): string | undefined {
  return ({ JP: "Japan", KR: "South Korea", CN: "China", TW: "Taiwan" } as Record<string, string>)[
    country ?? ""
  ];
}

function languageName(country?: string): string | undefined {
  return ({ JP: "Japanese", KR: "Korean", CN: "Chinese", TW: "Chinese" } as Record<string, string>)[
    country ?? ""
  ];
}

export function entryStatusLabel(status: string, anime: boolean): string {
  switch (status) {
    case "CURRENT":
      return anime ? "Watching" : "Reading";
    case "REPEATING":
      return anime ? "Rewatching" : "Rereading";
    case "PLANNING":
      return "Planning";
    case "COMPLETED":
      return "Completed";
    case "PAUSED":
      return "Paused";
    case "DROPPED":
      return "Dropped";
    default:
      return formatMediaLabel(status);
  }
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const ORIGINAL_CREATOR_ROLE = /^original (?:creator|story)\b/i;
const MANGA_STORY_ROLES: Array<[label: string, role: RegExp]> = [
  ["Original Story", /^original (?:story|creator)\b/i],
  ["Story & Art", /^story\s*(?:&|and)\s*art\b/i],
  ["Story", /^story\b(?!\s*(?:&|and))/i],
];

/** Names AniList credits with a role (roles may carry notes, e.g. "Story (ch 1-5)"). */
function staffWithRole(detail: AniListMediaDetail, role: RegExp): string | undefined {
  const names = detail.staff
    .filter((person) => role.test((person.role ?? "").trim()))
    .map((person) => person.name)
    .filter((name, index, all) => all.indexOf(name) === index);
  return names.length ? names.slice(0, 3).join(", ") : undefined;
}

function mangaStoryCredits(
  detail: AniListMediaDetail,
  enrichment?: MangaEnrichment,
): Array<[string, string | undefined]> {
  const credits = MANGA_STORY_ROLES.map(([label, role]): [string, string | undefined] => [
    label,
    staffWithRole(detail, role),
  ]).filter(([, names]) => names);
  if (credits.length) return credits;
  return enrichment?.status === "available" && enrichment.authors.length
    ? [["Story", enrichment.authors.slice(0, 3).join(", ")]]
    : [];
}

/** "Summary", "Summary and English title", "Summary, English title and genres". */
export function joinWords(parts: string[]): string {
  const sentence =
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
  return sentence.charAt(0).toLocaleUpperCase() + sentence.slice(1);
}

/** Plain text from an AniList (HTML/markdown-ish) or MAL summary; undefined when empty. */
export function cleanDescription(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  return decodeHtmlEntities(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/~!|!~/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function distinctExternalLinks(
  links: AniListMediaDetail["externalLinks"],
): AniListMediaDetail["externalLinks"] {
  const seenSites = new Set<string>();
  return links.filter((link) => {
    const key = link.site.trim().toLocaleLowerCase();
    if (seenSites.has(key)) return false;
    seenSites.add(key);
    return true;
  });
}
