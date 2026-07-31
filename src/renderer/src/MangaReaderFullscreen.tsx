import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
} from "framer-motion";
import { BookOpen, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type {
  MangaDexReaderChapter,
  MangaDexReaderSession,
  MangaReadingResume,
} from "../../shared/contracts";

const RESUME_SAVE_INTERVAL_MS = 8_000;
const READ_COMPLETE_THRESHOLD = 0.9;
const PAGE_LOAD_CONCURRENCY = 3;
const PAGE_PREFETCH_MARGIN = "1800px 0px";

export function MangaReaderFullscreen({
  aniListId,
  title,
  session,
  chapter,
  resume,
  onClose,
  onChapterChange,
  onChapterRead,
}: {
  aniListId: number;
  title: string;
  session: MangaDexReaderSession;
  chapter: MangaDexReaderChapter;
  resume?: MangaReadingResume;
  onClose: () => void;
  onChapterChange: (chapter: MangaDexReaderChapter) => void;
  onChapterRead: (chapter: MangaDexReaderChapter) => Promise<void>;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [pageUrls, setPageUrls] = useState<Array<string | undefined>>(() =>
    Array.from({ length: chapter.pages }),
  );
  const [pageErrors, setPageErrors] = useState<Record<number, string>>({});
  const pageUrlsRef = useRef(pageUrls);
  const queuedPages = useRef<number[]>([]);
  const requestedPages = useRef(new Set<number>());
  const activePageLoads = useRef(0);
  const readerActive = useRef(true);
  const lastSavedAt = useRef(0);
  const markedRead = useRef(false);
  const restoredResume = useRef(false);

  const chapterIndex = session.chapters.findIndex((item) => item.id === chapter.id);
  const previousChapter = chapterIndex > 0 ? session.chapters[chapterIndex - 1] : undefined;
  const nextChapter =
    chapterIndex >= 0 && chapterIndex + 1 < session.chapters.length
      ? session.chapters[chapterIndex + 1]
      : undefined;
  const publicationEnded =
    session.publicationStatus === "completed" || session.publicationStatus === "cancelled";

  const { scrollYProgress } = useScroll({
    container: containerRef,
    trackContentSize: true,
  });
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 150,
    damping: 28,
    mass: 0.22,
  });

  const persistProgress = useCallback(
    (progress: number, force = false): void => {
      const now = Date.now();
      if (!force && now - lastSavedAt.current < RESUME_SAVE_INTERVAL_MS) return;
      lastSavedAt.current = now;
      void window.anistream.saveMangaReadingResume({
        aniListId,
        chapterId: chapter.id,
        chapterNumber: chapter.number,
        progress: Math.min(1, Math.max(0, progress)),
      });
    },
    [aniListId, chapter.id, chapter.number],
  );

  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    persistProgress(progress);
    if (progress >= READ_COMPLETE_THRESHOLD && !markedRead.current) {
      markedRead.current = true;
      void onChapterRead(chapter);
    }
  });

  useEffect(
    () => () => {
      persistProgress(scrollYProgress.get(), true);
    },
    [persistProgress, scrollYProgress],
  );

  const requestPage = useCallback(
    (page: number): void => {
      if (
        page < 0 ||
        page >= chapter.pages ||
        pageUrlsRef.current[page] ||
        requestedPages.current.has(page)
      ) {
        return;
      }
      requestedPages.current.add(page);
      queuedPages.current.push(page);

      const pump = (): void => {
        while (
          readerActive.current &&
          activePageLoads.current < PAGE_LOAD_CONCURRENCY &&
          queuedPages.current.length
        ) {
          const nextPage = queuedPages.current.shift();
          if (nextPage === undefined) return;
          activePageLoads.current += 1;
          void window.anistream
            .getMangaDexPage({ chapterId: chapter.id, page: nextPage })
            .then((result) => {
              if (!readerActive.current) return;
              const objectUrl = URL.createObjectURL(
                new Blob([result.imageBytes], { type: result.mimeType }),
              );
              setPageUrls((current) => {
                const next = [...current];
                const previous = next[nextPage];
                if (previous) URL.revokeObjectURL(previous);
                next[nextPage] = objectUrl;
                pageUrlsRef.current = next;
                return next;
              });
              setPageErrors((current) => {
                if (!(nextPage in current)) return current;
                const next = { ...current };
                delete next[nextPage];
                return next;
              });
            })
            .catch((reason: unknown) => {
              if (!readerActive.current) return;
              requestedPages.current.delete(nextPage);
              setPageErrors((current) => ({
                ...current,
                [nextPage]:
                  reason instanceof Error ? reason.message : `Unable to load page ${nextPage + 1}.`,
              }));
            })
            .finally(() => {
              activePageLoads.current -= 1;
              pump();
            });
        }
      };

      pump();
    },
    [chapter.id, chapter.pages],
  );

  useEffect(() => {
    readerActive.current = true;
    requestPage(0);
    requestPage(1);
    if (resume?.chapterId === chapter.id && resume.progress > 0) {
      const resumePage = Math.floor(resume.progress * Math.max(0, chapter.pages - 1));
      for (let page = resumePage - 2; page <= resumePage + 2; page += 1) requestPage(page);
    }

    const requestedPagesSet = requestedPages.current;
    return () => {
      readerActive.current = false;
      queuedPages.current = [];
      for (const objectUrl of pageUrlsRef.current) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
      requestedPagesSet.clear();
    };
  }, [chapter.id, chapter.pages, requestPage, resume]);

  useEffect(() => {
    if (
      restoredResume.current ||
      !containerRef.current ||
      resume?.chapterId !== chapter.id ||
      resume.progress <= 0 ||
      resume.progress >= READ_COMPLETE_THRESHOLD
    ) {
      return;
    }
    restoredResume.current = true;
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      container.scrollTop = (container.scrollHeight - container.clientHeight) * resume.progress;
    });
    return () => cancelAnimationFrame(frame);
  }, [chapter.id, chapter.pages, resume]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || document.fullscreenElement) return;
      event.stopPropagation();
      onClose();
    };
    const handleFullscreenChange = (): void => {
      if (!document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [onClose]);

  return (
    <motion.section
      className="manga-reader-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label={`${title}, chapter ${formatChapterNumber(chapter)}`}
      initial={reducedMotion ? false : { opacity: 0, y: "4%" }}
      animate={{ opacity: 1, y: "0%" }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: "4%" }}
      transition={{ duration: reducedMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <motion.div
        className="manga-scroll-progress"
        aria-hidden="true"
        style={{ scaleX: reducedMotion ? scrollYProgress : smoothProgress }}
      />

      <header className="manga-reader-header">
        <span aria-hidden="true" />
        <div>
          <strong>{title}</strong>
          <span>Chapter {formatChapterNumber(chapter)}</span>
        </div>
        <button
          type="button"
          className="manga-reader-close"
          onClick={onClose}
          aria-label="Close reader"
        >
          <X size={20} />
        </button>
      </header>

      <nav className="manga-reader-chapter-chip" aria-label="Chapter navigation">
        <button
          type="button"
          disabled={!previousChapter}
          aria-label="Previous chapter"
          onClick={() => previousChapter && onChapterChange(previousChapter)}
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          Ch. {formatChapterNumber(chapter)}
          {session.chapters.length ? ` / ${formatChapterNumber(session.chapters.at(-1))}` : ""}
        </span>
        <button
          type="button"
          disabled={!nextChapter}
          aria-label="Next chapter"
          onClick={() => nextChapter && onChapterChange(nextChapter)}
        >
          <ChevronRight size={18} />
        </button>
      </nav>

      <div ref={containerRef} className="manga-reader-scroll">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="manga-page-strip"
            key={chapter.id}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
          >
            {pageUrls.map((url, index) => (
              <LazyMangaPage
                key={`${chapter.id}:${index}`}
                index={index}
                url={url}
                error={pageErrors[index]}
                containerRef={containerRef}
                alt={`${title}, chapter ${formatChapterNumber(chapter)}, page ${index + 1}`}
                onNearViewport={requestPage}
              />
            ))}
          </motion.div>
        </AnimatePresence>

        <footer className="manga-reader-end">
          <BookOpen size={22} />
          <h2>End of Ch. {formatChapterNumber(chapter)}</h2>
          {chapter.title ? <p>{chapter.title}</p> : null}
          <div className="manga-end-navigation">
            {previousChapter ? (
              <button type="button" onClick={() => onChapterChange(previousChapter)}>
                <ChevronLeft size={22} />
                <span>
                  <small>Previous chapter</small>
                  <strong>Ch. {formatChapterNumber(previousChapter)}</strong>
                </span>
              </button>
            ) : (
              <span />
            )}
            {nextChapter ? (
              <button type="button" onClick={() => onChapterChange(nextChapter)}>
                <span>
                  <small>Next chapter</small>
                  <strong>Ch. {formatChapterNumber(nextChapter)}</strong>
                </span>
                <ChevronRight size={22} />
              </button>
            ) : publicationEnded ? null : (
              <button type="button" className="is-unreleased" disabled>
                <span>
                  <small>Next chapter</small>
                  <strong>Not released</strong>
                </span>
                <ChevronRight size={22} />
              </button>
            )}
          </div>
        </footer>
      </div>
    </motion.section>
  );
}

function LazyMangaPage({
  index,
  url,
  error,
  containerRef,
  alt,
  onNearViewport,
}: {
  index: number;
  url?: string;
  error?: string;
  containerRef: RefObject<HTMLDivElement | null>;
  alt: string;
  onNearViewport: (page: number) => void;
}): React.JSX.Element {
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (url || error || !pageRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        onNearViewport(index);
      },
      {
        root: containerRef.current,
        rootMargin: PAGE_PREFETCH_MARGIN,
      },
    );
    observer.observe(pageRef.current);
    return () => observer.disconnect();
  }, [containerRef, error, index, onNearViewport, url]);

  return (
    <figure className="manga-strip-page" ref={pageRef}>
      {url ? (
        <img src={url} alt={alt} decoding="async" />
      ) : error ? (
        <button className="manga-page-retry" type="button" onClick={() => onNearViewport(index)}>
          <strong>Page {index + 1} could not load</strong>
          <span>{error}</span>
          <small>Retry page</small>
        </button>
      ) : (
        <div className="manga-page-skeleton" aria-label={`Loading page ${index + 1}`} />
      )}
    </figure>
  );
}

function formatChapterNumber(chapter?: MangaDexReaderChapter): string {
  if (!chapter || chapter.number === undefined) return "?";
  return Number.isInteger(chapter.number) ? String(chapter.number) : chapter.number.toFixed(1);
}
