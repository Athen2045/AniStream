/** Lower-case, accent-free words, so "Sōsō no Frieren" and "soso no frieren" compare equal. */
export function searchNormalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The first result earns the wide "Top result" card only when it clearly is what was typed: the
 * same title, or a title that starts with the query (at least four letters typed).
 */
export function isConfidentMatch(query: string, title: string): boolean {
  const q = searchNormalize(query);
  const t = searchNormalize(title);
  if (!q || !t) return false;
  return t === q || (q.length >= 4 && t.startsWith(`${q} `)) || (q.length >= 4 && t.startsWith(q));
}

/** Optimal string alignment distance (Damerau–Levenshtein with adjacent swaps). */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * "Did you mean": the candidate titles within two typos of what was typed (whole title, or the
 * same number of leading words when the title is longer), closest first. Equally close titles
 * prefer the one nearest as a whole ("narto" → "Naruto" before "Naruto: Shippuden"), then keep
 * their given order (popularity).
 */
export function closeTitles(query: string, titles: readonly string[]): string[] {
  const q = searchNormalize(query);
  if (q.length < 3) return [];
  const words = q.split(" ").length;
  const close: Array<{ title: string; distance: number; whole: number; index: number }> = [];
  titles.forEach((title, index) => {
    const t = searchNormalize(title);
    if (!t || t === q) return;
    const head = t.split(" ").slice(0, words).join(" ");
    const whole = editDistance(q, t);
    const distance = Math.min(whole, editDistance(q, head));
    if (distance <= 2) close.push({ title, distance, whole, index });
  });
  return close
    .sort((a, b) => a.distance - b.distance || a.whole - b.whole || a.index - b.index)
    .map((row) => row.title)
    .filter((title, index, all) => all.indexOf(title) === index);
}

/** The closest of `closeTitles`, or undefined when none is within two typos. */
export function closestTitle(query: string, titles: readonly string[]): string | undefined {
  return closeTitles(query, titles)[0];
}
