import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ContentCarousel } from "./ContentCarousel";
import { defaultGenre, genreChoices, type GenreSection } from "./starter-rows";

/** The genre each section's row shows, kept for this app session once the viewer picks one. */
const chosen: Partial<Record<GenreSection, string>> = {};

/**
 * One "Genre" row with a genre picker in its heading (user request 2026-10-21, after atlantic.st):
 * choosing a genre swaps the row's titles in place, and View all opens Search filtered to it.
 * The first load waits until the row nears the viewport.
 */
export function GenreRail<T>({
  section,
  load,
  renderCard,
  onViewAll,
}: {
  section: GenreSection;
  /** The genre's titles, already filtered for the page. */
  load: (genre: string) => Promise<T[]>;
  renderCard: (item: T) => ReactNode;
  onViewAll?: (genre: string) => void;
}): React.JSX.Element | null {
  const [genre, setGenre] = useState(() => chosen[section] ?? defaultGenre(section, Date.now()));
  const [near, setNear] = useState(false);
  const [result, setResult] = useState<{ genre: string; items: T[] }>();
  const [failed, setFailed] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  // `load` changes identity on every page render; the latest one is used when a genre loads.
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  }, [load]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setNear(true);
      },
      { rootMargin: "400px" },
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    loader
      .current(genre)
      .then((items) => {
        if (cancelled) return;
        setFailed(false);
        setResult({ genre, items });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [genre, near]);

  const pick = (next: string): void => {
    chosen[section] = next;
    setGenre(next);
  };
  const items = result?.genre === genre ? result.items : undefined;
  // A provider failure on the first load leaves no empty heading behind.
  if (failed && !result) return null;
  return (
    <section ref={sectionRef} className="media-rail genre-rail" aria-label={`Genre: ${genre}`}>
      <div className="rail-heading genre-rail-heading">
        <div className="genre-rail-title">
          <h2>Genre</h2>
          <GenrePicker choices={genreChoices(section)} value={genre} onChange={pick} />
        </div>
        {onViewAll ? (
          <button className="genre-rail-all" type="button" onClick={() => onViewAll(genre)}>
            View all <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {failed ? (
        <p className="latest-updates-error" role="alert">
          {genre} titles could not be loaded. Pick the genre again to retry.
        </p>
      ) : items?.length ? (
        <ContentCarousel label={`${genre} titles`}>{items.map(renderCard)}</ContentCarousel>
      ) : items ? (
        <p className="personal-inbox-empty">No {genre} titles to show right now.</p>
      ) : (
        <div className="rail-skeleton-row" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span className="rail-card-skeleton" key={index} />
          ))}
        </div>
      )}
    </section>
  );
}

function GenrePicker({
  choices,
  value,
  onChange,
}: {
  choices: readonly string[];
  value: string;
  onChange: (genre: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    const outside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };
  const move = (step: number): void => {
    const options = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    options[(index + step + options.length) % options.length]?.focus();
  };

  return (
    <div className="genre-picker" ref={root}>
      <button
        ref={button}
        type="button"
        className="genre-picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Genre: ${value}. Choose another genre`}
        onClick={() => setOpen((current) => !current)}
      >
        {value}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Genres"
          className="genre-picker-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
            else if (event.key === "ArrowDown") move(1);
            else if (event.key === "ArrowUp") move(-1);
            else {
              if (event.key === "Tab") setOpen(false);
              return;
            }
            event.preventDefault();
          }}
        >
          {choices.map((choice) => (
            <button
              key={choice}
              type="button"
              role="option"
              aria-selected={choice === value}
              onClick={() => {
                onChange(choice);
                close();
              }}
            >
              <span>{choice}</span>
              {choice === value ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
