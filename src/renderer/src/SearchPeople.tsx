import type { AniListSearchPerson } from "../../shared/contracts";
import { cachedArtworkUrl } from "../../shared/artwork";
import { CoverImage } from "./CoverImage";
import { isConfidentMatch, searchNormalize } from "./search-helpers";
import type { SearchResults } from "./search-queries";

/** Studios and characters matching an Anime/Manga search; one opens the titles they're in. */
export function SearchPeople({
  people,
  onOpen,
}: {
  people: readonly AniListSearchPerson[];
  onOpen: (person: AniListSearchPerson) => void;
}): React.JSX.Element {
  return (
    <section className="section-search-block">
      <div className="section-search-head">
        <h2>People &amp; studios</h2>
      </div>
      <div className="section-search-people">
        {people.map((row) => (
          <button key={`${row.kind}${row.id}`} type="button" onClick={() => onOpen(row)}>
            {row.imageUrl ? (
              <CoverImage src={cachedArtworkUrl(row.imageUrl)} title={row.name} />
            ) : (
              <span className="section-search-initials" aria-hidden="true">
                {row.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((word) => word[0])
                  .join("")}
              </span>
            )}
            <span>
              <b>{row.name}</b>
              <small>
                {row.kind === "studio" ? "Studio" : `Character · ${row.knownFor ?? ""}`}
              </small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Characters and studios worth showing: when the query clearly names a title, only people whose
 * name is exactly the query (searching "ONE PIECE" should not list a side character).
 */
export function peopleFor(
  results: Extract<SearchResults, { kind: "anilist" }>,
  query: string,
): AniListSearchPerson[] {
  const people = results.extras?.people ?? [];
  const titled = results.items[0] && isConfidentMatch(query, results.items[0].title);
  if (!titled) return people;
  const wanted = searchNormalize(query);
  return people.filter((row) => searchNormalize(row.name) === wanted);
}
