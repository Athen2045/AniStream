import { BookOpen, Check, ExternalLink, Play, Plus, Star, UserRound, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  MalScore,
  MangaEnrichment,
  MangaDexReaderChapter,
  MangaDexReaderSession,
  MangaReadingResume,
} from "../../shared/contracts";
import { CoverImage } from "./CoverImage";
import { safeBackgroundUrl } from "./safe-css-url";
import { formatMediaLabel } from "./format-label";
import { decodeHtmlEntities } from "../../shared/text";
import { hasPersonalizedAccess, type ViewerAccess } from "./viewer-access";

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
  onClose,
  access,
}: {
  media: AniListCatalogMedia;
  initialAction?: "details" | "play" | "read";
  onClose: () => void;
  access: ViewerAccess;
}): React.JSX.Element {
  const personalized = hasPersonalizedAccess(access);
  const [detail, setDetail] = useState<AniListMediaDetail>();
  const reducedMotion = useReducedMotion();
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [autoPlayRequest, setAutoPlayRequest] = useState(0);
  const [readerSession, setReaderSession] = useState<MangaDexReaderSession>();
  const [activeChapter, setActiveChapter] = useState<MangaDexReaderChapter>();
  const [mangaResume, setMangaResume] = useState<MangaReadingResume>();
  const [mangaEnrichment, setMangaEnrichment] = useState<MangaEnrichment>();
  const [loadingReader, setLoadingReader] = useState(false);
  const [rating, setRating] = useState(0);
  const [savingTracker, setSavingTracker] = useState(false);
  const [malScore, setMalScore] = useState<MalScore>();
  const lastMarkedEpisode = useRef<number | undefined>(undefined);
  const initialPlayHandled = useRef(false);
  const initialReadHandled = useRef(false);
  const modalRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void window.anistream
      .getAniListMediaDetail(media.id, media.type)
      .then((result) => {
        if (active) {
          setDetail(result);
          setRating(result.listEntry?.score ?? 0);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load details.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [media.id, media.type]);

  const resolved = detail ?? media;
  const malId = resolved.malId;

  // MAL score cross-reference via AniList's own idMal mapping. Optional enrichment:
  // failures and unconfigured clients resolve to "no score", never an error state.
  useEffect(() => {
    if (!malId) return;
    let active = true;
    void window.anistream
      .getMalScore(media.type, malId)
      .then((score) => {
        if (active) setMalScore(score);
      })
      .catch(() => {
        if (active) setMalScore(undefined);
      });
    return () => {
      active = false;
    };
  }, [malId, media.type]);

  const watchedEpisodes = detail?.listEntry?.progress ?? 0;
  const initialEpisode =
    resolved.totalProgress && watchedEpisodes >= resolved.totalProgress
      ? resolved.totalProgress
      : Math.max(1, watchedEpisodes + 1);

  useEffect(() => {
    if (initialAction !== "play" || loading || initialPlayHandled.current) return;
    initialPlayHandled.current = true;
    setAutoPlayRequest((request) => request + 1);
  }, [initialAction, loading]);

  useEffect(() => {
    if (media.type !== "MANGA") return;
    let active = true;
    const requestId = `manga-title:${media.id}:${crypto.randomUUID()}`;
    void window.anistream
      .getMangaTitleSnapshot({ aniListId: media.id, title: media.title }, requestId)
      .then((snapshot) => {
        if (!active) return;
        setMangaEnrichment(snapshot.enrichment);
        const savedResume = snapshot.resume;
        setMangaResume(savedResume);
        if (snapshot.reader) {
          setReaderSession(snapshot.reader);
          if (initialAction === "read" && !loading && !initialReadHandled.current) {
            initialReadHandled.current = true;
            setActiveChapter(
              chooseChapterToRead(snapshot.reader, detail?.listEntry?.progress ?? 0, savedResume),
            );
          }
        }
        const readerIssue = snapshot.issues.find((issue) => issue.source === "mangadex-reader");
        if (readerIssue) setError(readerIssue.message);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load manga title data.");
        }
      });
    return () => {
      active = false;
      void window.anistream.cancelRequest(requestId);
    };
  }, [detail?.listEntry?.progress, initialAction, loading, media.id, media.title, media.type]);

  const ensureListEntry = useCallback(async (): Promise<AniListMediaDetail> => {
    if (!personalized) throw new Error("Connect AniList to manage this title in your list.");
    const current = detail ?? (await window.anistream.getAniListMediaDetail(media.id, media.type));
    if (current.listEntry) return current;
    const listEntry = await window.anistream.addAniListEntry(current.id);
    const updated: AniListMediaDetail = { ...current, listEntry };
    setDetail(updated);
    await access.refreshLibrary();
    return updated;
  }, [access, detail, media.id, media.type, personalized]);

  const markEpisodeWatched = useCallback(
    async (episodeNumber: number): Promise<void> => {
      if (!personalized) return;
      if (lastMarkedEpisode.current === episodeNumber) return;
      lastMarkedEpisode.current = episodeNumber;
      setSavingTracker(true);
      setError(undefined);
      try {
        const current = await ensureListEntry();
        if (!current.listEntry) throw new Error("AniList did not return the new list entry.");
        const nextProgress = Math.max(current.listEntry.progress, episodeNumber);
        const completed = Boolean(current.totalProgress && nextProgress >= current.totalProgress);
        const listEntry = await window.anistream.updateAniListEntry({
          id: current.listEntry.id,
          progress: nextProgress,
          status: completed ? "COMPLETED" : "CURRENT",
        });
        setDetail((previous) => (previous ? { ...previous, listEntry } : previous));
        setRating(listEntry.score);
        await access.refreshLibrary();
      } catch (reason) {
        lastMarkedEpisode.current = undefined;
        setError(reason instanceof Error ? reason.message : "Unable to update AniList progress.");
      } finally {
        setSavingTracker(false);
      }
    },
    [access, ensureListEntry, personalized],
  );

  const markMediaCompleted = useCallback(async (): Promise<void> => {
    if (!personalized) return;
    setSavingTracker(true);
    setError(undefined);
    try {
      const current = await ensureListEntry();
      if (!current.listEntry) throw new Error("AniList entry was not created.");
      const listEntry = await window.anistream.updateAniListEntry({
        id: current.listEntry.id,
        status: "COMPLETED",
        progress: current.totalProgress ?? current.listEntry.progress,
      });
      setDetail((previous) => (previous ? { ...previous, listEntry } : previous));
      setRating(listEntry.score);
      await access.refreshLibrary();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to mark complete.");
    } finally {
      setSavingTracker(false);
    }
  }, [access, ensureListEntry, personalized]);

  const markChapterRead = useCallback(
    async (chapter: MangaDexReaderChapter): Promise<void> => {
      if (!personalized) return;
      if (chapter.number === undefined) return;
      setSavingTracker(true);
      try {
        const current = await ensureListEntry();
        if (!current.listEntry) throw new Error("AniList entry was not created.");
        const nextProgress = Math.max(current.listEntry.progress, Math.floor(chapter.number));
        const listEntry = await window.anistream.updateAniListEntry({
          id: current.listEntry.id,
          progress: nextProgress,
          status:
            current.totalProgress && nextProgress >= current.totalProgress
              ? "COMPLETED"
              : "CURRENT",
        });
        setDetail((previous) => (previous ? { ...previous, listEntry } : previous));
        await access.refreshLibrary();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to update manga progress.");
      } finally {
        setSavingTracker(false);
      }
    },
    [access, ensureListEntry, personalized],
  );

  const openPreferredChapter = useCallback(async (): Promise<void> => {
    setLoadingReader(true);
    setError(undefined);
    try {
      const snapshot = readerSession
        ? undefined
        : await window.anistream.getMangaTitleSnapshot(
            {
              aniListId: resolved.id,
              title: resolved.title,
            },
            `manga-title:${resolved.id}:${crypto.randomUUID()}`,
          );
      const session = readerSession ?? snapshot?.reader;
      if (!session) {
        throw new Error(
          snapshot?.issues.find((issue) => issue.source === "mangadex-reader")?.message ??
            "MangaDex reader is unavailable.",
        );
      }
      setReaderSession(session);
      const savedResume =
        mangaResume ??
        snapshot?.resume ??
        (await window.anistream.getMangaReadingResume(resolved.id));
      setMangaResume(savedResume);
      if (snapshot?.enrichment) setMangaEnrichment(snapshot.enrichment);
      const chapter = chooseChapterToRead(session, detail?.listEntry?.progress ?? 0, savedResume);
      setActiveChapter(chapter);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open MangaDex reader.");
    } finally {
      setLoadingReader(false);
    }
  }, [detail, mangaResume, readerSession, resolved.id, resolved.title]);

  const closeReader = useCallback((): void => {
    setActiveChapter(undefined);
    void window.anistream
      .getMangaReadingResume(resolved.id)
      .then(setMangaResume)
      .catch(() => undefined);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [resolved.id]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !document.fullscreenElement && !activeChapter) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeChapter, onClose]);

  // Focus management for the dialog: move focus in on open, and keep Tab from
  // leaking out to the catalog page behind the backdrop while it's open.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const trapFocus = (event: KeyboardEvent): void => {
      if (event.key !== "Tab" || !modalRef.current) return;
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
  }, []);

  return (
    <motion.div
      className="detail-backdrop"
      role="presentation"
      onMouseDown={activeChapter ? undefined : onClose}
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
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
        transition={{ duration: reducedMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
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
                  void document.documentElement.requestFullscreen().catch(() => undefined);
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
              {personalized ? (
                <button
                  className="round-action detail-add"
                  type="button"
                  disabled={adding || Boolean(detail?.listEntry)}
                  aria-label={detail?.listEntry ? "Already in AniList" : "Add to AniList planning"}
                  onClick={() => {
                    setAdding(true);
                    void window.anistream
                      .addAniListEntry(media.id)
                      .then((listEntry) => {
                        setDetail((previous) => (previous ? { ...previous, listEntry } : previous));
                        return access.refreshLibrary();
                      })
                      .catch((reason: unknown) => {
                        setError(reason instanceof Error ? reason.message : "Unable to add title.");
                      })
                      .finally(() => setAdding(false));
                  }}
                >
                  {detail?.listEntry ? <Check size={19} /> : <Plus size={19} />}
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
                    value={rating}
                    onChange={(event) => setRating(Number(event.target.value))}
                  />
                  <span>/ 10</span>
                </label>
                <button
                  type="button"
                  disabled={savingTracker}
                  onClick={() => {
                    setSavingTracker(true);
                    void ensureListEntry()
                      .then((current) => {
                        if (!current.listEntry) throw new Error("AniList entry was not created.");
                        return window.anistream.updateAniListEntry({
                          id: current.listEntry.id,
                          score: Math.min(10, Math.max(0, rating)),
                        });
                      })
                      .then((listEntry) => {
                        setDetail((previous) => (previous ? { ...previous, listEntry } : previous));
                        return access.refreshLibrary();
                      })
                      .catch((reason: unknown) =>
                        setError(
                          reason instanceof Error ? reason.message : "Unable to save rating.",
                        ),
                      )
                      .finally(() => setSavingTracker(false));
                  }}
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
          {error ? <p className="error-banner">{error}</p> : null}

          {resolved.type === "ANIME" ? (
            <Suspense fallback={<p className="catalog-loading">Loading episode browser…</p>}>
              <AnimeWatchExperience
                media={resolved}
                initialEpisode={initialEpisode}
                autoPlayRequest={autoPlayRequest}
                onEpisodeWatched={markEpisodeWatched}
              />
            </Suspense>
          ) : null}

          {resolved.type === "MANGA" ? (
            <MangaChapterBrowser
              session={readerSession}
              currentProgress={detail?.listEntry?.progress ?? 0}
              resume={mangaResume}
              loading={loadingReader}
              onRead={(chapter) => {
                void document.documentElement.requestFullscreen().catch(() => undefined);
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
                  <div key={`${relation.relationType}-${relation.media.type}-${relation.media.id}`}>
                    <CoverImage src={relation.media.coverUrl} title={relation.media.title} />
                    <strong>{relation.media.title}</strong>
                    <span>{formatLabel(relation.relationType)}</span>
                  </div>
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
              key={activeChapter.id}
              aniListId={resolved.id}
              title={resolved.title}
              session={readerSession}
              chapter={activeChapter}
              resume={mangaResume?.chapterId === activeChapter.id ? mangaResume : undefined}
              onClose={closeReader}
              onChapterChange={(chapter) => {
                setMangaResume(undefined);
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
  onRead,
}: {
  session?: MangaDexReaderSession;
  currentProgress: number;
  resume?: MangaReadingResume;
  loading: boolean;
  onRead: (chapter: MangaDexReaderChapter) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [descending, setDescending] = useState(true);
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
      <div className="chapter-browser-tabs">
        <button type="button" className="active">
          Chapters
        </button>
        <button type="button" disabled>
          Volumes
        </button>
      </div>
      <div className="chapter-browser-toolbar">
        <input
          type="search"
          placeholder="Search chapter number or title…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>LANG · {session?.translatedLanguage?.toLocaleUpperCase() ?? "EN"}</span>
        <span>TYPE · All</span>
        <button type="button" onClick={() => setDescending((value) => !value)}>
          Chapter {descending ? "↓" : "↑"}
        </button>
      </div>
      {session?.status === "unavailable" || session?.status === "unmapped" ? (
        <p className="provider-note">{session.message}</p>
      ) : null}
      {!session || loading ? (
        <div className="chapter-browser-list" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span className="chapter-row-skeleton" key={`chapter-skeleton-${index}`} />
          ))}
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

function chooseChapterToRead(
  session: MangaDexReaderSession,
  aniListProgress: number,
  resume?: MangaReadingResume,
): MangaDexReaderChapter | undefined {
  if (!session.chapters.length) return undefined;

  if (resume) {
    const savedIndex = session.chapters.findIndex((chapter) => chapter.id === resume.chapterId);
    if (savedIndex >= 0) {
      if (resume.progress >= 0.9 && savedIndex + 1 < session.chapters.length) {
        return session.chapters[savedIndex + 1];
      }
      return session.chapters[savedIndex];
    }
  }

  if (aniListProgress > 0) {
    const nextChapter = session.chapters.find(
      (chapter) =>
        chapter.number !== undefined &&
        Math.floor(chapter.number) >= Math.floor(aniListProgress) + 1,
    );
    if (nextChapter) return nextChapter;
  }

  return session.chapters[0];
}
