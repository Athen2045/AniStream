import { ExternalLink, Pencil, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  MoreCatalogItem,
  SimklLibraryItem,
  SimklProfile,
  SimklStatus,
} from "../../shared/contracts";
import { CoverImage } from "./CoverImage";
import { Select } from "./Select";
import { SourceLogo } from "./SourceLogo";
import { ProfileHeroBand } from "./ProfileHeroBand";
import { ProfileLookDialog } from "./ProfileLookDialog";
import { usePicturePalette } from "./profile-look";
import { ProfileSyncChip, type ProfileSyncSource } from "./ProfileSyncChip";

export type SimklTab = "MOVIE" | "TV";
type SimklStatusKey = SimklLibraryItem["status"];

const STATUS_LABELS: Record<SimklStatusKey, string> = {
  watching: "Watching",
  planning: "Plan to Watch",
  completed: "Completed",
  paused: "On Hold",
  dropped: "Dropped",
};
// Same order as the AniList library shelves; the first non-empty one opens.
const STATUS_ORDER: SimklStatusKey[] = ["watching", "completed", "paused", "dropped", "planning"];

/** A Simkl title as a More catalog item, so it opens the usual More title page. */
export function simklItemToMore(item: SimklLibraryItem): MoreCatalogItem | undefined {
  if (item.tmdbId === undefined) return undefined;
  return {
    id: item.tmdbId,
    type: item.type,
    title: item.title,
    posterUrl: item.posterUrl,
    year: item.year,
    genres: [],
    siteUrl: `https://www.themoviedb.org/${item.type === "MOVIE" ? "movie" : "tv"}/${item.tmdbId}`,
  };
}

/** The Simkl-only profile (no AniList account): Movies and TV shows. */
export function SimklProfileView({
  profile,
  status,
  statsLoading = false,
  syncSources = [],
  onOpenMore,
}: {
  profile: SimklProfile | undefined;
  status: SimklStatus;
  /** Watch time is still being read from Simkl. */
  statsLoading?: boolean;
  syncSources?: readonly ProfileSyncSource[];
  onOpenMore: (item: MoreCatalogItem) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<SimklTab>("MOVIE");
  const [editing, setEditing] = useState(false);
  const auth = status.auth.status === "connected" ? status.auth : undefined;
  const picture = profile?.avatarUrl ?? auth?.avatarUrl;
  const palette = usePicturePalette(picture);
  const items = useMemo(() => profile?.items ?? [], [profile]);
  const counts = useMemo(() => simklCounts(items), [items]);

  return (
    <div
      className="profile-page profile-page--simkl"
      style={palette ? ({ "--profile-accent": palette[0] } as React.CSSProperties) : undefined}
    >
      <header className="profile-header">
        <ProfileHeroBand pictureUrl={picture} />
        <ProfileSyncChip sources={syncSources} />
        <EditLookButton onClick={() => setEditing(true)} />
        <div className="profile-main">
          <div className="profile-avatar-xl">
            {picture ? (
              <img src={picture} alt={`${auth?.userName ?? "Simkl"} picture`} decoding="async" />
            ) : null}
          </div>
          <div className="profile-identity">
            <p className="title-kicker">
              <span className="profile-source">
                <SourceLogo source="simkl" />
                Simkl profile
              </span>
              <span className="profile-connected">Connected</span>
            </p>
            <h1 data-profile-heading tabIndex={-1}>
              {profile?.name ?? auth?.userName ?? "Simkl"}
            </h1>
            {profile?.joinedAt ? (
              <p className="profile-about">On Simkl since {monthYear(profile.joinedAt)}</p>
            ) : null}
            <div className="profile-stat-pair" aria-label="Simkl statistics">
              <div>
                <strong>
                  {(profile ? counts.movies : (status.library?.movies ?? 0)).toLocaleString()}
                  <small>movies</small>
                </strong>
                {profile?.stats ? (
                  <span>{hours(profile.stats.movieMinutes)} watched</span>
                ) : statsLoading || !profile ? (
                  <StatPlaceholder width={120} />
                ) : (
                  <span>{counts.moviesDone} completed</span>
                )}
              </div>
              <div>
                <strong>
                  {(profile ? counts.shows : (status.library?.shows ?? 0)).toLocaleString()}
                  <small>TV shows</small>
                </strong>
                {profile ? (
                  <span>
                    {counts.episodes.toLocaleString()} episodes
                    {profile.stats ? ` · ${days(profile.stats.tvMinutes)}` : ""}
                  </span>
                ) : (
                  <StatPlaceholder width={150} />
                )}
              </div>
              {counts.rated ? (
                <div>
                  <strong>
                    {counts.mean.toFixed(1)}
                    <small>mean rating</small>
                  </strong>
                  <span>across {counts.rated} rated titles</span>
                </div>
              ) : null}
            </div>
          </div>
          <dl className="title-facts profile-sync">
            <SimklSyncRow status={status} label="Simkl sync" />
            <div>
              <dt>Watching</dt>
              <dd>{counts.byStatus.watching}</dd>
            </div>
            <div>
              <dt>Plan to watch</dt>
              <dd>{counts.byStatus.planning}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{counts.byStatus.completed}</dd>
            </div>
            <div>
              <dt>Offline copy</dt>
              <dd>Saved on this device</dd>
            </div>
          </dl>
        </div>
      </header>

      <nav className="title-tabs profile-tabs" aria-label="Profile sections">
        {(
          [
            ["MOVIE", "Movies"],
            ["TV", "TV shows"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? "is-active" : undefined}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
        <a
          className="profile-anilist-link"
          href="https://simkl.com/"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} aria-hidden="true" />
          Simkl
        </a>
      </nav>

      {!profile ? (
        <LibraryPlaceholder />
      ) : (
        <SimklLibraryPanel key={tab} items={items} type={tab} onOpenMore={onOpenMore} />
      )}
      <ProfileCredits anilist={false} />
      {editing ? (
        <ProfileLookDialog
          simklPicture={picture}
          simklName={auth?.userName}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

/** A shimmering line where a number is still on its way. */
export function StatPlaceholder({ width }: { width: number }): React.JSX.Element {
  return <span className="sk-line profile-stat-placeholder" style={{ width }} aria-hidden="true" />;
}

/** Poster shapes until the saved Simkl copy is read. */
function LibraryPlaceholder(): React.JSX.Element {
  return (
    <section className="library-shell" aria-busy="true" aria-label="Loading your Simkl library">
      <div className="media-grid library-grid">
        {Array.from({ length: 14 }, (_, index) => (
          <span key={index} className="sk-block profile-poster-placeholder" />
        ))}
      </div>
    </section>
  );
}

export function EditLookButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" className="profile-edit-look" onClick={onClick}>
      <Pencil size={14} aria-hidden="true" />
      Edit look
    </button>
  );
}

export function SimklSyncRow({
  status,
  label,
}: {
  status: SimklStatus;
  label: string;
}): React.JSX.Element {
  const library = status.library;
  return (
    <div>
      <dt className="profile-sync-source">
        <SourceLogo source="simkl" />
        {label}
      </dt>
      <dd className={library?.error ? "is-pending" : "is-synced"}>
        {library?.syncing ? (
          "Updating…"
        ) : library?.error ? (
          <>
            Saved copy ·{" "}
            <button
              type="button"
              className="profile-sync-retry"
              onClick={() => void window.anistream.syncSimkl().catch(() => undefined)}
            >
              Retry
            </button>
          </>
        ) : library?.syncedAt ? (
          `Up to date · ${ago(library.syncedAt)}`
        ) : (
          "Not synced yet"
        )}
      </dd>
    </div>
  );
}

/** Data credits under the profile (Simkl asks apps to name it where its data appears). */
export function ProfileCredits({ anilist }: { anilist: boolean }): React.JSX.Element {
  return (
    <p className="profile-credits">
      Data from
      {anilist ? (
        <a href="https://anilist.co/" target="_blank" rel="noreferrer">
          <SourceLogo source="anilist" />
          AniList
        </a>
      ) : null}
      <a href="https://simkl.com/" target="_blank" rel="noreferrer">
        <SourceLogo source="simkl" />
        Simkl
      </a>
      <span>· your library is kept on this device</span>
    </p>
  );
}

export function simklCounts(items: readonly SimklLibraryItem[]) {
  const byStatus: Record<SimklStatusKey, number> = {
    watching: 0,
    planning: 0,
    completed: 0,
    paused: 0,
    dropped: 0,
  };
  let rated = 0;
  let total = 0;
  let episodes = 0;
  let movies = 0;
  let moviesDone = 0;
  for (const item of items) {
    byStatus[item.status] += 1;
    if (item.type === "MOVIE") {
      movies += 1;
      if (item.status === "completed") moviesDone += 1;
    } else episodes += item.watchedEpisodes;
    if (item.rating) {
      rated += 1;
      total += item.rating;
    }
  }
  return {
    byStatus,
    movies,
    moviesDone,
    shows: items.length - movies,
    showsDone: items.filter((item) => item.type === "TV" && item.status === "completed").length,
    episodes,
    rated,
    mean: rated ? total / rated : 0,
  };
}

/** Movies or TV shows from the imported Simkl library, by Simkl status. */
export function SimklLibraryPanel({
  items,
  type,
  onOpenMore,
}: {
  items: readonly SimklLibraryItem[];
  type: SimklTab;
  onOpenMore: (item: MoreCatalogItem) => void;
}): React.JSX.Element {
  const ofType = useMemo(() => items.filter((item) => item.type === type), [items, type]);
  const shelves = STATUS_ORDER.map((status) => ({
    status,
    items: ofType.filter((item) => item.status === status),
  })).filter((shelf) => shelf.items.length);
  const [chosen, setChosen] = useState<SimklStatusKey>();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"UPDATED" | "TITLE" | "RATING" | "YEAR">("UPDATED");
  const active = shelves.find((shelf) => shelf.status === chosen) ?? shelves[0];
  const noun = type === "MOVIE" ? "movies" : "shows";
  const count = (n: number): string =>
    `${n} ${n === 1 ? (type === "MOVIE" ? "movie" : "show") : noun}`;
  const visible = (() => {
    const needle = query.trim().toLowerCase();
    const list = (active?.items ?? []).filter(
      (item) => !needle || item.title.toLowerCase().includes(needle),
    );
    const by = {
      UPDATED: (a: SimklLibraryItem, b: SimklLibraryItem) =>
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      TITLE: (a: SimklLibraryItem, b: SimklLibraryItem) => a.title.localeCompare(b.title),
      RATING: (a: SimklLibraryItem, b: SimklLibraryItem) => (b.rating ?? 0) - (a.rating ?? 0),
      YEAR: (a: SimklLibraryItem, b: SimklLibraryItem) => (b.year ?? 0) - (a.year ?? 0),
    }[sort];
    return [...list].sort(by);
  })();

  return (
    <section className="library-shell">
      <div className="library-chips" role="tablist" aria-label={`${noun} lists`}>
        {shelves.map((shelf) => (
          <button
            key={shelf.status}
            type="button"
            role="tab"
            aria-selected={shelf === active}
            className={shelf === active ? "is-active" : undefined}
            onClick={() => setChosen(shelf.status)}
          >
            {STATUS_LABELS[shelf.status]}
            <em>{shelf.items.length}</em>
          </button>
        ))}
      </div>
      <div className="library-toolbar">
        <label className="library-search">
          <span className="sr-only">Filter this list</span>
          <Search size={16} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Filter ${noun} by title`}
          />
        </label>
        <Select
          className="library-sort"
          value={sort}
          onChange={setSort}
          ariaLabel={`Sort ${noun}`}
          options={[
            { value: "UPDATED", label: "Recently watched" },
            { value: "TITLE", label: "Title A-Z" },
            { value: "RATING", label: "Your rating" },
            { value: "YEAR", label: "Newest first" },
          ]}
        />
      </div>
      <div className="library-results">
        <div className="library-heading">
          <h2>{active ? STATUS_LABELS[active.status] : "Nothing yet"}</h2>
          <span aria-live="polite">{count(visible.length)}</span>
        </div>
        <div className="media-grid library-grid">
          {visible.map((item) => (
            <SimklCard key={item.simklId} item={item} onOpenMore={onOpenMore} />
          ))}
        </div>
        {!visible.length ? (
          <div className="empty-state">
            <h3>Nothing here yet</h3>
            <p>
              {query
                ? "Try another filter."
                : `${type === "MOVIE" ? "Movies" : "Shows"} you track on Simkl appear here after a sync.`}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SimklCard({
  item,
  onOpenMore,
}: {
  item: SimklLibraryItem;
  onOpenMore: (item: MoreCatalogItem) => void;
}): React.JSX.Element {
  const more = simklItemToMore(item);
  const progress =
    item.type === "TV" && item.totalEpisodes
      ? Math.min(100, Math.round((item.watchedEpisodes / item.totalEpisodes) * 100))
      : undefined;
  const meta = [
    item.year,
    item.type === "TV"
      ? item.totalEpisodes
        ? `${item.watchedEpisodes}/${item.totalEpisodes} ep`
        : item.watchedEpisodes
          ? `${item.watchedEpisodes} ep`
          : undefined
      : "Movie",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      className="simkl-card"
      disabled={!more}
      title={more ? item.title : `${item.title} (Simkl has no TMDB match yet)`}
      onClick={() => more && onOpenMore(more)}
    >
      <span className="simkl-card-art">
        <CoverImage src={item.posterUrl} title={item.title} />
        {item.rating ? (
          <span className="simkl-card-rating" aria-label={`Your rating ${item.rating}`}>
            <Star size={11} fill="currentColor" aria-hidden="true" />
            {item.rating}
          </span>
        ) : null}
      </span>
      {progress !== undefined ? (
        <span className="simkl-card-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      ) : null}
      <strong>{item.title}</strong>
      <small>{meta}</small>
    </button>
  );
}

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hoursAgo = Math.round(minutes / 60);
  if (hoursAgo < 24) return `${hoursAgo} h ago`;
  return `${Math.round(hoursAgo / 24)} d ago`;
}

export function hours(minutes: number): string {
  return `${Math.round(minutes / 60).toLocaleString()} hours`;
}

export function days(minutes: number): string {
  const value = minutes / 1440;
  return value >= 1 ? `${Math.round(value).toLocaleString()} days` : hours(minutes);
}

function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
