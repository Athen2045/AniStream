/**
 * Manga chapter languages AniStream offers (user decision 2026-10-03: English and Japanese only).
 * Saved preferences or settings in any other language fall back to the default.
 */
export const MANGA_LANGUAGES = ["en", "ja"] as const;

export type MangaLanguage = (typeof MANGA_LANGUAGES)[number];

export const DEFAULT_MANGA_LANGUAGE: MangaLanguage = "en";

export function isMangaLanguage(value: unknown): value is MangaLanguage {
  return typeof value === "string" && (MANGA_LANGUAGES as readonly string[]).includes(value);
}

/** Normalizes a stored or configured language, falling back to English when it is not offered. */
export function toMangaLanguage(value: string | undefined | null): MangaLanguage {
  const language = value?.trim().toLowerCase();
  return isMangaLanguage(language) ? language : DEFAULT_MANGA_LANGUAGE;
}
