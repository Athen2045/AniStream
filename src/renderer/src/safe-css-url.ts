/**
 * Builds a CSS `url(...)` value for an AniList-supplied image URL, safely quoted so a
 * stray `"` in the URL can't break out of the surrounding template-literal CSS string
 * (used for background-image gradients across App/CatalogView/MediaDetailModal).
 * Only accepts https URLs, matching every image host AniList actually returns.
 */
export function safeBackgroundUrl(url: string | undefined): string {
  if (!url || !url.startsWith("https://")) return "none";
  return `url(${JSON.stringify(url)})`;
}
