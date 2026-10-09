import { ExternalLink, LayoutGrid, List, Plus, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListDashboard,
  AniListEntry,
  AniListMedia,
  AniListMediaType,
  MoreCatalogItem,
  SimklProfile,
  SimklStatus,
} from "../../shared/contracts";
import { cachedArtworkUrl } from "../../shared/artwork";
import { motionTransition } from "./motion";
import { LibraryCard, LibraryRow } from "./LibraryCard";
import { SearchView } from "./SearchView";
import type { ViewerAccess } from "./viewer-access";
import { useAppReducedMotion } from "./useAppReducedMotion";
import { Select } from "./Select";
import { formatMediaLabel } from "./format-label";
import { usePersonalLibrary } from "./PersonalLibraryProvider";
import {
  buildLibraryShelves,
  meanScore,
  readLibraryView,
  shelfFormats,
  writeLibraryView,
  type LibraryShelf,
  type LibrarySort,
  type LibraryView,
} from "./profile-library";
import { ProfileHeroBand } from "./ProfileHeroBand";
import { ProfileLookDialog } from "./ProfileLookDialog";
import { SourceLogo } from "./SourceLogo";
import { choosePicture, useProfileLook } from "./profile-look";
import { ProfileSyncChip, type ProfileSyncSource } from "./ProfileSyncChip";
import {
  EditLookButton,
  StatPlaceholder,
  ProfileCredits,
  SimklLibraryPanel,
  SimklSyncRow,
  days,
  simklCounts,
} from "./SimklProfile";

type ProfileSection = "LIBRARY" | "MOVIE" | "TV";

export function ProfileView({
  dashboard,
  mediaType,
  shelves,
  activeShelfKey,
  formatFilter,
  visibleEntries,
  listQuery,
  librarySort,
  adding,
  error,
  onSwitchType,
  onSelectShelf,
  onFormatFilter,
  onListQuery,
  onLibrarySort,
  onToggleAdding,
  onEdit,
  access,
  onLibrary,
  onOpenMedia,
  simkl,
  simklStatus,
  simklStatsLoading = false,
  syncSources = [],
  onOpenMore,
}: {
  dashboard: AniListDashboard;
  mediaType: AniListMediaType;
  shelves: LibraryShelf[];
  activeShelfKey: string;
  formatFilter: string;
  visibleEntries: AniListEntry[];
  listQuery: string;
  librarySort: LibrarySort;
  adding: boolean;
  error?: string;
  onSwitchType: (type: AniListMediaType) => void;
  onSelectShelf: (key: string) => void;
  onFormatFilter: (format: string) => void;
  onListQuery: (value: string) => void;
  onLibrarySort: (value: LibrarySort) => void;
  onToggleAdding: () => void;
  access: ViewerAccess;
  onEdit: (entry: AniListEntry) => void;
  onLibrary: (media: AniListCatalogMedia) => Promise<void>;
  onOpenMedia: (media: AniListMedia, action: "details" | "play" | "read") => void;
  /** Present while Simkl is connected too: the combined profile (user decision 2026-10-06). */
  simkl?: SimklProfile;
  simklStatus?: SimklStatus;
  simklStatsLoading?: boolean;
  /** Accounts still updating since Profile opened (status chip). */
  syncSources?: readonly ProfileSyncSource[];
  onOpenMore: (item: MoreCatalogItem) => void;
}): React.JSX.Element {
  const reducedMotion = useAppReducedMotion();
  const transition = motionTransition(reducedMotion, "emphasis");
  const [views, setViews] = useState<Record<AniListMediaType, LibraryView>>(() => ({
    ANIME: readLibraryView("ANIME"),
    MANGA: readLibraryView("MANGA"),
  }));
  const view = views[mediaType];
  const activeShelf = shelves.find((shelf) => shelf.key === activeShelfKey);
  const formats = shelfFormats(activeShelf);
  const noun = mediaType === "ANIME" ? "anime" : "manga";
  const both = Boolean(simklStatus?.auth.status === "connected");
  const [chosenSection, setSection] = useState<ProfileSection>("LIBRARY");
  // AniList-only keeps today's profile: the library is the whole page.
  const section: ProfileSection = both ? chosenSection : "LIBRARY";
  const [editing, setEditing] = useState(false);
  const look = useProfileLook();
  const simklPicture =
    simkl?.avatarUrl ??
    (simklStatus?.auth.status === "connected" ? simklStatus.auth.avatarUrl : undefined);
  const picture = choosePicture(look.picture, dashboard.profile.avatarUrl, simklPicture);

  const changeView = (next: LibraryView): void => {
    writeLibraryView(mediaType, next);
    setViews((current) => ({ ...current, [mediaType]: next }));
  };

  return (
    <div className="profile-page">
      <ProfileHeader
        dashboard={dashboard}
        pictureUrl={picture.url}
        simkl={simkl}
        simklStatus={both ? simklStatus : undefined}
        simklStatsLoading={simklStatsLoading}
        syncSources={syncSources}
        onEditLook={() => setEditing(true)}
      />

      <nav className="title-tabs profile-tabs" aria-label="Profile sections">
        {(
          [
            ["ANIME", both ? "Anime" : "Anime library"],
            ["MANGA", both ? "Manga" : "Manga library"],
          ] as Array<[AniListMediaType, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={section === "LIBRARY" && mediaType === key ? "is-active" : undefined}
            aria-current={section === "LIBRARY" && mediaType === key ? "page" : undefined}
            onClick={() => {
              setSection("LIBRARY");
              if (key !== mediaType) onSwitchType(key);
            }}
          >
            {label}
          </button>
        ))}
        {both
          ? (
              [
                ["MOVIE", "Movies"],
                ["TV", "TV shows"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={section === key ? "is-active" : undefined}
                aria-current={section === key ? "page" : undefined}
                onClick={() => setSection(key)}
              >
                {label}
              </button>
            ))
          : null}
        {both ? (
          <a
            className="profile-anilist-link profile-simkl-link"
            href="https://simkl.com/"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} aria-hidden="true" />
            Simkl
          </a>
        ) : null}
        <a
          className="profile-anilist-link"
          href={dashboard.profile.siteUrl}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} aria-hidden="true" />
          {both ? "AniList" : "View on AniList"}
        </a>
      </nav>

      {section === "MOVIE" || section === "TV" ? (
        <SimklLibraryPanel
          key={section}
          items={simkl?.items ?? []}
          type={section}
          onOpenMore={onOpenMore}
        />
      ) : null}
      {both && section !== "LIBRARY" ? <ProfileCredits anilist /> : null}
      {editing ? (
        <ProfileLookDialog
          anilistPicture={dashboard.profile.avatarUrl}
          anilistName={dashboard.profile.name}
          simklPicture={simklPicture}
          simklName={simkl?.name}
          banner={dashboard.profile.bannerUrl}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {section === "LIBRARY" ? (
        <section className="library-shell">
          <div className="library-chips" role="tablist" aria-label={`${noun} lists`}>
            {shelves.map((shelf) => (
              <button
                key={shelf.key}
                type="button"
                role="tab"
                aria-selected={shelf.key === activeShelfKey}
                aria-controls="profile-library-results"
                className={shelf.key === activeShelfKey ? "is-active" : undefined}
                onClick={() => onSelectShelf(shelf.key)}
              >
                {shelf.label}
                <em>{shelf.entries.length}</em>
              </button>
            ))}
          </div>

          <div className="library-toolbar">
            <label className="library-search">
              <span className="sr-only">Filter this list</span>
              <Search size={16} aria-hidden="true" />
              <input
                value={listQuery}
                onChange={(event) => onListQuery(event.target.value)}
                placeholder={`Filter ${noun} by title`}
              />
            </label>
            {formats.length > 1 ? (
              <Select
                className="library-format"
                value={formatFilter}
                onChange={onFormatFilter}
                ariaLabel="Format"
                options={[
                  { value: "", label: "All formats" },
                  ...formats.map((format) => ({ value: format, label: formatMediaLabel(format) })),
                ]}
              />
            ) : null}
            <Select<LibrarySort>
              className="library-sort"
              value={librarySort}
              onChange={onLibrarySort}
              ariaLabel={`Sort ${noun} list`}
              options={[
                { value: "UPDATED_DESC", label: "Recently updated" },
                { value: "TITLE_ASC", label: "Title A-Z" },
                { value: "SCORE_DESC", label: "Highest score" },
                { value: "PROGRESS_DESC", label: "Most progress" },
              ]}
            />
            <div className="library-view-toggle" role="group" aria-label="Library view">
              <button
                type="button"
                aria-pressed={view === "grid"}
                aria-label="Grid view"
                title="Grid view"
                onClick={() => changeView("grid")}
              >
                <LayoutGrid size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-pressed={view === "list"}
                aria-label="List view"
                title="List view"
                onClick={() => changeView("list")}
              >
                <List size={16} aria-hidden="true" />
              </button>
            </div>
            <button
              className="title-primary add-title-button"
              type="button"
              onClick={onToggleAdding}
            >
              {adding ? <X size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
              {adding ? "Close" : "Add title"}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {adding ? (
              <motion.section
                className="library-add-search"
                key={mediaType}
                initial={reducedMotion ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
                transition={transition}
              >
                <SearchView
                  restrictedType={mediaType}
                  access={access}
                  onSelect={(media) => onOpenMedia(media, "details")}
                  onPrimary={(media) =>
                    onOpenMedia(media, media.type === "ANIME" ? "play" : "read")
                  }
                  onLibrary={onLibrary}
                />
              </motion.section>
            ) : null}
          </AnimatePresence>

          {error ? <p className="error-banner">{error}</p> : null}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className="library-results"
              key={`${mediaType}-${activeShelfKey}-${view}`}
              id="profile-library-results"
              role="tabpanel"
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
              transition={transition}
            >
              <div className="library-heading">
                <h2>{activeShelf?.label ?? "No list"}</h2>
                <span aria-live="polite">{visibleEntries.length} titles</span>
              </div>
              {view === "list" ? (
                <div className="library-table" role="table" aria-label={`${noun} list`}>
                  <div className="library-row library-row--head" role="row">
                    <span role="columnheader" />
                    <span role="columnheader">Title</span>
                    <span role="columnheader">Progress</span>
                    <span role="columnheader">Score</span>
                    <span role="columnheader">Status</span>
                    <span role="columnheader">Updated</span>
                    <span role="columnheader">
                      <span className="sr-only">Edit</span>
                    </span>
                  </div>
                  {visibleEntries.map((entry) => (
                    <LibraryRow
                      key={entry.id}
                      entry={entry}
                      onEdit={onEdit}
                      onOpenMedia={onOpenMedia}
                    />
                  ))}
                </div>
              ) : (
                <div className="media-grid library-grid">
                  {visibleEntries.map((entry) => (
                    <LibraryCard
                      entry={entry}
                      key={entry.id}
                      onEdit={onEdit}
                      onOpenMedia={onOpenMedia}
                    />
                  ))}
                </div>
              )}
              {!visibleEntries.length ? (
                <div className="empty-state">
                  <h3>Nothing here yet</h3>
                  <p>
                    {listQuery || formatFilter ? "Try another filter." : "This list has no titles."}
                  </p>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </section>
      ) : null}
    </div>
  );
}

/** Banner band (shared 1900×400 geometry; user banners are center-cropped), avatar, and stats. */
function ProfileHeader({
  dashboard,
  pictureUrl,
  simkl,
  simklStatus,
  simklStatsLoading,
  syncSources,
  onEditLook,
}: {
  dashboard: AniListDashboard;
  pictureUrl?: string;
  simkl?: SimklProfile;
  simklStatus?: SimklStatus;
  simklStatsLoading: boolean;
  syncSources: readonly ProfileSyncSource[];
  onEditLook: () => void;
}): React.JSX.Element {
  const { profile } = dashboard;
  const { state } = usePersonalLibrary();
  const simklTotals = useMemo(() => (simkl ? simklCounts(simkl.items) : undefined), [simkl]);
  const counts = useMemo(() => {
    const anime = buildLibraryShelves(dashboard.animeLists, true);
    const manga = buildLibraryShelves(dashboard.mangaLists, false);
    const size = (shelves: LibraryShelf[], key: string) =>
      shelves.find((shelf) => shelf.key === key)?.entries.length ?? 0;
    return {
      watching: size(anime, "status:CURRENT") + size(anime, "status:REPEATING"),
      reading: size(manga, "status:CURRENT") + size(manga, "status:REPEATING"),
      planning: size(anime, "status:PLANNING") + size(manga, "status:PLANNING"),
      score: meanScore([...dashboard.animeLists, ...dashboard.mangaLists]),
    };
  }, [dashboard]);
  // Combined mean over AniList scores and Simkl ratings (both on a 10-point scale here).
  const combinedScore = useMemo(() => {
    if (!simklTotals) return counts.score;
    const rated = (counts.score?.rated ?? 0) + simklTotals.rated;
    if (!rated) return undefined;
    const total =
      (counts.score ? counts.score.mean * counts.score.rated : 0) +
      simklTotals.mean * simklTotals.rated;
    return { mean: total / rated, rated };
  }, [counts.score, simklTotals]);

  return (
    <header className="profile-header">
      <ProfileHeroBand banner={profile.bannerUrl} pictureUrl={pictureUrl} />
      <ProfileSyncChip sources={syncSources} />
      <EditLookButton onClick={onEditLook} />
      <div className="profile-main">
        <div className="profile-avatar-xl">
          <img
            src={cachedArtworkUrl(pictureUrl ?? profile.avatarUrl)}
            alt={`${profile.name}'s avatar`}
            decoding="async"
          />
        </div>
        <div className="profile-identity">
          <p className="title-kicker">
            {simklStatus ? (
              <>
                <span className="profile-source">
                  <SourceLogo source="anilist" />
                  AniList
                  <i className="profile-plus">+</i>
                  <SourceLogo source="simkl" />
                  Simkl
                </span>
                <span className="profile-connected">Both connected</span>
              </>
            ) : (
              <>
                <span>AniList profile</span>
                <span className="profile-connected">Connected</span>
              </>
            )}
          </p>
          <h1 data-profile-heading tabIndex={-1}>
            {profile.name}
          </h1>
          {profile.about ? <p className="profile-about">{stripMarkup(profile.about)}</p> : null}
          {simklTotals ? (
            <div className="profile-stat-pair profile-stat-pair--both" aria-label="Statistics">
              <div>
                <strong>
                  {profile.animeCount.toLocaleString()}
                  <small>anime</small>
                </strong>
                <span>
                  {profile.episodesWatched.toLocaleString()} eps · {days(profile.minutesWatched)}
                </span>
              </div>
              <div>
                <strong>
                  {profile.mangaCount.toLocaleString()}
                  <small>manga</small>
                </strong>
                <span>{profile.chaptersRead.toLocaleString()} chapters</span>
              </div>
              <div>
                <strong>
                  {simklTotals.movies.toLocaleString()}
                  <small>movies</small>
                </strong>
                {simkl?.stats ? (
                  <span>{Math.round(simkl.stats.movieMinutes / 60).toLocaleString()} hours</span>
                ) : simklStatsLoading ? (
                  <StatPlaceholder width={80} />
                ) : (
                  <span>{simklTotals.moviesDone} completed</span>
                )}
              </div>
              <div>
                <strong>
                  {simklTotals.shows.toLocaleString()}
                  <small>shows</small>
                </strong>
                <span>
                  {simklTotals.episodes.toLocaleString()} eps
                  {simkl?.stats ? ` · ${days(simkl.stats.tvMinutes)}` : ""}
                </span>
              </div>
              {combinedScore ? (
                <div>
                  <strong>
                    {combinedScore.mean.toFixed(1)}
                    <small>mean</small>
                  </strong>
                  <span>{combinedScore.rated} rated</span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="profile-stat-pair" aria-label="AniList statistics">
              <div>
                <strong>
                  {profile.animeCount.toLocaleString()}
                  <small>anime</small>
                </strong>
                <span>
                  {profile.episodesWatched.toLocaleString()} episodes ·{" "}
                  {formatMinutes(profile.minutesWatched)} watched
                </span>
              </div>
              <div>
                <strong>
                  {profile.mangaCount.toLocaleString()}
                  <small>manga</small>
                </strong>
                <span>
                  {profile.chaptersRead.toLocaleString()} chapters ·{" "}
                  {profile.volumesRead.toLocaleString()} volumes
                </span>
              </div>
              {counts.score ? (
                <div>
                  <strong>
                    {counts.score.mean.toFixed(1)}
                    <small>mean score</small>
                  </strong>
                  <span>across {counts.score.rated} rated titles</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
        <dl className="title-facts profile-sync">
          <div>
            <dt className={simklStatus ? "profile-sync-source" : undefined}>
              {simklStatus ? <SourceLogo source="anilist" /> : null}
              {simklStatus ? "AniList" : "AniList sync"}
            </dt>
            <dd className={state.pending ? "is-pending" : "is-synced"}>
              {state.syncing
                ? "Syncing…"
                : state.pending
                  ? `${state.pending} change${state.pending === 1 ? "" : "s"} waiting`
                  : `Up to date · ${relativeTime(dashboard.fetchedAt)}`}
            </dd>
          </div>
          {simklStatus ? <SimklSyncRow status={simklStatus} label="Simkl" /> : null}
          <div>
            <dt>Watching</dt>
            <dd>
              {simklTotals
                ? `${counts.watching} anime · ${simklTotals.byStatus.watching} shows`
                : counts.watching}
            </dd>
          </div>
          <div>
            <dt>Reading</dt>
            <dd>{counts.reading}</dd>
          </div>
          <div>
            <dt>Planning</dt>
            <dd>
              {simklTotals
                ? `${counts.planning} · ${simklTotals.byStatus.planning} to watch`
                : counts.planning}
            </dd>
          </div>
          {simklStatus ? null : (
            <div>
              <dt>Offline copy</dt>
              <dd>Saved on this device</dd>
            </div>
          )}
        </dl>
      </div>
    </header>
  );
}

function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const days = Math.floor(minutes / 1_440);
  return days ? `${days.toLocaleString()} days` : `${Math.floor(minutes / 60).toLocaleString()}h`;
}

function stripMarkup(markup: string): string {
  const document = new DOMParser().parseFromString(markup, "text/html");
  return (document.body.textContent ?? "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\s*([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(?:\*\*|__|~~|~!|!~)/g, "")
    .trim();
}
