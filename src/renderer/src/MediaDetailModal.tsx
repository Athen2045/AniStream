import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowUp,
  ArrowUpNarrowWide,
  BookOpen,
  Check,
  Clock3,
  ExternalLink,
  Play,
  Plus,
  RefreshCw,
  Languages,
  Search,
  Star,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAppReducedMotion } from "./useAppReducedMotion";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  MangaDexReaderChapter,
  MangaChapterFallback,
  MangaDexReaderSession,
  MangaReadingResume,
  MangaEnrichment,
} from "../../shared/contracts";
import { CoverImage } from "./CoverImage";
import { SimilarTitles } from "./SimilarTitles";
import { titleAccentStyle } from "./title-accent";
import { cachedArtworkUrl } from "../../shared/artwork";
import { formatMediaLabel } from "./format-label";
import { decodeHtmlEntities } from "../../shared/text";
import { hasPersonalizedAccess, type ViewerAccess } from "./viewer-access";
import { createMediaDetailSession } from "./media-detail-session";
import { motionTransition } from "./motion";
import { friendlyRemoteError } from "./remote-error";
import {
  airingOutlook,
  formatAiringTime,
  formatCountdown,
  titleReleaseNotice,
  unairedEpisode,
  type AiringOutlook,
} from "./airing";
import { UpNextButton } from "./UpNextButton";
import { animeBingeItem } from "./binge-session";
import { Select } from "./Select";
import { MalSourceIcon } from "./MalSourceIcon";
import { RatingChips, compactVotes } from "./RatingChips";
import { MangaDexSourceIcon } from "./MangaDexSourceIcon";
import { MANGA_LANGUAGES, type MangaLanguage } from "../../shared/manga-languages";
import { TitleFeedback } from "./TitleFeedback";

const MANGA_LANGUAGE_LABELS: Record<MangaLanguage, string> = { en: "English", ja: "Japanese" };

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
  onScrolledChange,
}: {
  media: AniListCatalogMedia;
  initialAction?: "details" | "play" | "read";
  initialUnit?: number;
  onClose: () => void;
  onNavigate?: (media: AniListCatalogMedia) => void;
  access: ViewerAccess;
  onLibrary?: (media: AniListCatalogMedia) => Promise<void>;
  /** Lets the shared overlay navbar gain its surface once the title page scrolls under it. */
  onScrolledChange?: (scrolled: boolean) => void;
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
  // MangaDex chapters found unreadable this session, mapped to the mirror copy that replaced them.
  const [swappedChapters, setSwappedChapters] = useState<
    ReadonlyMap<string, MangaDexReaderChapter>
  >(() => new Map());
  const loadedReaderSession = detailSnapshot.readerSession;
  const readerSession = useMemo(
    () =>
      loadedReaderSession && swappedChapters.size
        ? {
            ...loadedReaderSession,
            chapters: loadedReaderSession.chapters.map(
              (chapter) => swappedChapters.get(chapter.id) ?? chapter,
            ),
          }
        : loadedReaderSession,
    [loadedReaderSession, swappedChapters],
  );
  const [activeChapter, setActiveChapter] = useState<MangaDexReaderChapter>();
  const [chapterOpenError, setChapterOpenError] = useState<string>();
  const chapterOpenGeneration = useRef(0);
  /**
   * Opens a chapter in the reader. Mirror chapters list no page count until opened, so it is
   * resolved first. A MangaDex chapter with a mirror copy is checked first and swapped for the
   * mirror copy when MangaDex cannot serve its images.
   */
  const openChapter = useCallback((chapter: MangaDexReaderChapter | undefined): void => {
    const generation = ++chapterOpenGeneration.current;
    const current = (): boolean => generation === chapterOpenGeneration.current;
    setChapterOpenError(undefined);
    if (!chapter) return;
    const openMirror = (mirror: MangaDexReaderChapter): void => {
      void window.anistream.getMangaMirrorChapter({ chapterId: mirror.id }).then(
        (info) => {
          if (current()) setActiveChapter({ ...mirror, pages: info.pageCount });
        },
        (error: unknown) => {
          if (!current()) return;
          setChapterOpenError(
            friendlyRemoteError(error, {
              provider: mirror.sourceLabel ?? "The chapter mirror",
              operation: "chapters",
              fallback: `Chapter ${mirror.number ?? ""} could not be opened. Try again shortly.`,
            }),
          );
        },
      );
    };
    if (chapter.source === "mirror") {
      if (chapter.pages > 0) setActiveChapter(chapter);
      else openMirror(chapter);
      return;
    }
    const fallback = chapter.mirrorFallback;
    if (!fallback) {
      setActiveChapter(chapter);
      return;
    }
    void window.anistream.isMangaDexChapterReadable({ chapterId: chapter.id }).then(
      (readable) => {
        if (!current()) return;
        if (readable) {
          setActiveChapter(chapter);
          return;
        }
        const mirror: MangaDexReaderChapter = {
          ...chapter,
          id: fallback.id,
          title: undefined,
          groups: [],
          groupName: undefined,
          pages: 0,
          source: "mirror",
          sourceLabel: fallback.sourceLabel,
          mirrorFallback: undefined,
        };
        // Keep the swap in the chapter list so reader navigation and the list both use the copy.
        setSwappedChapters((previous) => new Map(previous).set(chapter.id, mirror));
        openMirror(mirror);
      },
      // The check itself failed; let the normal MangaDex path show its own error.
      () => {
        if (current()) setActiveChapter(chapter);
      },
    );
  }, []);
  const mangaResume = detailSnapshot.mangaResume;
  const mangaChapterFallback = detailSnapshot.mangaChapterFallback;
  const mangaEnrichment = detailSnapshot.mangaEnrichment;
  const loadingReader = detailSnapshot.loadingReader;
  const [rating, setRating] = useState<number>();
  const savingTracker = detailSnapshot.savingTracker;
  const malScore = detailSnapshot.malScore;
  const initialPlayHandled = useRef(false);
  const initialReadHandled = useRef(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
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

  // Not-yet-released titles and unaired next episodes are blocked with when they arrive.
  const releaseNotice = titleReleaseNotice(resolved);
  const unairedNext =
    resolved.type === "ANIME" && !releaseNotice
      ? unairedEpisode(resolved, initialEpisode)
      : undefined;
  const blockedLabel =
    releaseNotice ??
    (unairedNext
      ? unairedNext.airingAt
        ? `E${initialEpisode} airs ${formatAiringTime(unairedNext.airingAt)}`
        : `E${initialEpisode} has not aired yet`
      : undefined);

  useEffect(() => {
    if (
      initialAction === "read" &&
      !loading &&
      readerSession &&
      !releaseNotice &&
      !initialReadHandled.current
    ) {
      initialReadHandled.current = true;
      void detailSession.openReader().then(openChapter);
    }
  }, [detailSession, initialAction, loading, openChapter, readerSession, releaseNotice]);

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
    openChapter(await detailSession.openReader());
  }, [detailSession, openChapter]);

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

  // The title page is a full-window layer above the hidden route (App marks the route inert), so
  // the document stays put underneath and the shared navbar remains usable on top.
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    backButtonRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      onScrolledChange?.(false);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [onScrolledChange]);

  const isAnime = resolved.type === "ANIME";
  const libraryEntry = personalized ? access.libraryEntries.get(media.id) : undefined;
  const accentStyle = isAnime ? undefined : titleAccentStyle(resolved.coverColor);
  const mangaProgress = Math.max(detail?.listEntry?.progress ?? 0, libraryProgress);
  // Nothing readable here (not on MangaDex, no chapters, or the feed failed) and no official-site
  // fallback: Continue would open nothing, so it is hidden (user decision 2026-10-06).
  const mangaHasFallback = Boolean(
    mangaChapterFallback &&
    (mangaChapterFallback.externalChapters.length || mangaChapterFallback.missingRanges.length),
  );
  const mangaUnreadable =
    !isAnime &&
    !loadingReader &&
    !mangaHasFallback &&
    (readerSession
      ? readerSession.status !== "available" || readerSession.chapters.length === 0
      : Boolean(detailSnapshot.error));
  const primaryLabel = isAnime
    ? watchedEpisodes > 0 && watchedEpisodes < (resolved.totalProgress ?? Infinity)
      ? `Continue E${initialEpisode}`
      : "Watch"
    : mangaResume?.chapterNumber !== undefined && mangaResume.progress < 1
      ? `Resume Ch. ${formatNumber(mangaResume.chapterNumber)}`
      : mangaProgress > 0
        ? `Continue Ch. ${mangaProgress + 1}`
        : "Read";
  // The best 6 AniList picks (already ranked by community votes), skipping titles the viewer
  // already watched or read: anything on their list except Planning (user decision 2026-10-06).
  const recommendations = (detail?.recommendations ?? [])
    .filter((item) => {
      const entry = personalized ? access.libraryEntries.get(item.id) : undefined;
      return !entry || entry.status === "PLANNING";
    })
    .slice(0, 6);
  const outlook = airingOutlook(resolved);
  const sections = [
    { id: "units", label: isAnime ? "Episodes" : "Chapters" },
    ...(outlook ? [{ id: "airing", label: "Airing" }] : []),
    ...(recommendations.length ? [{ id: "similar", label: "More like this" }] : []),
    ...(detail?.externalLinks.length ? [{ id: "links", label: "Links" }] : []),
  ];
  const [activeSection, setActiveSection] = useState("units");
  const [synopsisOpen, setSynopsisOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  // MyAnimeList fills what AniList leaves empty (joined only by AniList's own idMal), credited below.
  const aniListSummary = cleanDescription(resolved.description);
  const malSummary = aniListSummary ? undefined : cleanDescription(malScore?.synopsis);
  const description =
    aniListSummary ?? malSummary ?? "AniList does not currently provide a summary for this title.";
  const malEnglishTitle = detail && !detail.titleEnglish ? malScore?.englishTitle : undefined;
  const malGenres = resolved.genres.length ? undefined : malScore?.genres;
  const genres = malGenres ?? resolved.genres;
  const malFilled = [
    malSummary ? "Summary" : undefined,
    malEnglishTitle ? "English title" : undefined,
    malGenres?.length ? "genres" : undefined,
  ].filter((part): part is string => Boolean(part));
  const altTitles = [malEnglishTitle, detail?.titleRomaji, detail?.titleNative].filter(
    (value, index, all): value is string =>
      Boolean(value) &&
      value?.toLocaleLowerCase() !== resolved.title.toLocaleLowerCase() &&
      all.indexOf(value) === index,
  );
  const credits =
    !isAnime && mangaEnrichment?.status === "available" && mangaEnrichment.authors.length
      ? mangaEnrichment.authors
      : (detail?.staff ?? [])
          .filter((person) => /story|art|original creator/i.test(person.role ?? ""))
          .map((person) => person.name)
          .filter((name, index, all) => all.indexOf(name) === index)
          .slice(0, 3);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const page = event.currentTarget;
    onScrolledChange?.(page.scrollTop > 24);
    let current = sections[0]?.id ?? "units";
    for (const section of sections) {
      const element = page.querySelector<HTMLElement>(`[data-title-section="${section.id}"]`);
      if (element && element.offsetTop - page.scrollTop <= 180) current = section.id;
    }
    if (current !== activeSection) setActiveSection(current);
  };

  const scrollToSection = (id: string): void => {
    const page = pageRef.current;
    const element = page?.querySelector<HTMLElement>(`[data-title-section="${id}"]`);
    if (!page || !element) return;
    page.scrollTo({ top: element.offsetTop - 120, behavior: reducedMotion ? "auto" : "smooth" });
    setActiveSection(id);
  };

  const manageLibrary = (): void => {
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
  };

  return (
    <motion.div
      className={`title-page ${isAnime ? "title-page--anime" : "title-page--manga"}`}
      style={accentStyle}
      ref={pageRef}
      role="dialog"
      aria-modal="false"
      aria-label={`${media.title} details`}
      onScroll={handleScroll}
      initial={reducedMotion ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      transition={motionTransition(reducedMotion, "emphasis")}
    >
      <TitleBand media={resolved} />
      <button className="title-back" type="button" ref={backButtonRef} onClick={onClose}>
        <ArrowLeft size={17} aria-hidden="true" />
        Back
      </button>

      <section className="title-main">
        <div className={`title-cover${isAnime ? "" : " title-cover--book"}`}>
          <CoverImage src={cachedArtworkUrl(resolved.coverUrl)} title={resolved.title} />
        </div>
        <div className="title-info">
          <p className="title-kicker">
            {titleKicker(resolved, detail).map((part) => (
              <span key={part}>{part}</span>
            ))}
          </p>
          <h1>{resolved.title}</h1>
          {altTitles.length ? <p className="title-alt">{altTitles.join(" · ")}</p> : null}
          {!isAnime && credits.length ? (
            <p className="title-byline">
              By <strong>{credits.join(", ")}</strong>
            </p>
          ) : null}
          {genres.length ? (
            <ul className="title-genres" aria-label="Genres">
              {genres.slice(0, 6).map((genre) => (
                <li key={genre}>{genre}</li>
              ))}
            </ul>
          ) : loading ? (
            <ul className="title-genres title-genres--loading" aria-hidden="true">
              {[78, 92, 70].map((width) => (
                <li key={width} className="sk-pill" style={{ width }} />
              ))}
            </ul>
          ) : null}
          <div className="title-actions">
            {mangaUnreadable ? null : (
              <button
                className={`title-primary${blockedLabel ? " is-upcoming" : ""}`}
                type="button"
                disabled={Boolean(blockedLabel)}
                onClick={() => {
                  if (isAnime) setAutoPlayRequest((request) => request + 1);
                  else void openPreferredChapter();
                }}
              >
                {blockedLabel ? (
                  <Clock3 size={18} />
                ) : isAnime ? (
                  <Play size={18} fill="currentColor" />
                ) : (
                  <BookOpen size={18} />
                )}
                {blockedLabel ?? primaryLabel}
              </button>
            )}
            {isAnime ? (
              <UpNextButton item={animeBingeItem(resolved)} className="title-library" />
            ) : null}
            {personalized || onLibrary ? (
              <button
                className="title-library"
                type="button"
                disabled={adding}
                aria-label={libraryEntry ? "Edit library entry" : "Add to AniList planning"}
                title={libraryEntry ? "Edit library entry" : "Add to Planning"}
                onClick={manageLibrary}
              >
                {libraryEntry ? <Check size={16} /> : <Plus size={17} />}
                {libraryEntry
                  ? `${entryStatusLabel(libraryEntry.status, isAnime)} · ${libraryEntry.progress}${
                      resolved.totalProgress ? `/${resolved.totalProgress}` : ""
                    }`
                  : "Add to list"}
              </button>
            ) : null}
            {personalized && detail ? (
              <button
                className="title-round"
                type="button"
                aria-label="Rate or complete"
                aria-expanded={ratingOpen}
                title="Rate or mark completed"
                onClick={() => setRatingOpen((open) => !open)}
              >
                <Star
                  size={18}
                  fill={detail.listEntry?.score ? "currentColor" : "none"}
                  aria-hidden="true"
                />
              </button>
            ) : null}
            <TitleFeedback
              title={resolved.title}
              target={{ type: resolved.type, id: resolved.id }}
              className="title-round"
            />
          </div>
          {ratingOpen && personalized && detail ? (
            <div className="detail-tracker-compact title-tracker">
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
          <RatingChips
            chips={[
              resolved.averageScore
                ? {
                    source: "anilist",
                    score: `${resolved.averageScore}%`,
                    detail: "AniList",
                    href: media.siteUrl,
                    title: `${resolved.averageScore}% on AniList`,
                  }
                : undefined,
              malScore?.score
                ? {
                    source: "mal",
                    score: String(malScore.score),
                    detail: malScore.scoredBy
                      ? `${compactVotes(malScore.scoredBy)} users`
                      : "MyAnimeList",
                    href: malScore.malUrl,
                    title: malScore.scoredBy
                      ? `${malScore.score}/10 from ${malScore.scoredBy.toLocaleString()} MAL users`
                      : `${malScore.score}/10 on MyAnimeList`,
                  }
                : undefined,
              !isAnime &&
              mangaEnrichment?.status === "available" &&
              mangaEnrichment.mangaUpdatesRating !== undefined
                ? {
                    source: "mangaupdates",
                    score: mangaEnrichment.mangaUpdatesRating.toFixed(2),
                    detail: "MangaUpdates",
                    title: `${mangaEnrichment.mangaUpdatesRating.toFixed(2)}/10 on MangaUpdates`,
                  }
                : undefined,
            ]}
          />
          <div className="title-stats">
            {readerSession?.statistics?.rating && readerSession.mangaDexId ? (
              <a
                href={`https://mangadex.org/title/${readerSession.mangaDexId}`}
                target="_blank"
                rel="noreferrer"
                title={`${readerSession.statistics.rating}/10 on MangaDex`}
              >
                {readerSession.statistics.rating.toFixed(2)}
                <small>MangaDex</small>
              </a>
            ) : null}
            {readerSession?.statistics?.follows !== undefined ? (
              <span>
                {compactNumber(readerSession.statistics.follows)}
                <small>follows</small>
              </span>
            ) : resolved.popularity ? (
              <span>
                {compactNumber(resolved.popularity)}
                <small>members</small>
              </span>
            ) : null}
            {detail?.duration ? (
              <span>
                {detail.duration}m<small>per episode</small>
              </span>
            ) : null}
          </div>
          {loading && !aniListSummary && !malSummary ? (
            // While details load, the summary is shaped, never "no summary".
            <div className="title-synopsis-loading" aria-hidden="true">
              <span className="sk-line" style={{ width: "96%" }} />
              <span className="sk-line" style={{ width: "90%" }} />
              <span className="sk-line" style={{ width: "62%" }} />
            </div>
          ) : description ? (
            <>
              <p className={`title-synopsis${synopsisOpen ? " is-open" : ""}`}>{description}</p>
              {description.length > 260 ? (
                <button
                  className="title-more"
                  type="button"
                  aria-expanded={synopsisOpen}
                  onClick={() => setSynopsisOpen((open) => !open)}
                >
                  {synopsisOpen ? "Show less" : "Read more"}
                </button>
              ) : null}
            </>
          ) : null}
          {malFilled.length && malScore ? (
            <p className="title-source-credit">
              <MalSourceIcon label="" />
              <span>
                {joinWords(malFilled)} from{" "}
                <a href={malScore.malUrl} target="_blank" rel="noreferrer">
                  MyAnimeList
                </a>
              </span>
            </p>
          ) : null}
        </div>
        {detail ? (
          <dl className="title-facts">
            {titleFacts(detail, mangaEnrichment).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="title-facts title-facts--loading" aria-hidden="true">
            {[70, 110, 90, 60, 80].map((width) => (
              <div key={width}>
                <span className="sk-line" style={{ width }} />
                <span className="sk-line" style={{ width: width + 30 }} />
              </div>
            ))}
          </div>
        )}
      </section>

      <nav className="title-tabs" aria-label="Title sections">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={section.id === activeSection ? "is-active" : undefined}
            aria-current={section.id === activeSection ? "true" : undefined}
            onClick={() => scrollToSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <div className="title-body">
        {loading ? (
          <div className="detail-skeleton" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <span key={index} className="sk-block detail-skeleton-card" />
            ))}
          </div>
        ) : null}
        {error || libraryError ? (
          <p className="error-banner" role="alert">
            {libraryError ?? error}
          </p>
        ) : null}

        <section className="title-section" data-title-section="units">
          {isAnime ? (
            <Suspense fallback={<p className="catalog-loading">Loading episode browser…</p>}>
              <AnimeWatchExperience
                media={resolved}
                initialEpisode={initialEpisode}
                autoPlayRequest={autoPlayRequest}
                onEpisodeWatched={markEpisodeWatched}
                onNavigate={onNavigate}
              />
            </Suspense>
          ) : (
            <MangaChapterBrowser
              session={readerSession}
              fallback={mangaChapterFallback}
              currentProgress={mangaProgress}
              totalChapters={resolved.totalProgress}
              resume={mangaResume}
              loading={loadingReader}
              loadError={detailSnapshot.error}
              onPreferenceChange={changeMangaPreferences}
              onRetry={() => void detailSession.retryReader()}
              openError={chapterOpenError}
              onRead={openChapter}
              onContinue={mangaUnreadable ? undefined : () => void openPreferredChapter()}
              continueLabel={primaryLabel}
              releaseNotice={releaseNotice}
            />
          )}
        </section>

        {outlook ? <DetailAiring outlook={outlook} total={resolved.totalProgress} /> : null}

        {recommendations.length ? (
          <section className="title-section" data-title-section="similar">
            <h2>More like this</h2>
            <SimilarTitles
              items={recommendations.map((item) => ({
                key: String(item.id),
                title: item.title,
                posterUrl: item.coverUrl,
                meta: [
                  formatMediaLabel(item.format),
                  item.totalProgress
                    ? `${item.totalProgress} ${item.type === "ANIME" ? "eps" : "ch"}`
                    : item.seasonYear
                      ? String(item.seasonYear)
                      : undefined,
                ]
                  .filter(Boolean)
                  .join(" · "),
                score: item.averageScore ? { label: `${item.averageScore}%` } : undefined,
                onSelect: () => onNavigate?.(item),
              }))}
            />
          </section>
        ) : null}

        {detail?.externalLinks.length ? (
          <section className="title-section" data-title-section="links">
            <h2>Links</h2>
            <div className="external-links">
              {distinctExternalLinks(detail.externalLinks)
                .slice(0, 10)
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
              chapterError={chapterOpenError}
              onChapterChange={openChapter}
              onChapterRead={markChapterRead}
              readThrough={mangaProgress}
            />
          ) : null}
        </AnimatePresence>
      </Suspense>
    </motion.div>
  );
}

/** AniList banners are a fixed 1900×400; the band keeps that exact ratio and never crops it taller. */
function TitleBand({ media }: { media: AniListCatalogMedia }): React.JSX.Element {
  const [failed, setFailed] = useState<string>();
  const banner = media.bannerUrl && media.bannerUrl !== failed ? media.bannerUrl : undefined;
  const art = banner ?? media.coverUrl;
  return (
    <header className={`title-band${banner ? "" : " title-band--fallback"}`} aria-hidden="true">
      {art ? (
        <img
          className="title-band-art"
          src={cachedArtworkUrl(art)}
          alt=""
          decoding="async"
          fetchPriority="high"
          onError={() => setFailed(media.bannerUrl)}
        />
      ) : null}
    </header>
  );
}

function titleKicker(media: AniListCatalogMedia, detail?: AniListMediaDetail): string[] {
  const parts: string[] = [];
  if (media.type === "MANGA") {
    parts.push(publicationKind(detail?.countryOfOrigin, media.format));
    const start = detail?.startDate?.slice(0, 4);
    const end = detail?.endDate?.slice(0, 4);
    if (start) parts.push(end && end !== start ? `${start}–${end}` : start);
  } else {
    parts.push(formatMediaLabel(media.format, "Anime"));
    if (media.season && media.seasonYear)
      parts.push(`${formatMediaLabel(media.season)} ${media.seasonYear}`);
    else if (media.seasonYear) parts.push(String(media.seasonYear));
    if (media.totalProgress) parts.push(`${media.totalProgress} episodes`);
    if (detail?.studios[0]) parts.push(detail.studios[0]);
  }
  if (media.status) parts.push(formatMediaLabel(media.status));
  return parts.filter((part, index, all) => part && all.indexOf(part) === index);
}

function titleFacts(
  detail: AniListMediaDetail,
  enrichment?: MangaEnrichment,
): Array<[string, string]> {
  const facts: Array<[string, string | undefined]> =
    detail.type === "ANIME"
      ? [
          ["Status", formatMediaLabel(detail.status, "—")],
          ["Aired", dateRange(detail.startDate, detail.endDate, detail.status)],
          [
            "Episodes",
            detail.totalProgress
              ? `${detail.totalProgress}${detail.duration ? ` × ${detail.duration}m` : ""}`
              : undefined,
          ],
          ["Studio", detail.studios.join(", ") || undefined],
          // The original creator replaces the source medium (user request 2026-10-08).
          ["Original Creator", staffWithRole(detail, ORIGINAL_CREATOR_ROLE)],
          ["Country", countryName(detail.countryOfOrigin)],
        ]
      : [
          ["Status", formatMediaLabel(detail.status, "—")],
          ["Published", dateRange(detail.startDate, detail.endDate, detail.status)],
          ["Chapters", detail.totalProgress ? String(detail.totalProgress) : "Ongoing"],
          ["Volumes", detail.totalVolumes ? String(detail.totalVolumes) : undefined],
          ["Original language", languageName(detail.countryOfOrigin)],
          // Story credits only (user request 2026-10-08); MangaBaka's writers fill in when AniList
          // lists none of these roles.
          ...mangaStoryCredits(detail, enrichment),
          ...(enrichment?.status === "available"
            ? ([["Publishers", enrichment.publishers.join(", ") || undefined]] satisfies Array<
                [string, string | undefined]
              >)
            : []),
        ];
  return facts.filter((fact): fact is [string, string] => Boolean(fact[1]));
}

function dateRange(start?: string, end?: string, status?: string): string | undefined {
  if (!start) return undefined;
  const from = formatFuzzyDate(start);
  if (end && end !== start) return `${from} – ${formatFuzzyDate(end)}`;
  return status === "RELEASING" ? `${from} – present` : from;
}

function formatFuzzyDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!month) return String(year);
  return new Date(year, month - 1, day || 1).toLocaleDateString("en-US", {
    month: "short",
    ...(day ? { day: "numeric" } : {}),
    year: "numeric",
  });
}

function publicationKind(country?: string, format?: string): string {
  if (format && format !== "MANGA") return formatMediaLabel(format);
  if (country === "KR") return "Manhwa";
  if (country === "CN" || country === "TW") return "Manhua";
  return "Manga";
}

function countryName(country?: string): string | undefined {
  return ({ JP: "Japan", KR: "South Korea", CN: "China", TW: "Taiwan" } as Record<string, string>)[
    country ?? ""
  ];
}

function languageName(country?: string): string | undefined {
  return ({ JP: "Japanese", KR: "Korean", CN: "Chinese", TW: "Chinese" } as Record<string, string>)[
    country ?? ""
  ];
}

function entryStatusLabel(status: string, anime: boolean): string {
  switch (status) {
    case "CURRENT":
      return anime ? "Watching" : "Reading";
    case "REPEATING":
      return anime ? "Rewatching" : "Rereading";
    case "PLANNING":
      return "Planning";
    case "COMPLETED":
      return "Completed";
    case "PAUSED":
      return "Paused";
    case "DROPPED":
      return "Dropped";
    default:
      return formatMediaLabel(status);
  }
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

type ChapterRow =
  | { kind: "read"; sortKey: number; chapter: MangaDexReaderChapter }
  | { kind: "external"; sortKey: number; chapter: MangaChapterFallback["externalChapters"][number] }
  | { kind: "range"; sortKey: number; from: number; to: number };

/**
 * One list for in-app chapters and the per-title fallback: publisher-hosted chapters and ranges no
 * provider serves open official sites in the browser and never enter in-app reading order.
 */
function buildChapterRows(
  chapters: MangaDexReaderChapter[],
  fallback: MangaChapterFallback | undefined,
  query: string,
  descending: boolean,
): ChapterRow[] {
  const normalized = query.trim().toLocaleLowerCase();
  const matches = (number: number | undefined, title: string | undefined): boolean =>
    !normalized ||
    String(number ?? "").includes(normalized) ||
    Boolean(title?.toLocaleLowerCase().includes(normalized));
  const queriedNumber = Number(normalized);
  const rows: ChapterRow[] = [
    ...chapters
      .filter((chapter) => matches(chapter.number, chapter.title))
      .map((chapter): ChapterRow => ({ kind: "read", sortKey: chapter.number ?? NaN, chapter })),
    ...(fallback?.externalChapters ?? [])
      .filter((chapter) => matches(chapter.number, chapter.title))
      .map((chapter): ChapterRow => ({
        kind: "external",
        sortKey: chapter.number ?? NaN,
        chapter,
      })),
    ...(fallback?.missingRanges ?? [])
      .filter(
        (range) =>
          !normalized ||
          (Number.isFinite(queriedNumber) &&
            queriedNumber >= range.from &&
            queriedNumber <= range.to),
      )
      .map((range): ChapterRow => ({ kind: "range", sortKey: range.from, ...range })),
  ];
  const missing = descending ? -Infinity : Infinity;
  return rows.sort((left, right) => {
    const a = Number.isNaN(left.sortKey) ? missing : left.sortKey;
    const b = Number.isNaN(right.sortKey) ? missing : right.sortKey;
    return descending ? b - a : a - b;
  });
}

type ChapterEmptyState = {
  tone: "retry" | "info";
  title: string;
  body: string;
  action: string;
};

function MangaChapterBrowser({
  session,
  fallback,
  currentProgress,
  totalChapters,
  resume,
  loading,
  loadError,
  openError,
  onPreferenceChange,
  onRetry,
  onRead,
  onContinue,
  continueLabel,
  releaseNotice,
}: {
  session?: MangaDexReaderSession;
  fallback?: MangaChapterFallback;
  currentProgress: number;
  totalChapters?: number;
  resume?: MangaReadingResume;
  loading: boolean;
  loadError?: string;
  /** A chapter (e.g. from the chapter mirror) that could not be opened. */
  openError?: string;
  onPreferenceChange: (translatedLanguage: string, preferredGroupId?: string) => void;
  onRetry: () => void;
  onRead: (chapter: MangaDexReaderChapter) => void;
  /** Absent when nothing here is readable: the progress panel then shows no Continue. */
  onContinue?: () => void;
  continueLabel: string;
  /** Set while the title is not yet released: reading is blocked with this message. */
  releaseNotice?: string;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [descending, setDescending] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const [listScrolled, setListScrolled] = useState(false);
  // English and Japanese only; list the ones this title has (plus the current choice).
  const languages = MANGA_LANGUAGES.filter(
    (language) =>
      !session ||
      language === session.translatedLanguage ||
      session.availableLanguages.includes(language),
  );
  const rows = buildChapterRows(session?.chapters ?? [], fallback, query, descending);
  const hasFallback = Boolean(
    fallback && (fallback.externalChapters.length || fallback.missingRanges.length),
  );
  const readingLinks = fallback?.readingLinks ?? [];
  const mirrorLabel = session?.chapters.find((chapter) => chapter.source === "mirror")?.sourceLabel;
  const latestChapter = Math.max(
    0,
    ...(session?.chapters ?? []).map((chapter) => Math.floor(chapter.number ?? 0)),
  );
  const knownTotal = totalChapters ?? (latestChapter || undefined);
  const languageName =
    MANGA_LANGUAGE_LABELS[(session?.translatedLanguage ?? "en") as MangaLanguage] ??
    (session?.translatedLanguage ?? "en").toUpperCase();
  const otherLanguages = languages.filter((language) => language !== session?.translatedLanguage);
  // When nothing can be listed, one friendly card explains why and offers the one useful action.
  const emptyState: ChapterEmptyState | undefined =
    loading || rows.length
      ? undefined
      : !session
        ? {
            tone: "retry",
            title: "Chapters didn’t load",
            body: loadError ?? "MangaDex didn’t respond. This is usually temporary.",
            action: "Try again",
          }
        : session.status === "unmapped"
          ? {
              tone: "info",
              title: "Not available to read here yet",
              body: "AniStream reads manga from MangaDex, and this title isn’t there yet. The Links section has official places to read it.",
              action: "Check again",
            }
          : session.status === "unavailable"
            ? {
                tone: "retry",
                title: "Chapters didn’t load",
                body: "MangaDex didn’t respond. This is usually temporary.",
                action: "Try again",
              }
            : session.chapters.length === 0
              ? {
                  tone: "info",
                  title: `No ${languageName} chapters yet`,
                  body: otherLanguages.length
                    ? `There are no ${languageName} translations on MangaDex yet. Try another language above.`
                    : `There are no ${languageName} translations on MangaDex yet. Check back later.`,
                  action: "Check again",
                }
              : undefined;
  // Search and filters only help when there is something to filter (or another language to try).
  const showToolbar = !emptyState || (session?.status === "available" && otherLanguages.length > 0);
  const nextNumber =
    resume?.chapterNumber !== undefined && resume.progress < 1
      ? resume.chapterNumber
      : currentProgress + 1;
  const volumes = volumeSummaries(rows, currentProgress);
  // At the top or bottom of the chapter list, the wheel keeps going and scrolls the title page
  // instead of stopping (Chromium otherwise waits for the wheel to pause before handing over).
  const hasChapterList = rows.length > 0;
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || event.deltaY === 0) return;
      const atTop = list.scrollTop <= 0;
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
      if (!(event.deltaY < 0 ? atTop : atBottom)) return;
      const page = list.closest<HTMLElement>(".title-page");
      if (!page) return;
      event.preventDefault();
      page.scrollBy({ top: event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY });
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => list.removeEventListener("wheel", onWheel);
  }, [hasChapterList, loading]);

  return (
    <section className="manga-chapter-browser">
      <div className="reading-panel">
        <div>
          <strong>
            {currentProgress > 0 || resume
              ? `You're on chapter ${formatNumber(nextNumber)}${knownTotal ? ` of ${knownTotal}` : ""}`
              : `${knownTotal ? `${knownTotal} chapters` : "Chapters"} to read`}
          </strong>
          <span>
            {knownTotal && currentProgress > 0
              ? `${Math.max(0, knownTotal - currentProgress)} chapters left`
              : currentProgress > 0
                ? `${currentProgress} read`
                : "Start from chapter 1"}
          </span>
          {knownTotal ? (
            <span className="reading-meter" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.min(1, currentProgress / knownTotal)})` }} />
            </span>
          ) : null}
        </div>
        {onContinue ? (
          <button
            className={`title-primary${releaseNotice ? " is-upcoming" : ""}`}
            type="button"
            disabled={Boolean(releaseNotice)}
            onClick={onContinue}
          >
            {releaseNotice ? <Clock3 size={17} /> : <BookOpen size={17} />}
            {releaseNotice ?? continueLabel}
          </button>
        ) : null}
      </div>
      {showToolbar ? (
        <div className="chapter-browser-toolbar">
          <label className="chapter-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search chapters"
              placeholder="Search chapter number or title…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="chapter-filter" title="Language">
            <Languages size={15} aria-hidden="true" />
            <Select
              ariaLabel="Chapter language"
              value={session?.translatedLanguage ?? "en"}
              disabled={!session || loading}
              onChange={(next) => onPreferenceChange(next)}
              options={languages.map((language) => ({
                value: language,
                label: MANGA_LANGUAGE_LABELS[language],
              }))}
            />
          </span>
          <span className="chapter-filter" title="Scanlation group">
            <Users size={15} aria-hidden="true" />
            <Select
              ariaLabel="Preferred scanlation group"
              value={session?.preferredGroupId ?? ""}
              disabled={!session || loading || session.availableGroups.length === 0}
              onChange={(next) =>
                onPreferenceChange(session?.translatedLanguage ?? "en", next || undefined)
              }
              options={[
                { value: "", label: "Any group" },
                ...(session?.availableGroups.map((group) => ({
                  value: group.id,
                  label: group.name,
                })) ?? []),
              ]}
            />
          </span>
          <button
            type="button"
            className="chapter-sort"
            aria-label={
              descending ? "Newest first. Show oldest first" : "Oldest first. Show newest first"
            }
            onClick={() => setDescending((value) => !value)}
          >
            {descending ? (
              <ArrowDownWideNarrow size={15} aria-hidden="true" />
            ) : (
              <ArrowUpNarrowWide size={15} aria-hidden="true" />
            )}
            {descending ? "Newest" : "Oldest"}
          </button>
        </div>
      ) : null}
      {!emptyState && (session?.status === "unavailable" || session?.status === "unmapped") ? (
        <p className="provider-note" role="status">
          {session.status === "unmapped"
            ? "This title isn’t on MangaDex, so its chapters open on official sites."
            : "MangaDex didn’t respond, so only official-site chapters are listed for now."}{" "}
          {session.status === "unavailable" ? (
            <button type="button" className="provider-note-link" onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </p>
      ) : null}
      {session?.status === "available" && session.message && !hasFallback ? (
        <p className="provider-note">{session.message}</p>
      ) : null}
      {hasFallback && session?.status === "available" ? (
        <p className="provider-note">
          Chapters marked with an outbound arrow are not readable in AniStream and open on an
          official site.
        </p>
      ) : null}
      {session?.archiveStatus === "partial" && session.chapters.length ? (
        <p className="provider-note">Some chapter archive pages could not be loaded.</p>
      ) : null}
      {openError ? (
        <p className="provider-note" role="alert">
          {openError}
        </p>
      ) : null}
      {loading ? (
        <div className="chapter-browser-list" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span className="chapter-row-skeleton" key={`chapter-skeleton-${index}`} />
          ))}
        </div>
      ) : emptyState ? (
        <div
          className={`chapter-empty chapter-empty--${emptyState.tone}`}
          role={emptyState.tone === "retry" ? "alert" : "status"}
        >
          <span className="chapter-empty-icon" aria-hidden="true">
            {emptyState.tone === "retry" ? <RefreshCw size={22} /> : <BookOpen size={22} />}
          </span>
          <div>
            <strong>{emptyState.title}</strong>
            <p>{emptyState.body}</p>
          </div>
          <button
            type="button"
            className={emptyState.tone === "retry" ? "is-primary" : undefined}
            onClick={onRetry}
          >
            {emptyState.tone === "retry" ? <RefreshCw size={15} aria-hidden="true" /> : null}
            {emptyState.action}
          </button>
        </div>
      ) : rows.length === 0 && session ? (
        <div className="chapter-empty chapter-empty--info" role="status">
          <span className="chapter-empty-icon" aria-hidden="true">
            <Search size={22} />
          </span>
          <div>
            <strong>No chapters match “{query.trim()}”</strong>
            <p>Try a chapter number, or clear the search to see every chapter.</p>
          </div>
          <button type="button" onClick={() => setQuery("")}>
            Clear search
          </button>
        </div>
      ) : (
        <div className="chapter-scroll-frame">
          <div
            ref={listRef}
            className="chapter-browser-list chapter-ledger"
            onScroll={(event) => setListScrolled(event.currentTarget.scrollTop > 240)}
          >
            {rows.map((row, index) => {
              const volume = volumes.get(index);
              const heading = volume ? (
                <div className="chapter-volume" key={`volume-${index}`}>
                  <strong>{volume.label}</strong>
                  <span>{volume.range}</span>
                  <span className="chapter-volume-meter" aria-hidden="true">
                    <span style={{ transform: `scaleX(${volume.read / volume.count})` }} />
                  </span>
                  <span>
                    {volume.read}/{volume.count}
                  </span>
                </div>
              ) : null;
              if (row.kind === "range") {
                const label = row.from === row.to ? `Ch. ${row.from}` : `Ch. ${row.from}–${row.to}`;
                return [
                  heading,
                  <div className="chapter-range-row" key={`range-${row.from}`}>
                    <span className="chapter-language">
                      {fallback?.translatedLanguage.toLocaleUpperCase()}
                    </span>
                    <strong>
                      {label}
                      <small> · Not in AniStream. Read on</small>
                    </strong>
                    <span className="chapter-range-links">
                      {readingLinks.map((link) => (
                        <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                          {link.site}
                          <ExternalLink size={12} />
                        </a>
                      ))}
                    </span>
                  </div>,
                ];
              }
              if (row.kind === "external") {
                const { chapter } = row;
                const completed =
                  chapter.number !== undefined && Math.floor(chapter.number) <= currentProgress;
                return [
                  heading,
                  <a
                    className={`chapter-row chapter-external-row${completed ? " is-read" : ""}`}
                    key={chapter.id}
                    href={chapter.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Chapter ${chapter.number ?? "?"} on ${chapter.site} (opens in browser)`}
                  >
                    <span className="chapter-dot" aria-hidden="true" />
                    <span className="chapter-number">Ch. {chapter.number ?? "?"}</span>
                    <span className="chapter-title">
                      {chapter.title ?? `Chapter ${chapter.number ?? ""}`}
                    </span>
                    <span className="chapter-group">{chapter.site}</span>
                    <span className="chapter-language">
                      {chapter.translatedLanguage.toLocaleUpperCase()}
                    </span>
                    <span className="chapter-date">{relativeDate(chapter.publishedAt)}</span>
                    <ExternalLink size={16} />
                  </a>,
                ];
              }
              const { chapter } = row;
              const completed =
                chapter.number !== undefined && Math.floor(chapter.number) <= currentProgress;
              const isNext =
                !completed && chapter.number !== undefined && chapter.number === nextNumber;
              const readingProgress = resume?.chapterId === chapter.id ? resume.progress : 0;
              return [
                heading,
                <button
                  type="button"
                  key={chapter.id}
                  className={`chapter-row${completed ? " is-read" : ""}${isNext ? " is-next" : ""}`}
                  onClick={() => onRead(chapter)}
                  aria-label={`Read chapter ${chapter.number ?? "?"}${chapter.title ? `: ${chapter.title}` : ""}${completed ? " (read)" : ""}`}
                >
                  <span className="chapter-dot" aria-hidden="true">
                    {completed ? <Check size={11} /> : null}
                  </span>
                  <span className="chapter-number">Ch. {chapter.number ?? "?"}</span>
                  <span className="chapter-title">
                    {chapter.title ?? `Chapter ${chapter.number ?? "?"}`}
                    {isNext ? <span className="chapter-next">Up next</span> : null}
                  </span>
                  <span className="chapter-group">
                    {chapter.source === "mirror"
                      ? chapter.sourceLabel
                      : chapter.groups.map((group) => group.name).join(" + ") || "—"}
                  </span>
                  <span className="chapter-language">
                    {chapter.translatedLanguage.toLocaleUpperCase()}
                  </span>
                  <span className="chapter-date">{relativeDate(chapter.publishedAt)}</span>
                  <BookOpen size={16} />
                  {readingProgress > 0 && readingProgress < 1 ? (
                    <span className="chapter-reading-progress" aria-hidden="true">
                      <span style={{ transform: `scaleX(${readingProgress})` }} />
                    </span>
                  ) : null}
                </button>,
              ];
            })}
          </div>
          {listScrolled ? (
            <button
              type="button"
              className="chapter-scroll-top"
              onClick={() => listRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            >
              <ArrowUp size={15} aria-hidden="true" />
              Top
            </button>
          ) : null}
        </div>
      )}
      {session?.status === "available" && session.chapters.some((chapter) => !chapter.source) ? (
        // MangaDex's acceptable-usage policy requires crediting MangaDex and the scanlation groups.
        <p className="chapter-browser-credit">
          <MangaDexSourceIcon label="" />
          Chapters from{" "}
          <a
            href={
              session.mangaDexId
                ? `https://mangadex.org/title/${session.mangaDexId}`
                : "https://mangadex.org"
            }
            target="_blank"
            rel="noreferrer"
          >
            MangaDex
          </a>
          . Translations by the scanlation groups named on each chapter.
        </p>
      ) : null}
      {mirrorLabel ? (
        <p className="chapter-browser-credit">
          Chapters marked {mirrorLabel} come from {mirrorLabel}, filling numbers MangaDex does not
          have.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Volume headings for runs of in-app chapters, keyed by the row index that starts each run.
 * Rows without a volume (unvolumed, external, or missing ranges) never open a heading.
 */
function volumeSummaries(
  rows: ChapterRow[],
  currentProgress: number,
): Map<number, { label: string; range: string; read: number; count: number }> {
  const headings = new Map<number, { label: string; range: string; read: number; count: number }>();
  let start = -1;
  let volume: string | undefined;
  const close = (end: number): void => {
    if (start < 0 || !volume) return;
    const numbers = rows
      .slice(start, end)
      .flatMap((row) =>
        row.kind === "read" && row.chapter.number !== undefined ? [row.chapter.number] : [],
      );
    if (!numbers.length) return;
    headings.set(start, {
      label: `Volume ${volume}`,
      range: `Ch. ${formatNumber(Math.min(...numbers))}–${formatNumber(Math.max(...numbers))}`,
      read: numbers.filter((number) => Math.floor(number) <= currentProgress).length,
      count: numbers.length,
    });
  };
  rows.forEach((row, index) => {
    const next = row.kind === "read" ? row.chapter.volume : undefined;
    if (next === volume) return;
    close(index);
    volume = next;
    start = next ? index : -1;
  });
  close(rows.length);
  return headings;
}

const AIRING_ROWS_SHOWN = 5;
/** Beyond a week the date says enough; a countdown only helps for what is close. */
const COUNTDOWN_WINDOW_MS = 7 * 86_400_000;

/** AniList's scheduled airings; a scheduled episode is not a promise the player has it yet. */
function DetailAiring({
  outlook,
  total,
}: {
  outlook: AiringOutlook;
  total?: number;
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const last = outlook.rows.find((row) => row.final);
  return (
    <section className="title-section" data-title-section="airing">
      <h2>Airing schedule</h2>
      <p className="title-airing-summary">
        {[
          outlook.cadence,
          last
            ? `Finale (episode ${last.episode}) ${formatAiringTime(last.airingAt, now)}`
            : total
              ? `${total} episodes planned`
              : undefined,
        ]
          .filter(Boolean)
          .join(" · ") || "Times are shown in your local time zone."}
      </p>
      <ol className="title-airing">
        {outlook.rows.slice(0, AIRING_ROWS_SHOWN).map((row, index) => (
          <li key={row.episode} className={index === 0 ? "is-next" : undefined}>
            <strong>Episode {row.episode}</strong>
            <time dateTime={new Date(row.airingAt * 1000).toISOString()}>
              {formatAiringTime(row.airingAt, now)}
            </time>
            {row.final ? <em>Finale</em> : null}
            {row.airingAt * 1000 - now < COUNTDOWN_WINDOW_MS ? (
              <span>{formatCountdown(row.airingAt, now)}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

const ORIGINAL_CREATOR_ROLE = /^original (?:creator|story)\b/i;
const MANGA_STORY_ROLES: Array<[label: string, role: RegExp]> = [
  ["Original Story", /^original (?:story|creator)\b/i],
  ["Story & Art", /^story\s*(?:&|and)\s*art\b/i],
  ["Story", /^story\b(?!\s*(?:&|and))/i],
];

/** Names AniList credits with a role (roles may carry notes, e.g. "Story (ch 1-5)"). */
function staffWithRole(detail: AniListMediaDetail, role: RegExp): string | undefined {
  const names = detail.staff
    .filter((person) => role.test((person.role ?? "").trim()))
    .map((person) => person.name)
    .filter((name, index, all) => all.indexOf(name) === index);
  return names.length ? names.slice(0, 3).join(", ") : undefined;
}

function mangaStoryCredits(
  detail: AniListMediaDetail,
  enrichment?: MangaEnrichment,
): Array<[string, string | undefined]> {
  const credits = MANGA_STORY_ROLES.map(([label, role]): [string, string | undefined] => [
    label,
    staffWithRole(detail, role),
  ]).filter(([, names]) => names);
  if (credits.length) return credits;
  return enrichment?.status === "available" && enrichment.authors.length
    ? [["Story", enrichment.authors.slice(0, 3).join(", ")]]
    : [];
}

/** "Summary", "Summary and English title", "Summary, English title and genres". */
function joinWords(parts: string[]): string {
  const sentence =
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
  return sentence.charAt(0).toLocaleUpperCase() + sentence.slice(1);
}

/** Plain text from an AniList (HTML/markdown-ish) or MAL summary; undefined when empty. */
function cleanDescription(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
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
