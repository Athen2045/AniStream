import { BookOpen, Check, ExternalLink, Play, Plus, Star, UserRound, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAppReducedMotion } from "./useAppReducedMotion";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  MangaDexReaderChapter,
  MangaDexReaderSession,
  MangaReadingResume,
} from "../../shared/contracts";
import { CoverImage } from "./CoverImage";
import { safeBackgroundUrl } from "./safe-css-url";
import { formatMediaLabel } from "./format-label";
import { decodeHtmlEntities } from "../../shared/text";
import { hasPersonalizedAccess, type ViewerAccess } from "./viewer-access";
import { createMediaDetailSession } from "./media-detail-session";
import { motionTransition } from "./motion";
import { friendlyRemoteError } from "./remote-error";

const AnimeWatchExperience = lazy(() =>
  import("./AnimeWatchExperience").then((module) => ({
    default: module.AnimeWatchExperience,
  })),
);
const MangaReaderFullscreen = lazy(() =>
  import("./MangaReaderFullscreen").then((module) => ({
    default: module.MangaReaderFullscreen,
  })),
);

export function MediaDetailModal({
  media,
  initialAction = "details",
  initialUnit,
  onClose,
  onNavigate,
  access,
  onLibrary,
}: {
  media: AniListCatalogMedia;
  initialAction?: "details" | "play" | "read";
  initialUnit?: number;
  onClose: () => void;
  onNavigate?: (media: AniListCatalogMedia) => void;
  access: ViewerAccess;
  onLibrary?: (media: AniListCatalogMedia) => Promise<void>;
}): React.JSX.Element {
  const personalized = hasPersonalizedAccess(access);
  const [detailSession] = useState(() =>
    createMediaDetailSession({
      media,
      access,
      bridge: typeof window === "undefined" ? undefined : window.anistream,
    }),
  );
  useEffect(() => detailSession.updateAccess(access), [access, detailSession]);
  const detailSnapshot = useSyncExternalStore(
    detailSession.subscribe,
    detailSession.getSnapshot,
    detailSession.getSnapshot,
  );
  const detail = detailSnapshot.detail;
  const reducedMotion = useAppReducedMotion();
  const loading = detailSnapshot.loading;
  const [adding, setAdding] = useState(false);
  const [libraryError, setLibraryError] = useState<string>();
  const [autoPlayRequest, setAutoPlayRequest] = useState(0);
  const readerSession = detailSnapshot.readerSession;
  const [activeChapter, setActiveChapter] = useState<MangaDexReaderChapter>();
  const mangaResume = detailSnapshot.mangaResume;
  const mangaEnrichment = detailSnapshot.mangaEnrichment;
  const loadingReader = detailSnapshot.loadingReader;
  const [rating, setRating] = useState<number>();
  const savingTracker = detailSnapshot.savingTracker;
  const malScore = detailSnapshot.malScore;
  const initialPlayHandled = useRef(false);
  const initialReadHandled = useRef(false);
  const modalRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const error = detailSnapshot.error;

  useEffect(() => {
    detailSession.activate();
    void detailSession.load();
    return () => detailSession.dispose();
  }, [detailSession]);

  const resolved = detail ?? media;

  // MAL score cross-reference via AniList's own idMal mapping. Optional enrichment:
  // failures and unconfigured clients resolve to "no score", never an error state.
  const libraryProgress =
    access.kind === "member" ? (access.libraryEntries.get(media.id)?.progress ?? 0) : 0;
  const watchedEpisodes = Math.max(detail?.listEntry?.progress ?? 0, libraryProgress);
  const progressEpisode =
    resolved.totalProgress && watchedEpisodes >= resolved.totalProgress
      ? resolved.totalProgress
      : Math.max(1, watchedEpisodes + 1);
  const initialEpisode = resolved.totalProgress
    ? Math.min(resolved.totalProgress, Math.max(1, initialUnit ?? progressEpisode))
    : Math.max(1, initialUnit ?? progressEpisode);

  useEffect(() => {
    if (initialAction !== "play" || loading || initialPlayHandled.current) return;
    initialPlayHandled.current = true;
    setAutoPlayRequest((request) => request + 1);
  }, [initialAction, loading]);

  useEffect(() => {
    if (initialAction === "read" && !loading && readerSession && !initialReadHandled.current) {
      initialReadHandled.current = true;
      void detailSession.openReader().then(setActiveChapter);
    }
  }, [detailSession, initialAction, loading, readerSession]);

  const markEpisodeWatched = useCallback(
    (episodeNumber: number): Promise<void> => detailSession.markEpisodeWatched(episodeNumber),
    [detailSession],
  );

  const markMediaCompleted = useCallback(
    (): Promise<void> => detailSession.markMediaCompleted().catch(() => undefined),
    [detailSession],
  );

  const markChapterRead = useCallback(
    (chapter: MangaDexReaderChapter): Promise<void> => detailSession.markChapterRead(chapter),
    [detailSession],
  );

  const openPreferredChapter = useCallback(async (): Promise<void> => {
    const chapter = await detailSession.openReader();
    if (chapter) setActiveChapter(chapter);
  }, [detailSession]);

  const changeMangaPreferences = useCallback(
    (translatedLanguage: string, preferredGroupId?: string): void => {
      void detailSession
        .setMangaReaderPreferences({
          aniListId: media.id,
          translatedLanguage,
          preferredGroupId,
        })
        .catch(() => undefined);
    },
    [detailSession, media.id],
  );

  const closeReader = useCallback((): void => {
    setActiveChapter(undefined);
    void detailSession.refreshResume();
  }, [detailSession]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (
        event.key === "Escape" &&
        !document.fullscreenElement &&
        !activeChapter &&
        !document.querySelector(".watch-player-view")
      )
        onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeChapter, onClose]);

  // Focus management for the dialog: move focus in on open, and keep Tab from
  // leaking out to the catalog page behind the backdrop while it's open.
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const trapFocus = (event: KeyboardEvent): void => {
      if (
        event.key !== "Tab" ||
        !modalRef.current ||
        activeChapter ||
        document.querySelector(".watch-player-view") ||
        document.querySelector(".entry-editor")
      )
        return;
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trapFocus);
    return () => window.removeEventListener("keydown", trapFocus);
  }, [activeChapter]);

  return (
    <motion.div
      className="detail-backdrop"
      role="presentation"
      onMouseDown={activeChapter ? undefined : onClose}
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={motionTransition(reducedMotion, "fast")}
    >
      <motion.article
        className="detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${media.title} details`}
        ref={modalRef}
        onMouseDown={(event) => event.stopPropagation()}
        initial={reducedMotion ? false : { opacity: 0, y: 28, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.99 }}
        transition={motionTransition(reducedMotion, "emphasis")}
      >
        <button
          className="detail-close"
          type="button"
          aria-label="Close details"
          ref={closeButtonRef}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <div
          className="detail-hero"
          style={{
            backgroundImage: `linear-gradient(0deg, #181818 0%, transparent 55%), linear-gradient(90deg, rgba(0,0,0,.76), transparent 65%), ${safeBackgroundUrl(resolved.bannerUrl ?? resolved.coverUrl)}`,
          }}
        >
          <div>
            <p className="catalog-kicker">{resolved.type === "ANIME" ? "Anime" : "Manga"}</p>
            <h2>{resolved.title}</h2>
            <div className="detail-actions">
              <button
                className="play-action"
                type="button"
                onClick={() => {
                  if (resolved.type === "ANIME") {
                    setAutoPlayRequest((request) => request + 1);
                  } else {
                    void openPreferredChapter();
                  }
                }}
              >
                {resolved.type === "ANIME" ? (
                  <Play size={18} fill="currentColor" />
                ) : (
                  <BookOpen size={18} />
                )}
                {resolved.type === "ANIME" ? "Watch" : "Read"}
              </button>
              {personalized || onLibrary ? (
                <button
                  className="round-action detail-add"
                  type="button"
                  disabled={adding}
                  aria-label={
                    personalized && access.libraryEntries.has(media.id)
                      ? "Edit library entry"
                      : "Add to AniList planning"
                  }
                  title={
                    personalized && access.libraryEntries.has(media.id)
                      ? "Edit library entry"
                      : "Add to Planning"
                  }
                  onClick={() => {
                    setAdding(true);
                    setLibraryError(undefined);
                    void (onLibrary ? onLibrary(resolved) : detailSession.addTitle())
                      .catch((reason: unknown) =>
                        setLibraryError(
                          friendlyRemoteError(reason, {
                            provider: "AniList",
                            operation: "library changes",
                            fallback: "Your library could not be updated. Try again.",
                          }),
                        ),
                      )
                      .finally(() => setAdding(false));
                  }}
                >
                  {personalized && access.libraryEntries.has(media.id) ? (
                    <Check size={19} />
                  ) : (
                    <Plus size={19} />
                  )}
                </button>
              ) : null}
            </div>
            {personalized && detail ? (
              <div className="detail-tracker-compact">
                <label>
                  <Star size={15} />
                  <span className="sr-only">AniList rating out of 10</span>
                  <input
                    aria-label="AniList rating out of 10"
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                    value={rating ?? detail.listEntry?.score ?? 0}
                    onChange={(event) => setRating(Number(event.target.value))}
                  />
                  <span>/ 10</span>
                </label>
                <button
                  type="button"
                  disabled={savingTracker}
                  onClick={() =>
                    void detailSession
                      .saveRating(rating ?? detail.listEntry?.score ?? 0)
                      .catch(() => undefined)
                  }
                >
                  Save rating
                </button>
                <button
                  type="button"
                  disabled={savingTracker}
                  onClick={() => void markMediaCompleted()}
                >
                  Mark completed
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="detail-body">
          {loading ? (
            <div className="detail-skeleton" aria-hidden="true">
              <span className="detail-skeleton-line" />
              <span className="detail-skeleton-line" />
              <span className="detail-skeleton-line short" />
            </div>
          ) : null}
          {error || libraryError ? (
            <p className="error-banner" role="alert">
              {libraryError ?? error}
            </p>
          ) : null}

          {resolved.type === "ANIME" ? (
            <Suspense fallback={<p className="catalog-loading">Loading episode browser…</p>}>
              <AnimeWatchExperience
                media={resolved}
                initialEpisode={initialEpisode}
                autoPlayRequest={autoPlayRequest}
                onEpisodeWatched={markEpisodeWatched}
                onNavigate={onNavigate}
              />
            </Suspense>
          ) : null}

          {resolved.type === "MANGA" ? (
            <MangaChapterBrowser
              session={readerSession}
              currentProgress={detail?.listEntry?.progress ?? 0}
              resume={mangaResume}
              loading={loadingReader}
              loadError={detailSnapshot.error}
              onPreferenceChange={changeMangaPreferences}
              onRetry={() => void detailSession.retryReader()}
              onRead={(chapter) => {
                setActiveChapter(chapter);
              }}
            />
          ) : null}

          <div className="detail-overview">
            <div>
              <div className="detail-facts">
                {resolved.averageScore ? (
                  <span className="match">{resolved.averageScore}% AniList</span>
                ) : null}
                {malScore?.score ? (
                  <a
                    className="mal-score"
                    href={malScore.malUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={
                      malScore.scoredBy
                        ? `${malScore.score}/10 from ${malScore.scoredBy.toLocaleString()} MAL users`
                        : `${malScore.score}/10 on MyAnimeList`
                    }
                  >
                    {malScore.score} MAL
                  </a>
                ) : null}
                {resolved.seasonYear ? <span>{resolved.seasonYear}</span> : null}
                <span>{formatLabel(resolved.format)}</span>
                {resolved.totalProgress ? (
                  <span>
                    {resolved.totalProgress} {resolved.type === "ANIME" ? "episodes" : "chapters"}
                  </span>
                ) : null}
              </div>
              <p className="detail-description">{cleanDescription(resolved.description)}</p>
            </div>
            {detail ? (
              <dl>
                {detail.type === "ANIME" ? (
                  <div>
                    <dt>Studios</dt>
                    <dd>{detail.studios.join(", ") || "—"}</dd>
                  </div>
                ) : null}
                {detail.type === "MANGA" && mangaEnrichment?.status === "available" ? (
                  <>
                    <div>
                      <dt>Authors</dt>
                      <dd>{mangaEnrichment.authors.join(", ") || "—"}</dd>
                    </div>
                    <div>
                      <dt>Artists</dt>
                      <dd>{mangaEnrichment.artists.join(", ") || "—"}</dd>
                    </div>
                    <div>
                      <dt>Publishers</dt>
                      <dd>{mangaEnrichment.publishers.join(", ") || "—"}</dd>
                    </div>
                    {mangaEnrichment.mangaUpdatesRating !== undefined ? (
                      <div>
                        <dt>MU score</dt>
                        <dd>{mangaEnrichment.mangaUpdatesRating.toFixed(2)} / 10</dd>
                      </div>
                    ) : null}
                    {mangaEnrichment.mangaUpdates?.latestChapter !== undefined ? (
                      <div>
                        <dt>MU latest chapter</dt>
                        <dd>{mangaEnrichment.mangaUpdates.latestChapter}</dd>
                      </div>
                    ) : null}
                    {mangaEnrichment.mangaUpdates?.groups.length ? (
                      <div>
                        <dt>Scanlation groups</dt>
                        <dd>
                          {mangaEnrichment.mangaUpdates.groups
                            .map((group) => group.name)
                            .join(", ")}
                        </dd>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div>
                  <dt>Genres</dt>
                  <dd>{detail.genres.join(", ") || "—"}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{formatLabel(detail.source)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{formatLabel(detail.status)}</dd>
                </div>
                {detail.duration ? (
                  <div>
                    <dt>Runtime</dt>
                    <dd>{detail.duration} min</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </div>

          {detail?.characters.length ? (
            <DetailPeople title="Cast" people={detail.characters} />
          ) : null}
          {detail?.staff.length ? <DetailPeople title="Staff" people={detail.staff} /> : null}

          {detail?.relations.length ? (
            <section className="detail-section">
              <h3>More from this story</h3>
              <div className="detail-mini-grid">
                {detail.relations.slice(0, 8).map((relation) => (
                  <button
                    type="button"
                    className="detail-relation-action"
                    disabled={!onNavigate}
                    key={`${relation.relationType}-${relation.media.type}-${relation.media.id}`}
                    aria-label={`Open ${relation.media.title} · ${formatLabel(relation.relationType)}`}
                    onClick={() => onNavigate?.(relation.media)}
                  >
                    <CoverImage src={relation.media.coverUrl} title={relation.media.title} />
                    <strong>{relation.media.title}</strong>
                    <span>{formatLabel(relation.relationType)}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {detail?.externalLinks.length ? (
            <section className="detail-section">
              <h3>Official links</h3>
              <div className="external-links">
                {distinctExternalLinks(detail.externalLinks)
                  .slice(0, 8)
                  .map((link) => (
                    <a
                      key={`${link.site}-${link.url}`}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {link.site}
                      <ExternalLink size={13} />
                    </a>
                  ))}
              </div>
            </section>
          ) : null}
        </div>
      </motion.article>
      <Suspense
        fallback={
          <div
            className="manga-reader-fullscreen manga-reader-loading"
            role="status"
            aria-label="Loading reader"
          >
            <span className="reader-loading-spinner" aria-hidden="true" />
          </div>
        }
      >
        <AnimatePresence>
          {activeChapter && readerSession?.status === "available" ? (
            <MangaReaderFullscreen
              key={resolved.id}
              media={media}
              aniListId={resolved.id}
              title={resolved.title}
              session={readerSession}
              chapter={activeChapter}
              resume={mangaResume?.chapterId === activeChapter.id ? mangaResume : undefined}
              onClose={closeReader}
              onChapterChange={(chapter) => {
                setActiveChapter(chapter);
              }}
              onChapterRead={markChapterRead}
            />
          ) : null}
        </AnimatePresence>
      </Suspense>
    </motion.div>
  );
}

function MangaChapterBrowser({
  session,
  currentProgress,
  resume,
  loading,
  loadError,
  onPreferenceChange,
  onRetry,
  onRead,
}: {
  session?: MangaDexReaderSession;
  currentProgress: number;
  resume?: MangaReadingResume;
  loading: boolean;
  loadError?: string;
  onPreferenceChange: (translatedLanguage: string, preferredGroupId?: string) => void;
  onRetry: () => void;
  onRead: (chapter: MangaDexReaderChapter) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [descending, setDescending] = useState(true);
  const languages = session
    ? [...new Set([session.translatedLanguage, ...session.availableLanguages])]
    : ["en"];
  const chapters = [...(session?.chapters ?? [])]
    .filter((chapter) => {
      const normalized = query.trim().toLocaleLowerCase();
      if (!normalized) return true;
      return (
        String(chapter.number ?? "").includes(normalized) ||
        chapter.title?.toLocaleLowerCase().includes(normalized)
      );
    })
    .sort((left, right) =>
      descending
        ? (right.number ?? -Infinity) - (left.number ?? -Infinity)
        : (left.number ?? Infinity) - (right.number ?? Infinity),
    );

  return (
    <section className="manga-chapter-browser">
      <h3 className="chapter-browser-title">Chapters</h3>
      <div className="chapter-browser-toolbar">
        <input
          type="search"
          placeholder="Search chapter number or title…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label>
          <span>Language</span>
          <select
            aria-label="Chapter language"
            value={session?.translatedLanguage ?? "en"}
            disabled={!session || loading}
            onChange={(event) => onPreferenceChange(event.target.value)}
          >
            {languages.map((language) => (
              <option key={language} value={language}>
                {language.toLocaleUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Group</span>
          <select
            aria-label="Preferred scanlation group"
            value={session?.preferredGroupId ?? ""}
            disabled={!session || loading || session.availableGroups.length === 0}
            onChange={(event) =>
              onPreferenceChange(
                session?.translatedLanguage ?? "en",
                event.target.value || undefined,
              )
            }
          >
            <option value="">Any group</option>
            {session?.availableGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setDescending((value) => !value)}>
          Chapter {descending ? "↓" : "↑"}
        </button>
      </div>
      {session?.status === "unavailable" || session?.status === "unmapped" ? (
        <div className="provider-note provider-note--action" role="status">
          <span>
            {session.status === "unmapped"
              ? "This title is not linked to MangaDex yet, so AniStream cannot open its chapters."
              : "MangaDex could not load chapters for this title. Try again shortly."}
          </span>
          <button type="button" onClick={onRetry} disabled={loading}>
            Retry chapters
          </button>
        </div>
      ) : null}
      {session?.status === "available" && session.message ? (
        <p className="provider-note">{session.message}</p>
      ) : null}
      {session?.archiveStatus === "partial" && session.chapters.length ? (
        <p className="provider-note">Some chapter archive pages could not be loaded.</p>
      ) : null}
      {loading ? (
        <div className="chapter-browser-list" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span className="chapter-row-skeleton" key={`chapter-skeleton-${index}`} />
          ))}
        </div>
      ) : !session ? (
        <div className="chapter-browser-empty" role="alert">
          <strong>Chapters could not be loaded.</strong>
          <span>{loadError ?? "MangaDex did not return a chapter list. Try again shortly."}</span>
          <button type="button" onClick={onRetry}>
            Retry chapters
          </button>
        </div>
      ) : chapters.length === 0 ? (
        <div className="chapter-browser-empty" role="status">
          <strong>
            {session.chapters.length === 0
              ? `No readable chapters are available in ${session.translatedLanguage.toLocaleUpperCase()} yet.`
              : "No chapters match this search."}
          </strong>
          <span>
            {session.chapters.length === 0
              ? "Choose another listed language or retry the chapter feed."
              : "Clear the chapter search to see the full list."}
          </span>
          {session.chapters.length === 0 ? (
            <button type="button" onClick={onRetry}>
              Retry chapters
            </button>
          ) : null}
        </div>
      ) : (
        <div className="chapter-browser-list">
          {chapters.map((chapter) => {
            const completed =
              chapter.number !== undefined && Math.floor(chapter.number) <= currentProgress;
            const readingProgress = resume?.chapterId === chapter.id ? resume.progress : 0;
            return (
              <button type="button" key={chapter.id} onClick={() => onRead(chapter)}>
                <span className="chapter-language">
                  {chapter.translatedLanguage.toLocaleUpperCase()}
                </span>
                <strong>
                  Ch. {chapter.number ?? "?"}
                  {chapter.title ? <small> · {chapter.title}</small> : null}
                  {chapter.groups.length ? (
                    <small> · {chapter.groups.map((group) => group.name).join(" + ")}</small>
                  ) : null}
                </strong>
                {completed ? <Check size={15} className="chapter-complete" /> : null}
                <span>{relativeDate(chapter.publishedAt)}</span>
                <BookOpen size={16} />
                {readingProgress > 0 && readingProgress < 1 ? (
                  <span className="chapter-reading-progress" aria-hidden="true">
                    <span style={{ transform: `scaleX(${readingProgress})` }} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DetailPeople({
  title,
  people,
}: {
  title: string;
  people: AniListMediaDetail["characters"];
}): React.JSX.Element {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      <div className="people-row">
        {people.map((person) => (
          <div key={`${title}-${person.id}-${person.role ?? ""}`}>
            {person.imageUrl && !isAnilistPlaceholderImage(person.imageUrl) ? (
              <img src={person.imageUrl} alt="" loading="lazy" decoding="async" />
            ) : (
              <span className="person-image-fallback" aria-hidden="true">
                <UserRound size={22} />
              </span>
            )}
            <strong>{person.name}</strong>
            <small>{formatLabel(person.role)}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatLabel(value?: string): string {
  return formatMediaLabel(value, "—");
}

function cleanDescription(value?: string): string {
  if (!value) return "AniList does not currently provide a summary for this title.";
  return decodeHtmlEntities(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/~!|!~/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function distinctExternalLinks(
  links: AniListMediaDetail["externalLinks"],
): AniListMediaDetail["externalLinks"] {
  const seenSites = new Set<string>();
  return links.filter((link) => {
    const key = link.site.trim().toLocaleLowerCase();
    if (seenSites.has(key)) return false;
    seenSites.add(key);
    return true;
  });
}

function isAnilistPlaceholderImage(url: string): boolean {
  const normalized = url.toLocaleLowerCase();
  return (
    normalized.includes("no_image") ||
    normalized.includes("noimage") ||
    normalized.includes("default")
  );
}

function relativeDate(value?: string): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 35) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
