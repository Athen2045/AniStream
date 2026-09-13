import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "framer-motion";
import { BookOpen, ChevronLeft, ChevronRight, Maximize, Minimize, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useMediaFullscreen } from "./useMediaFullscreen";
import { useAppReducedMotion } from "./useAppReducedMotion";
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
  type CSSProperties,
} from "react";
import { createReaderSettingsSession } from "./reader-settings-session";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import type { ReaderSettings } from "../../shared/reader-settings";
import type {
  AniListCatalogMedia,
  MangaDexReaderChapter,
  MangaDexReaderSession,
  MangaReadingResume,
} from "../../shared/contracts";
import { buildLogicalChapterSequence, selectAdjacentChapter } from "../../shared/chapter-selection";
import { createMangaReaderSession } from "./manga-reader-session";
import { saveMangaActivity } from "./local-activity";
import { motionTransition } from "./motion";
import { useAutoHideMediaControls } from "./useAutoHideMediaControls";

const READ_COMPLETE_THRESHOLD = 0.9;
const PAGE_PREFETCH_MARGIN = "1800px 0px";

type ReaderProps = {
  media: AniListCatalogMedia;
  aniListId: number;
  title: string;
  session: MangaDexReaderSession;
  chapter: MangaDexReaderChapter;
  resume?: MangaReadingResume;
  onClose: () => void;
  onChapterChange: (chapter: MangaDexReaderChapter) => void;
  onChapterRead: (chapter: MangaDexReaderChapter) => Promise<void>;
};

export function MangaReaderFullscreen(props: ReaderProps): React.JSX.Element {
  const { onClose } = props;
  const surface = useRef<HTMLElement>(null);
  const fullscreenControl = useMediaFullscreen(surface);
  const { exitFullscreen } = fullscreenControl;
  const closeReader = useCallback(() => {
    void exitFullscreen()
      .catch(() => undefined)
      .then(onClose);
  }, [exitFullscreen, onClose]);
  const [settingsSession] = useState(() => createReaderSettingsSession());
  const state = useSyncExternalStore(
    settingsSession.subscribe,
    settingsSession.getSnapshot,
    settingsSession.getSnapshot,
  );
  useEffect(() => {
    settingsSession.activate();
    void settingsSession.load();
    return () => settingsSession.dispose();
  }, [settingsSession]);
  useEffect(() => {
    if (state.loaded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeReader();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [state.loaded, closeReader]);
  return createPortal(
    <section ref={surface} className="media-reader-surface">
      {state.loaded ? (
        <ReaderContent
          {...props}
          onClose={closeReader}
          key={props.chapter.id}
          settingsSession={settingsSession}
          fullscreenControl={fullscreenControl}
        />
      ) : (
        <section
          className="manga-reader-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label="Opening reader"
        >
          <p role="status">Opening reader…</p>
          <button type="button" onClick={closeReader}>
            Close reader
          </button>
        </section>
      )}
    </section>,
    document.body,
  );
}

function ReaderContent({
  media,
  aniListId,
  title,
  session,
  chapter,
  resume,
  onClose,
  onChapterChange,
  onChapterRead,
  settingsSession,
  fullscreenControl,
}: ReaderProps & {
  settingsSession: ReturnType<typeof createReaderSettingsSession>;
  fullscreenControl: ReturnType<typeof useMediaFullscreen>;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const { fullscreen, fullscreenError, toggleFullscreen, isFullscreenEscape } = fullscreenControl;
  const dialogRef = useRef<HTMLElement>(null);
  const {
    visible: readerControlsVisible,
    reveal: revealReaderControls,
    setPinned: setReaderControlsPinned,
  } = useAutoHideMediaControls();
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLButtonElement>(".manga-reader-close")?.focus();
    // Preserve an accessible starting point without treating programmatic mount focus
    // as a request to keep the reader chrome permanently visible.
    setReaderControlsPinned(false);
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [setReaderControlsPinned]);
  const preferences = useSyncExternalStore(
    settingsSession.subscribe,
    settingsSession.getSnapshot,
    settingsSession.getSnapshot,
  );
  const [quality] = useState(preferences.settings.quality);
  const layoutAnchor = useRef<{ page: HTMLElement; fraction: number } | undefined>(undefined);
  const adjustingLayout = useRef(false);
  const changeSettings = (settings: ReaderSettings): void => {
    const container = containerRef.current;
    if (
      container &&
      (settings.width !== preferences.settings.width || settings.fit !== preferences.settings.fit)
    ) {
      const top = container.getBoundingClientRect().top;
      const page = [...container.querySelectorAll<HTMLElement>(".manga-strip-page")].find(
        (page) => page.getBoundingClientRect().bottom > top,
      );
      if (page) {
        const rect = page.getBoundingClientRect();
        layoutAnchor.current = { page, fraction: Math.max(0, (top - rect.top) / rect.height) };
        adjustingLayout.current = true;
      }
    }
    void settingsSession.save(settings);
  };
  useLayoutEffect(() => {
    const anchor = layoutAnchor.current;
    const container = containerRef.current;
    if (!anchor || !container) return;
    const rect = anchor.page.getBoundingClientRect();
    container.scrollTop +=
      rect.top - container.getBoundingClientRect().top + rect.height * anchor.fraction;
    layoutAnchor.current = undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        adjustingLayout.current = false;
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      adjustingLayout.current = false;
    };
  }, [preferences.settings.width, preferences.settings.fit]);
  const reducedMotion = useAppReducedMotion();
  const readerSession = useMemo(
    () =>
      createMangaReaderSession({
        aniListId,
        chapterId: chapter.id,
        chapterNumber: chapter.number,
        pageCount: chapter.pages,
        loadPage: (page) =>
          window.anistream.getMangaDexPage({ chapterId: chapter.id, page, quality }),
        createObjectUrl: (page) =>
          URL.createObjectURL(new Blob([page.imageBytes], { type: page.mimeType })),
        revokeObjectUrl: (url) => URL.revokeObjectURL(url),
        saveResume: (input) => saveMangaActivity(media, input),
        onChapterRead: () => onChapterRead(chapter),
      }),
    [aniListId, chapter, media, onChapterRead, quality],
  );
  const readerSnapshot = useSyncExternalStore(
    readerSession.subscribe,
    readerSession.getSnapshot,
    readerSession.getSnapshot,
  );
  const restoredResume = useRef(false);

  const previousChapter = selectAdjacentChapter(
    session.chapters,
    chapter.id,
    -1,
    session.preferredGroupId,
  );
  const nextChapter = selectAdjacentChapter(
    session.chapters,
    chapter.id,
    1,
    session.preferredGroupId,
  );
  const logicalChapters = buildLogicalChapterSequence(session.chapters, session.preferredGroupId);
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
    if (!adjustingLayout.current) readerSession.markProgress(progress);
  });

  useEffect(() => {
    readerSession.activate();
    if (
      resume?.chapterId === chapter.id &&
      resume.progress > 0 &&
      resume.progress < READ_COMPLETE_THRESHOLD
    ) {
      const resumePage = Math.floor(resume.progress * Math.max(0, chapter.pages - 1));
      for (let page = resumePage - 2; page <= resumePage + 2; page += 1) {
        readerSession.setPageNear(page, true);
        readerSession.requestPage(page);
      }
    } else {
      readerSession.setPageNear(0, true);
      readerSession.requestPage(0);
      readerSession.setPageNear(1, true);
      readerSession.requestPage(1);
    }
    return () => readerSession.dispose();
  }, [chapter.id, chapter.pages, readerSession, resume]);

  useLayoutEffect(() => {
    if (
      restoredResume.current ||
      !containerRef.current ||
      resume?.chapterId !== chapter.id ||
      resume.progress <= 0 ||
      resume.progress >= READ_COMPLETE_THRESHOLD
    ) {
      return;
    }
    const container = containerRef.current;
    // Restore before passive effects can report the initial top-of-chapter position.
    // A scheduled frame can be canceled by development cleanup or a resume refresh.
    container.scrollTop = (container.scrollHeight - container.clientHeight) * resume.progress;
    restoredResume.current = true;
  }, [chapter.id, chapter.pages, resume]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || isFullscreenEscape()) return;
      event.stopPropagation();
      onClose();
    };
    const handleFullscreenChange = (): void => {
      if (document.fullscreenElement) return;
      // Chromium can consume Escape to leave native fullscreen before React sees it.
      // Keep the reader open when the user's first dismissal targets its settings.
      const settings =
        dialogRef.current?.querySelector<HTMLDetailsElement>("details.reader-settings");
      if (settings?.open) {
        settings.open = false;
        settings.querySelector<HTMLElement>("summary")?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [onClose, isFullscreenEscape]);

  useEffect(() => {
    if (readerSnapshot.persistenceError || fullscreenError) revealReaderControls();
  }, [fullscreenError, readerSnapshot.persistenceError, revealReaderControls]);

  return (
    <motion.section
      ref={dialogRef}
      className="manga-reader-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label={`${title}, chapter ${formatChapterNumber(chapter)}`}
      initial={reducedMotion ? false : { opacity: 0, y: "4%" }}
      animate={{ opacity: 1, y: "0%" }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: "4%" }}
      transition={motionTransition(reducedMotion, "emphasis")}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => {
        if (event.clientY - event.currentTarget.getBoundingClientRect().top <= 120)
          revealReaderControls();
      }}
      onPointerDownCapture={(event) => {
        if (!(event.target instanceof Element)) return;
        if (!event.target.closest(".media-control-layer")) setReaderControlsPinned(false);
      }}
      onKeyDownCapture={(event) => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (event.key === "Tab") revealReaderControls();
        const settings = dialog.querySelector<HTMLDetailsElement>("details.reader-settings");
        if (event.key === "Escape" && settings?.open) {
          event.preventDefault();
          event.stopPropagation();
          settings.open = false;
          settings.querySelector<HTMLElement>("summary")?.focus();
        }
        if (event.key !== "Tab") return;
        const controls = [
          ...dialog.querySelectorAll<HTMLElement>(
            "button:not(:disabled), select:not(:disabled), summary, [tabindex='0']",
          ),
        ].filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
        if (!controls.length) return;
        event.preventDefault();
        event.stopPropagation();
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const next = (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        // Focusing the end-of-chapter controls must not scroll there and mark it read.
        controls[next]?.focus({ preventScroll: true });
      }}
    >
      <motion.div
        className="manga-scroll-progress"
        aria-hidden="true"
        style={{ scaleX: reducedMotion ? scrollYProgress : smoothProgress }}
      />
      <div
        className="media-control-reveal-zone"
        aria-hidden="true"
        onPointerMove={revealReaderControls}
      />
      <div
        className="media-control-layer media-control-layer--reader"
        data-visible={
          readerControlsVisible || Boolean(readerSnapshot.persistenceError || fullscreenError)
        }
        aria-hidden={
          !(readerControlsVisible || Boolean(readerSnapshot.persistenceError || fullscreenError))
        }
        inert={
          readerControlsVisible || readerSnapshot.persistenceError || fullscreenError
            ? undefined
            : true
        }
        onFocusCapture={() => setReaderControlsPinned(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setReaderControlsPinned(false);
        }}
      >
        <header className="manga-reader-header">
          {readerSnapshot.persistenceError ? (
            <div role="alert">
              <p>Progress could not be saved: {readerSnapshot.persistenceError}</p>
              <button type="button" onClick={() => readerSession.retryPersistence()}>
                Retry saving
              </button>
            </div>
          ) : null}
          <ReaderSettingsPanel
            settings={preferences.settings}
            quality={quality}
            saving={preferences.saving}
            error={preferences.error}
            onChange={changeSettings}
            onRetry={() => void settingsSession.retry()}
            onOpenChange={setReaderControlsPinned}
          />
          <div>
            <strong>{title}</strong>
            <span>Chapter {formatChapterNumber(chapter)}</span>
            {chapter.groups.length ? (
              <span>{chapter.groups.map((group) => group.name).join(" + ")}</span>
            ) : null}
          </div>
          <button
            className="media-fullscreen-button"
            type="button"
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          </button>
          <button
            type="button"
            className="manga-reader-close"
            onClick={onClose}
            aria-label="Close reader"
            title="Close reader"
          >
            <X size={20} />
          </button>
        </header>
        {fullscreenError ? (
          <p className="reader-fullscreen-error" role="alert">
            {fullscreenError}
          </p>
        ) : null}

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
            {logicalChapters.length ? ` / ${formatChapterNumber(logicalChapters.at(-1))}` : ""}
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
      </div>

      <div
        ref={containerRef}
        className="manga-reader-scroll"
        style={{ "--reader-width": `${preferences.settings.width}px` } as CSSProperties}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="manga-page-strip"
            data-fit={preferences.settings.fit}
            key={chapter.id}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransition(reducedMotion, "fast")}
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
                onVisibility={readerSession.setPageNear}
                onDecodeError={readerSession.markPageDecodeError}
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
  onVisibility,
  onDecodeError,
}: {
  index: number;
  url?: string;
  error?: string;
  containerRef: RefObject<HTMLDivElement | null>;
  alt: string;
  onNearViewport: (page: number) => void;
  onVisibility: (page: number, near: boolean) => void;
  onDecodeError: (page: number, url: string) => void;
}): React.JSX.Element {
  const pageRef = useRef<HTMLElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>();
  const near = useRef(false);

  useEffect(() => {
    if (!pageRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        near.current = entries.some((entry) => entry.isIntersecting);
        onVisibility(index, near.current);
        if (near.current) onNearViewport(index);
      },
      {
        root: containerRef.current,
        rootMargin: PAGE_PREFETCH_MARGIN,
      },
    );
    observer.observe(pageRef.current);
    return () => {
      observer.disconnect();
      onVisibility(index, false);
    };
  }, [containerRef, index, onNearViewport, onVisibility]);
  useEffect(() => {
    if (near.current && !url && !error) onNearViewport(index);
  }, [url, error, index, onNearViewport]);

  return (
    <figure
      className="manga-strip-page"
      ref={pageRef}
      style={
        dimensions
          ? ({
              aspectRatio: `${dimensions.width} / ${dimensions.height}`,
              "--page-natural-width": `${dimensions.width}px`,
            } as CSSProperties)
          : undefined
      }
    >
      {url ? (
        <img
          src={url}
          alt={alt}
          decoding="async"
          onError={() => onDecodeError(index, url)}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight)
              setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
          }}
        />
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
