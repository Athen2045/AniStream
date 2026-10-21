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
 * "Did you mean": the candidate title closest to what was typed, offered only within two typos
 * (whole title, or the same number of leading words when the title is longer).
 */
export function closestTitle(query: string, titles: readonly string[]): string | undefined {
  const q = searchNormalize(query);
  if (q.length < 3) return undefined;
  const words = q.split(" ").length;
  let best: { title: string; distance: number } | undefined;
  for (const title of titles) {
    const t = searchNormalize(title);
    if (!t || t === q) continue;
    const head = t.split(" ").slice(0, words).join(" ");
    const distance = Math.min(editDistance(q, t), editDistance(q, head));
    if (distance <= 2 && (!best || distance < best.distance)) best = { title, distance };
  }
  return best?.title;
}

/** Splits a label so the typed part can be bold: [before, match, after] (match may be ""). */
export function highlightMatch(label: string, query: string): [string, string, string] {
  const q = query.trim();
  if (!q) return [label, "", ""];
  const at = label.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  if (at < 0) return [label, "", ""];
  return [label.slice(0, at), label.slice(at, at + q.length), label.slice(at + q.length)];
}
