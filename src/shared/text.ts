const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "•",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
  lsquo: "‘",
};

/** Decode the small, display-safe HTML entity set commonly returned by providers. */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (match, digits: string) => decodeCodePoint(match, digits, 10))
    .replace(/&#x([\da-f]+);/gi, (match, digits: string) => decodeCodePoint(match, digits, 16))
    .replace(/&([a-z][\da-z]+);/gi, (match, name: string) => {
      return NAMED_HTML_ENTITIES[name.toLocaleLowerCase()] ?? match;
    });
}

/** Strip provider markup and normalize text before it reaches the renderer. */
export function cleanDisplayText(value: string, maxLength = 500): string {
  return decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function decodeCodePoint(match: string, digits: string, radix: number): string {
  const codePoint = Number.parseInt(digits, radix);
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return match;
  }
}
