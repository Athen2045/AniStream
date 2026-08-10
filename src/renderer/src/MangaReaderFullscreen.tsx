import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
} from "framer-motion";
import { BookOpen, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
import type {
  MangaDexReaderChapter,
  MangaDexReaderSession,
  MangaReadingResume,
} from "../../shared/contracts";
import { createMangaReaderSession } from "./manga-reader-session";

const READ_COMPLETE_THRESHOLD = 0.9;
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
  const readerSession = useMemo(
    () =>
      createMangaReaderSession({
        aniListId,
        chapterId: chapter.id,
        chapterNumber: chapter.number,
        pageCount: chapter.pages,
        loadPage: (page) => window.anistream.getMangaDexPage({ chapterId: chapter.id, page }),
        createObjectUrl: (page) =>
          URL.createObjectURL(new Blob([page.imageBytes], { type: page.mimeType })),
        revokeObjectUrl: (url) => URL.revokeObjectURL(url),
        saveResume: (input) => window.anistream.saveMangaReadingResume(input),
        onChapterRead: () => onChapterRead(chapter),
      }),
    [aniListId, chapter, onChapterRead],
  );
  const readerSnapshot = useSyncExternalStore(
    readerSession.subscribe,
    readerSession.getSnapshot,
    readerSession.getSnapshot,
  );
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

  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    readerSession.markProgress(progress);
  });

  useEffect(() => {
    readerSession.requestPage(0);
    readerSession.requestPage(1);
    if (resume?.chapterId === chapter.id && resume.progress > 0) {
      const resumePage = Math.floor(resume.progress * Math.max(0, chapter.pages - 1));
      for (let page = resumePage - 2; page <= resumePage + 2; page += 1) {
        readerSession.requestPage(page);
      }
    }
    return () => readerSession.dispose();
  }, [chapter.id, chapter.pages, readerSession, resume]);

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
            {readerSnapshot.pageUrls.map((url, index) => (
              <LazyMangaPage
                key={`${chapter.id}:${index}`}
                index={index}
                url={url}
                error={readerSnapshot.pageErrors[index]}
                containerRef={containerRef}
                alt={`${title}, chapter ${formatChapterNumber(chapter)}, page ${index + 1}`}
                onNearViewport={readerSession.requestPage}
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
