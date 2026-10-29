import {
  ArrowDownWideNarrow,
  ArrowUp,
  ArrowUpNarrowWide,
  BookOpen,
  Check,
  ExternalLink,
  RefreshCw,
  Languages,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  MangaDexReaderChapter,
  MangaChapterFallback,
  MangaDexReaderSession,
  MangaReadingResume,
} from "../../shared/contracts";
import { ChapterDownloadToggle, MangaDownloadButton } from "./ChapterDownloadButtons";
import { Select } from "./Select";
import { MangaDexSourceIcon } from "./MangaDexSourceIcon";
import { MANGA_LANGUAGES, type MangaLanguage } from "../../shared/manga-languages";
import { formatNumber } from "./title-facts";

const MANGA_LANGUAGE_LABELS: Record<MangaLanguage, string> = { en: "English", ja: "Japanese" };

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

export function MangaChapterBrowser({
  media,
  session,
  downloadedOnly,
  fallback,
  officialLinks,
  currentProgress,
  resume,
  loading,
  loadError,
  openError,
  onPreferenceChange,
  onRetry,
  onRead,
}: {
  /** The title, for chapter downloads. */
  media: AniListCatalogMedia;
  session?: MangaDexReaderSession;
  /** Offline: `session` holds only the downloaded chapters. */
  downloadedOnly?: boolean;
  fallback?: MangaChapterFallback;
  /** AniList's official sites for the title: offered when MangaDex does not have it. */
  officialLinks: AniListMediaDetail["externalLinks"];
  currentProgress: number;
  resume?: MangaReadingResume;
  loading: boolean;
  loadError?: string;
  /** A chapter (e.g. from the chapter mirror) that could not be opened. */
  openError?: string;
  onPreferenceChange: (translatedLanguage: string, preferredGroupId?: string) => void;
  onRetry: () => void;
  onRead: (chapter: MangaDexReaderChapter) => void;
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
  // Not on MangaDex: the official reading sites, else AniList's links for the title.
  const unmappedLinks: Array<{ site: string; url: string }> = readingLinks.length
    ? readingLinks
    : officialLinks;
  const mirrorLabel = session?.chapters.find((chapter) => chapter.source === "mirror")?.sourceLabel;
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
        : session.mirrorUnavailable &&
            (session.status === "unmapped" || session.chapters.length === 0)
          ? {
              // The chapter mirror may well have this title; it just did not answer this time.
              tone: "retry",
              title: "English chapters couldn’t be checked",
              body: `${
                session.status === "unmapped"
                  ? "This title isn’t on MangaDex"
                  : "MangaDex has no English chapters for this title"
              }, and ${session.mirrorUnavailable} didn’t respond. This is usually temporary; try again in a few minutes.`,
              action: "Try again",
            }
          : session.status === "unmapped"
            ? {
                tone: "info",
                title: "Not available to read here yet",
                body: unmappedLinks.length
                  ? "AniStream reads manga from MangaDex, and this title isn’t there yet. You can read it on these official sites:"
                  : "AniStream reads manga from MangaDex, and this title isn’t there yet.",
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
      {/* The title header's Read button and the list's current row already show where the reader
          is (user decision 2026-10-28); offline, one line says why only downloads are listed. */}
      {downloadedOnly && session ? (
        <p className="reading-offline-note" role="status">
          <strong>
            {session.chapters.length} downloaded{" "}
            {session.chapters.length === 1 ? "chapter" : "chapters"}
          </strong>
          <span>Read without a connection</span>
        </p>
      ) : null}
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
          {session ? (
            <MangaDownloadButton media={media} session={session} readThrough={currentProgress} />
          ) : null}
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
            {session?.status === "unmapped" && unmappedLinks.length ? (
              <span className="chapter-range-links chapter-empty-links">
                {unmappedLinks.map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                    {link.site}
                    <ExternalLink size={12} />
                  </a>
                ))}
              </span>
            ) : null}
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
                <div className="chapter-row-wrap" key={chapter.id}>
                  <button
                    type="button"
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
                    <span className="chapter-download-slot" aria-hidden="true" />
                    {readingProgress > 0 && readingProgress < 1 ? (
                      <span className="chapter-reading-progress" aria-hidden="true">
                        <span style={{ transform: `scaleX(${readingProgress})` }} />
                      </span>
                    ) : null}
                  </button>
                  <ChapterDownloadToggle media={media} chapter={chapter} />
                </div>,
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
