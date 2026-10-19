/**
 * One page order for every section's For You rows (user request 2026-10-19, after Netflix and HBO
 * Max): rows sit in fixed places by kind instead of re-sorting by score on each load, and
 * personalised rows alternate with the page's own rails (Trending, the watch list) so the page
 * does not read as one long run of "Because you…" rows.
 *
 *   For You (the main rail, rendered by the caller)
 *   slot "afterMain"          e.g. More's watch list
 *   next seasons / films      what the viewer can continue right away
 *   slot "afterContinuation"  Trending: the page's popular anchor
 *   Because you watched #1
 *   Because you like <theme>
 *   slot "middle"             a second popular rail (More: trending shows)
 *   Because you watched #2
 *   Because you like A + B
 *   Because you watched #3 (and any further)
 *   Try something new         exploration last, after what the viewer is known to like
 *   slot "end"                lists and other extras
 */
export type FeedSlot = "afterMain" | "afterContinuation" | "middle" | "end";

export interface FeedRowLike {
  continuation?: boolean;
  theme?: string;
  pair?: string[];
  tryNew?: boolean;
}

export type FeedRowKind = "continuation" | "seed" | "theme" | "pair" | "tryNew";

export type FeedEntry<T> =
  { kind: "row"; row: T; rowKind: FeedRowKind } | { kind: "slot"; slot: FeedSlot };

export function feedRowKind(row: FeedRowLike): FeedRowKind {
  if (row.tryNew) return "tryNew";
  if (row.continuation) return "continuation";
  if (row.pair?.length) return "pair";
  if (row.theme) return "theme";
  return "seed";
}

/**
 * The rows in page order with the slots between them. Seed rows keep the order they came in
 * (strongest first); a missing row simply leaves its place empty, and every slot always appears
 * once, so the page's own rails show even before the feed loads.
 */
export function arrangeFeed<T extends FeedRowLike>(rows: readonly T[]): FeedEntry<T>[] {
  const of = (kind: FeedRowKind) => rows.filter((row) => feedRowKind(row) === kind);
  const seeds = of("seed");
  const entry = (row: T | undefined): FeedEntry<T>[] =>
    row ? [{ kind: "row", row, rowKind: feedRowKind(row) }] : [];
  const slot = (name: FeedSlot): FeedEntry<T> => ({ kind: "slot", slot: name });
  return [
    slot("afterMain"),
    ...of("continuation").flatMap(entry),
    slot("afterContinuation"),
    ...entry(seeds[0]),
    ...of("theme").flatMap(entry),
    slot("middle"),
    ...entry(seeds[1]),
    ...of("pair").flatMap(entry),
    ...seeds.slice(2).flatMap(entry),
    ...of("tryNew").flatMap(entry),
    slot("end"),
  ];
}
