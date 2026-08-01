const UPPERCASE_TOKENS = new Set(["ONA", "OVA", "TV", "MAL", "MU", "EN", "JP", "CN", "KR"]);

/** Keep media acronyms visually consistent while leaving ordinary labels readable. */
export function formatMediaLabel(value: string | undefined, fallback = "media"): string {
  if (!value) return fallback;
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => {
      const uppercase = part.toLocaleUpperCase();
      if (UPPERCASE_TOKENS.has(uppercase)) return uppercase;
      return `${uppercase.slice(0, 1)}${uppercase.slice(1).toLocaleLowerCase()}`;
    })
    .join(" ");
}
