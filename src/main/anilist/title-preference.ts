/**
 * Which AniList title AniStream shows (user request 2026-10-14). English is the default: AniList's
 * `userPreferred` title follows the signed-in account's setting and is romaji when signed out, so
 * without this the app's language changed with sign-in. Off restores AniList's preferred title.
 *
 * Process-wide because every AniList normalizer reads it; the main process sets it from the stored
 * preference before the first AniList request and whenever Settings changes it.
 */
let preferEnglish = true;

export function setPreferEnglishTitles(value: boolean): void {
  preferEnglish = value;
}

export function prefersEnglishTitles(): boolean {
  return preferEnglish;
}

/** The display title from an AniList `title` object, or undefined when it has none. */
export function chooseAniListTitle(title: {
  userPreferred?: unknown;
  english?: unknown;
  romaji?: unknown;
}): string | undefined {
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  return preferEnglish
    ? (text(title.english) ?? text(title.userPreferred) ?? text(title.romaji))
    : (text(title.userPreferred) ?? text(title.english) ?? text(title.romaji));
}
