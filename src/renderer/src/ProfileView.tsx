import { Plus, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type {
  AniListCatalogMedia,
  AniListDashboard,
  AniListEntry,
  AniListMedia,
  AniListMediaType,
  UpdateAniListEntryInput,
} from "../../shared/contracts";
import { LocalDataSettings } from "./LocalDataSettings";
import { AppUpdates } from "./AppUpdates";
import { motionTransition } from "./motion";
import { LibraryCard } from "./LibraryCard";
import { SearchView } from "./SearchView";
import type { ViewerAccess } from "./viewer-access";
import { AniListSourceIcon } from "./AniListSourceIcon";
import { useAppReducedMotion } from "./useAppReducedMotion";
export type LibrarySort = "UPDATED_DESC" | "TITLE_ASC" | "SCORE_DESC" | "PROGRESS_DESC";
export function ProfileView({
  dashboard,
  mediaType,
  selectedGroup,
  activeGroupName,
  visibleEntries,
  listQuery,
  librarySort,
  adding,
  error,
  onSwitchType,
  onSelectGroup,
  onListQuery,
  onLibrarySort,
  onToggleAdding,
  onSave,
  onEdit,
  access,
  onLibrary,
  onOpenMedia,
}: {
  dashboard: AniListDashboard;
  mediaType: AniListMediaType;
  selectedGroup: string;
  activeGroupName?: string;
  visibleEntries: AniListEntry[];
  listQuery: string;
  librarySort: LibrarySort;
  adding: boolean;
  error?: string;
  onSwitchType: (type: AniListMediaType) => void;
  onSelectGroup: (name: string) => void;
  onListQuery: (value: string) => void;
  onLibrarySort: (value: LibrarySort) => void;
  onToggleAdding: () => void;
  access: ViewerAccess;
  onEdit: (entry: AniListEntry) => void;
  onLibrary: (media: AniListCatalogMedia) => Promise<void>;
  onSave: (input: UpdateAniListEntryInput) => Promise<void>;
  onOpenMedia: (media: AniListMedia, action: "details" | "play" | "read") => void;
}): React.JSX.Element {
  const groups = mediaType === "ANIME" ? dashboard.animeLists : dashboard.mangaLists;
  const reducedMotion = useAppReducedMotion();
  const activeListName = activeGroupName ?? selectedGroup;
  const profileTransition = motionTransition(reducedMotion, "emphasis");

  return (
    <>
      <motion.header
        className="profile-hero"
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={profileTransition}
      >
        <ProfileHeroArtwork
          key={dashboard.profile.bannerUrl ?? "profile-hero-fallback"}
          source={dashboard.profile.bannerUrl}
          reducedMotion={reducedMotion}
        />
        <motion.div
          className="profile-summary"
          initial={reducedMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={profileTransition}
        >
          <div className="profile-avatar-frame">
            <img
              className="profile-avatar"
              src={dashboard.profile.avatarUrl}
              alt={`${dashboard.profile.name}'s avatar`}
              decoding="async"
            />
          </div>
          <div className="profile-summary-copy">
            <p className="profile-kicker">
              <AniListSourceIcon />
              Profile
            </p>
            <h1 data-profile-heading tabIndex={-1}>
              {dashboard.profile.name}
            </h1>
            {dashboard.profile.about ? (
              <p className="profile-about">{stripMarkup(dashboard.profile.about)}</p>
            ) : null}
          </div>
        </motion.div>

        <motion.div
          className="profile-stats"
          aria-label="AniList statistics"
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...profileTransition, delay: reducedMotion ? 0 : 0.06 }}
        >
          <ProfileStatGroup
            label="Anime"
            value={dashboard.profile.animeCount}
            details={[
              `${dashboard.profile.episodesWatched.toLocaleString()} episodes`,
              `${formatMinutes(dashboard.profile.minutesWatched)} watched`,
            ]}
          />
          <ProfileStatGroup
            label="Manga"
            value={dashboard.profile.mangaCount}
            details={[
              `${dashboard.profile.chaptersRead.toLocaleString()} chapters`,
              `${dashboard.profile.volumesRead.toLocaleString()} volumes`,
            ]}
          />
        </motion.div>
      </motion.header>

      <section className="library-shell">
        <div className="library-toolbar">
          <div className="library-primary-controls">
            <h2 className="library-toolbar-title">Your library</h2>
            <div className="media-tabs" role="tablist" aria-label="Library type">
              <button
                className={mediaType === "ANIME" ? "active" : ""}
                type="button"
                role="tab"
                id="profile-anime-tab"
                aria-controls="profile-library-results"
                aria-selected={mediaType === "ANIME"}
                onClick={() => onSwitchType("ANIME")}
              >
                {mediaType === "ANIME" ? (
                  <motion.span
                    className="media-tab-indicator"
                    layoutId="profile-media-tab"
                    transition={profileTransition}
                  />
                ) : null}
                <span>Anime</span>
              </button>
              <button
                className={mediaType === "MANGA" ? "active" : ""}
                type="button"
                role="tab"
                id="profile-manga-tab"
                aria-controls="profile-library-results"
                aria-selected={mediaType === "MANGA"}
                onClick={() => onSwitchType("MANGA")}
              >
                {mediaType === "MANGA" ? (
                  <motion.span
                    className="media-tab-indicator"
                    layoutId="profile-media-tab"
                    transition={profileTransition}
                  />
                ) : null}
                <span>Manga</span>
              </button>
            </div>

            <label className="library-group-select">
              <span>List</span>
              <select
                value={activeListName}
                onChange={(event) => onSelectGroup(event.target.value)}
              >
                {groups.map((group) => (
                  <option key={`${mediaType}-${group.name}`} value={group.name}>
                    {group.name} ({group.entries.length})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="library-secondary-controls">
            <label className="library-search">
              <span className="sr-only">Filter this list</span>
              <Search size={16} aria-hidden="true" />
              <input
                value={listQuery}
                onChange={(event) => onListQuery(event.target.value)}
                placeholder={`Filter ${mediaType === "ANIME" ? "anime" : "manga"}`}
              />
            </label>
            <select
              className="library-sort"
              value={librarySort}
              onChange={(event) => onLibrarySort(event.target.value as LibrarySort)}
              aria-label={`Sort ${mediaType === "ANIME" ? "anime" : "manga"} list`}
            >
              <option value="UPDATED_DESC">Latest updated</option>
              <option value="TITLE_ASC">Title A-Z</option>
              <option value="SCORE_DESC">Highest score</option>
              <option value="PROGRESS_DESC">Most progress</option>
            </select>
            <button className="add-title-button" type="button" onClick={onToggleAdding}>
              {adding ? <X size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
              {adding ? "Close" : "Add title"}
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {adding ? (
            <motion.section
              className="library-add-search"
              key={mediaType}
              initial={reducedMotion ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
              transition={profileTransition}
            >
              <SearchView
                restrictedType={mediaType}
                access={access}
                onSelect={(media) => onOpenMedia(media, "details")}
                onPrimary={(media) => onOpenMedia(media, media.type === "ANIME" ? "play" : "read")}
                onLibrary={onLibrary}
              />
            </motion.section>
          ) : null}
        </AnimatePresence>

        {error ? <p className="error-banner">{error}</p> : null}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="library-results"
            key={`${mediaType}-${activeListName}`}
            id="profile-library-results"
            role="tabpanel"
            aria-labelledby={mediaType === "ANIME" ? "profile-anime-tab" : "profile-manga-tab"}
            initial={reducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
            transition={profileTransition}
          >
            <div className="library-heading">
              <div>
                <p className="library-heading-kicker">Your library</p>
                <h2>{activeGroupName ?? (selectedGroup || "No list")}</h2>
              </div>
              <span aria-live="polite">{visibleEntries.length} titles</span>
            </div>
            <div className="media-grid">
              {visibleEntries.map((entry) => (
                <LibraryCard
                  entry={entry}
                  key={entry.id}
                  reducedMotion={Boolean(reducedMotion)}
                  onSave={onSave}
                  onEdit={onEdit}
                  onOpenMedia={onOpenMedia}
                />
              ))}
            </div>
            {!visibleEntries.length ? (
              <div className="empty-state">
                <h3>Nothing here yet</h3>
                <p>{listQuery ? "Try another filter." : "This AniList group has no titles."}</p>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
        <div className="profile-utilities">
          <LocalDataSettings />
          <AppUpdates />
        </div>
      </section>
    </>
  );
}

function ProfileHeroArtwork({
  source,
  reducedMotion,
}: {
  source?: string;
  reducedMotion: boolean;
}): React.JSX.Element | null {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!source || failed) return null;
  return (
    <motion.img
      className="profile-hero-art"
      src={source}
      alt=""
      aria-hidden="true"
      decoding="async"
      initial={false}
      animate={{ opacity: loaded ? 1 : 0 }}
      transition={motionTransition(reducedMotion, "entrance")}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}

function ProfileStatGroup({
  value,
  label,
  details,
}: {
  value: number;
  label: string;
  details: string[];
}): React.JSX.Element {
  return (
    <div className="profile-stat-group">
      <div>
        <span>{label}</span>
        <strong>{value.toLocaleString()}</strong>
      </div>
      <p>
        {details.map((detail) => (
          <span key={detail}>{detail}</span>
        ))}
      </p>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const days = Math.floor(minutes / 1_440);
  return days ? `${days.toLocaleString()}d` : `${Math.floor(minutes / 60).toLocaleString()}h`;
}

function stripMarkup(markup: string): string {
  const document = new DOMParser().parseFromString(markup, "text/html");
  return (document.body.textContent ?? "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(?:\*\*|__|~~|~!|!~)/g, "")
    .trim();
}
