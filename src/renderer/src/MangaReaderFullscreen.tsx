import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  List,
  Maximize,
  Maximize2,
  Minimize,
  Minimize2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
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
import { Select } from "./Select";
import { Pills, Toggle } from "./SettingsView";
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
import { useCaptionControlsVisibility } from "./useCaptionControlsVisibility";
import { MangaDexSourceIcon } from "./MangaDexSourceIcon";
import { playStarted } from "./play-timer";

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
  /** Shown at the chapter end when the next/previous chapter could not be opened. */
  chapterError?: string;
  /** Chapters up to this number show as read in the chapters drawer. */
  readThrough?: number;
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
  useEffect(() => playStarted("MANGA"), []);

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
  chapterError,
  readThrough,
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
  const toggleFit = (): void =>
    changeSettings({
      ...preferences.settings,
      fit: preferences.settings.fit === "width" ? "original" : "width",
    });
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
          chapter.source === "mirror"
            ? window.anistream.getMangaMirrorPage({ chapterId: chapter.id, page })
            : window.anistream.getMangaDexPage({ chapterId: chapter.id, page, quality }),
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
  const [panel, setPanel] = useState<"chapters" | "settings">();
  const togglePanel = useCallback(
    (next: "chapters" | "settings") => setPanel((current) => (current === next ? undefined : next)),
    [],
  );
  // An open panel keeps the controls on screen until it closes.
  useEffect(() => setReaderControlsPinned(Boolean(panel)), [panel, setReaderControlsPinned]);
  const panelRef = useRef(panel);
  useEffect(() => {
    panelRef.current = panel;
  }, [panel]);
  const [page, setPage] = useState(1);
  const readerControlsShown =
    readerControlsVisible || Boolean(panel || readerSnapshot.persistenceError || fullscreenError);
  useCaptionControlsVisibility(true, readerControlsShown);
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
    // The page under the middle of the view; pages differ in height, so measure them.
    const container = containerRef.current;
    if (!container) return;
    const middle = container.getBoundingClientRect().top + container.clientHeight / 2;
    const pages = container.querySelectorAll<HTMLElement>(".manga-strip-page");
    let index = 0;
    while (index < pages.length - 1 && pages[index]!.getBoundingClientRect().bottom < middle)
      index += 1;
    setPage(Math.min(Math.max(1, chapter.pages), index + 1));
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
      if (panelRef.current) {
        setPanel(undefined);
        return;
      }
      onClose();
    };
    const handleFullscreenChange = (): void => {
      if (document.fullscreenElement) return;
      // Chromium can consume Escape to leave native fullscreen before React sees it.
      // Keep the reader open when that Escape was meant for an open panel.
      setPanel(undefined);
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [onClose, isFullscreenEscape]);

  // Single-key shortcuts, ignored while typing (chapter search) or with modifiers.
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (key === "c") togglePanel("chapters");
      else if (key === "s") togglePanel("settings");
      else if (key === "w") toggleFit();
      else if (key === "f") void toggleFullscreen();
      else return;
      event.preventDefault();
      revealReaderControls();
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  });

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
        // Near the top, right, or bottom edge (where the controls sit) reveals them.
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientY - rect.top <= 120 ||
          rect.right - event.clientX <= 140 ||
          rect.bottom - event.clientY <= 90
        )
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
        data-visible={readerControlsShown}
        aria-hidden={!readerControlsShown}
        inert={readerControlsShown ? undefined : true}
        onFocusCapture={() => setReaderControlsPinned(true)}
        onBlurCapture={(event) => {
          if (!panel && !event.currentTarget.contains(event.relatedTarget as Node | null))
            setReaderControlsPinned(false);
        }}
      >
        {/* Window drag area beside the caption buttons; present only while the controls show. */}
        {readerControlsShown ? <div className="reader-drag-strip" aria-hidden="true" /> : null}
        <div className="reader-top">
          <button
            type="button"
            className="reader-round manga-reader-close"
            onClick={onClose}
            aria-label="Close reader"
            title="Close reader (Esc)"
          >
            <ArrowLeft size={19} />
          </button>
          <div className="reader-title">
            <strong>{title}</strong>
            <i aria-hidden="true" />
            <span>
              Ch. {formatChapterNumber(chapter)}
              {chapter.title ? ` · ${chapter.title}` : ""}
            </span>
            <i aria-hidden="true" />
            {chapter.source === "mirror" ? (
              <span className="reader-title-credit">via {chapter.sourceLabel}</span>
            ) : (
              <span className="reader-title-credit">
                {chapter.groups.length
                  ? `${chapter.groups.map((group) => group.name).join(" + ")} · via`
                  : "via"}
                <MangaDexSourceIcon label="" />
                MangaDex
              </span>
            )}
          </div>
        </div>
        {readerSnapshot.persistenceError || fullscreenError ? (
          <div className="reader-alert" role="alert">
            {readerSnapshot.persistenceError ? (
              <>
                <p>Progress could not be saved: {readerSnapshot.persistenceError}</p>
                <button type="button" onClick={() => readerSession.retryPersistence()}>
                  Retry saving
                </button>
              </>
            ) : (
              <p>{fullscreenError}</p>
            )}
          </div>
        ) : null}

        {panel !== "chapters" ? (
          <nav className="reader-chapter-pill" aria-label="Chapter navigation">
            <button
              type="button"
              disabled={!previousChapter}
              aria-label="Previous chapter"
              title="Previous chapter"
              onClick={() => previousChapter && onChapterChange(previousChapter)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              Ch. {formatChapterNumber(chapter)}
              {logicalChapters.length ? (
                <em> / {formatChapterNumber(logicalChapters.at(-1))}</em>
              ) : null}
            </span>
            <button
              type="button"
              disabled={!nextChapter}
              aria-label="Next chapter"
              title="Next chapter"
              onClick={() => nextChapter && onChapterChange(nextChapter)}
            >
              <ChevronRight size={18} />
            </button>
          </nav>
        ) : null}

        <div
          className={`reader-rail${panel === "chapters" ? " is-beside-drawer" : ""}`}
          role="toolbar"
          aria-label="Reader controls"
          aria-orientation="vertical"
        >
          <RailButton
            label="Chapters"
            shortcut="C"
            active={panel === "chapters"}
            onClick={() => togglePanel("chapters")}
          >
            <List size={19} />
          </RailButton>
          <RailButton
            label="Reader settings"
            shortcut="S"
            active={panel === "settings"}
            onClick={() => togglePanel("settings")}
          >
            <SlidersHorizontal size={19} />
          </RailButton>
          <RailButton
            label={preferences.settings.fit === "width" ? "Original size" : "Fit width"}
            shortcut="W"
            onClick={toggleFit}
          >
            {preferences.settings.fit === "width" ? (
              <Minimize2 size={19} />
            ) : (
              <Maximize2 size={19} />
            )}
          </RailButton>
          <RailButton
            label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            shortcut="F"
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          </RailButton>
        </div>

        {panel === "settings" ? (
          <ReaderSettingsPopover
            settings={preferences.settings}
            saving={preferences.saving}
            error={preferences.error}
            onChange={changeSettings}
            onRetry={() => void settingsSession.retry()}
          />
        ) : null}
        {panel === "chapters" ? (
          <ReaderChapterDrawer
            chapters={logicalChapters}
            current={chapter}
            readThrough={readThrough ?? 0}
            onSelect={(next) => {
              setPanel(undefined);
              if (next.id !== chapter.id) onChapterChange(next);
            }}
            onClose={() => setPanel(undefined)}
          />
        ) : null}

        {chapter.pages > 0 ? (
          <div
            className={`reader-page-chip${panel === "chapters" ? " is-beside-drawer" : ""}`}
            aria-hidden="true"
          >
            <span>
              Page {page} / {chapter.pages}
            </span>
            <span className="reader-page-bar">
              <span style={{ transform: `scaleX(${page / chapter.pages})` }} />
            </span>
          </div>
        ) : null}
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
          {chapterError ? (
            <p className="manga-reader-end-error" role="alert">
              {chapterError}
            </p>
          ) : null}
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

function RailButton({
  label,
  shortcut,
  active = false,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={active ? "is-active" : undefined}
      aria-label={label}
      aria-pressed={active}
      aria-keyshortcuts={shortcut}
      onClick={onClick}
    >
      {children}
      <span className="reader-rail-tip" aria-hidden="true">
        {label}
        <kbd>{shortcut}</kbd>
      </span>
    </button>
  );
}

/** The saved reader settings, beside the rail; the same ones Settings → Reading changes. */
function ReaderSettingsPopover({
  settings,
  saving,
  error,
  onChange,
  onRetry,
}: {
  settings: ReaderSettings;
  saving: boolean;
  error?: string;
  onChange: (settings: ReaderSettings) => void;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <section className="reader-popover" aria-label="Reader settings">
      <h3>Reader settings</h3>
      <div className="reader-popover-row">
        <span>Page width</span>
        <Select
          ariaLabel="Page width"
          value={String(settings.width)}
          disabled={saving}
          onChange={(next) =>
            onChange({ ...settings, width: Number(next) as ReaderSettings["width"] })
          }
          options={[
            { value: "720", label: "Narrow · 720px" },
            { value: "960", label: "Medium · 960px" },
            { value: "1120", label: "Wide · 1120px" },
            { value: "1400", label: "Extra wide · 1400px" },
          ]}
        />
      </div>
      <div className="reader-popover-row">
        <span>Image fit</span>
        <Pills
          label="Image fit"
          value={settings.fit}
          disabled={saving}
          onChange={(fit) => onChange({ ...settings, fit })}
          options={[
            { value: "width", label: "Fit width" },
            { value: "original", label: "Original" },
          ]}
        />
      </div>
      <div className="reader-popover-row">
        <span>
          Quality
          <small>Applies from the next chapter</small>
        </span>
        <Pills
          label="Image quality"
          value={settings.quality}
          disabled={saving}
          onChange={(quality) => onChange({ ...settings, quality })}
          options={[
            { value: "data", label: "Original" },
            { value: "data-saver", label: "Saver" },
          ]}
        />
      </div>
      <div className="reader-popover-row">
        <span>
          Standard image port
          <small>For school or office networks</small>
        </span>
        <Toggle
          label="Standard image port only"
          checked={settings.standardPortOnly}
          disabled={saving}
          onChange={(standardPortOnly) => onChange({ ...settings, standardPortOnly })}
        />
      </div>
      {error ? (
        <p className="reader-popover-error" role="alert">
          {error}
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : null}
    </section>
  );
}

/** Every chapter, grouped by volume, newest first; the current one is marked and in view. */
function ReaderChapterDrawer({
  chapters,
  current,
  readThrough,
  onSelect,
  onClose,
}: {
  chapters: MangaDexReaderChapter[];
  current: MangaDexReaderChapter;
  /** AniList progress: chapters up to this number show as read. */
  readThrough: number;
  onSelect: (chapter: MangaDexReaderChapter) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLocaleLowerCase();
  const shown = [...chapters]
    .reverse()
    .filter(
      (chapter) =>
        !needle ||
        formatChapterNumber(chapter).startsWith(needle) ||
        chapter.title?.toLocaleLowerCase().includes(needle),
    );
  useLayoutEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[aria-current='true']")
      ?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <aside className="reader-drawer" aria-label="Chapters">
      <header>
        <h3>
          Chapters
          <small>
            {chapters.length} chapters · {current.translatedLanguage.toUpperCase()}
          </small>
        </h3>
        <button
          type="button"
          className="reader-round"
          aria-label="Close chapters"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <label className="reader-drawer-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          aria-label="Jump to chapter"
          placeholder="Jump to chapter…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="reader-drawer-list" ref={listRef}>
        {shown.map((chapter, index) => {
          const heading =
            index === 0 || shown[index - 1]?.volume !== chapter.volume ? (
              <p className="reader-drawer-volume" key={`volume-${chapter.id}`}>
                {chapter.volume ? `Volume ${chapter.volume}` : "No volume"}
              </p>
            ) : null;
          const isCurrent = chapter.id === current.id;
          const read = !isCurrent && (chapter.number ?? Infinity) <= readThrough;
          return [
            heading,
            <button
              type="button"
              key={chapter.id}
              className={`reader-drawer-row${isCurrent ? " is-current" : ""}${read ? " is-read" : ""}`}
              aria-current={isCurrent ? "true" : undefined}
              onClick={() => onSelect(chapter)}
            >
              <strong>Ch. {formatChapterNumber(chapter)}</strong>
              <span>{chapter.title ?? ""}</span>
              {isCurrent ? <em>Reading</em> : read ? <Check size={14} aria-label="Read" /> : null}
            </button>,
          ];
        })}
        {!shown.length ? <p className="reader-drawer-empty">No chapter matches.</p> : null}
      </div>
    </aside>
  );
}
