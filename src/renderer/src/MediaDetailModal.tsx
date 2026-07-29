import { BookOpen, Check, ExternalLink, Play, Plus, Star, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  MalScore,
  MangaEnrichment,
  MangaDexReaderChapter,
  MangaDexReaderPage,
  MangaDexReaderSession,
} from "../../shared/contracts";
import { AnimeWatchExperience } from "./AnimeWatchExperience";
import { safeBackgroundUrl } from "./safe-css-url";

export function MediaDetailModal({
  media,
  initialAction = "details",
  onClose,
  onAdded,
}: {
  media: AniListCatalogMedia;
  initialAction?: "details" | "play" | "read";
  onClose: () => void;
  onAdded: () => Promise<void>;
}): React.JSX.Element {
  const [detail, setDetail] = useState<AniListMediaDetail>();
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showPlayback, setShowPlayback] = useState(initialAction !== "details");
  const [readerSession, setReaderSession] = useState<MangaDexReaderSession>();
  const [activeChapter, setActiveChapter] = useState<MangaDexReaderChapter>();
  const [readerPage, setReaderPage] = useState<MangaDexReaderPage>();
  const [mangaEnrichment, setMangaEnrichment] = useState<MangaEnrichment>();
  const [loadingReader, setLoadingReader] = useState(false);
  const [rating, setRating] = useState(0);
  const [savingTracker, setSavingTracker] = useState(false);
  const [malScore, setMalScore] = useState<MalScore>();
  const lastMarkedEpisode = useRef<number | undefined>(undefined);
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
    if (!malId) {
      setMalScore(undefined);
      return;
    }
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
    if (media.type !== "MANGA") return;
    let active = true;
    void Promise.allSettled([
      window.anistream.getMangaEnrichment(media.id),
      window.anistream.getMangaDexReader({ aniListId: media.id, title: media.title }),
    ]).then(([enrichmentResult, readerResult]) => {
      if (!active) return;
      if (enrichmentResult.status === "fulfilled") {
        setMangaEnrichment(enrichmentResult.value);
      }
      if (readerResult.status === "fulfilled") {
        setReaderSession(readerResult.value);
        if (initialAction === "read") {
          const nextChapter = (detail?.listEntry?.progress ?? 0) + 1;
          const chapter =
            readerResult.value.chapters.find(
              (item) => item.number !== undefined && item.number >= nextChapter,
            ) ?? readerResult.value.chapters.at(-1);
          if (chapter) {
            setActiveChapter(chapter);
            void window.anistream
              .getMangaDexPage({ chapterId: chapter.id, page: 0 })
              .then((page) => {
                if (active) setReaderPage(page);
              });
          }
        }
      }
    });
    return () => {
      active = false;
    };
  }, [detail?.listEntry?.progress, initialAction, media.id, media.title, media.type]);

  const ensureListEntry = useCallback(async (): Promise<AniListMediaDetail> => {
    const current = detail ?? (await window.anistream.getAniListMediaDetail(media.id, media.type));
    if (current.listEntry) return current;
    await window.anistream.addAniListEntry(current.id);
    const added = await window.anistream.getAniListMediaDetail(current.id, current.type);
    setDetail(added);
    await onAdded();
    return added;
  }, [detail, media.id, media.type, onAdded]);

  const markEpisodeWatched = useCallback(
    async (episodeNumber: number): Promise<void> => {
      if (lastMarkedEpisode.current === episodeNumber) return;
      lastMarkedEpisode.current = episodeNumber;
      setSavingTracker(true);
      setError(undefined);
      try {
        const current = await ensureListEntry();
        if (!current.listEntry) throw new Error("AniList did not return the new list entry.");
        const nextProgress = Math.max(current.listEntry.progress, episodeNumber);
        const completed = Boolean(current.totalProgress && nextProgress >= current.totalProgress);
        await window.anistream.updateAniListEntry({
          id: current.listEntry.id,
          progress: nextProgress,
          status: completed ? "COMPLETED" : "CURRENT",
        });
        const updated = await window.anistream.getAniListMediaDetail(current.id, current.type);
        setDetail(updated);
        setRating(updated.listEntry?.score ?? 0);
        await onAdded();
      } catch (reason) {
        lastMarkedEpisode.current = undefined;
        setError(reason instanceof Error ? reason.message : "Unable to update AniList progress.");
      } finally {
        setSavingTracker(false);
      }
    },
    [ensureListEntry, onAdded],
  );

  const markMediaCompleted = useCallback(async (): Promise<void> => {
    setSavingTracker(true);
    setError(undefined);
    try {
      const current = await ensureListEntry();
      if (!current.listEntry) throw new Error("AniList entry was not created.");
      await window.anistream.updateAniListEntry({
        id: current.listEntry.id,
        status: "COMPLETED",
        progress: current.totalProgress ?? current.listEntry.progress,
      });
      const updated = await window.anistream.getAniListMediaDetail(current.id, current.type);
      setDetail(updated);
      setRating(updated.listEntry?.score ?? 0);
      await onAdded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to mark complete.");
    } finally {
      setSavingTracker(false);
    }
  }, [ensureListEntry, onAdded]);

  const markChapterRead = useCallback(
    async (chapter: MangaDexReaderChapter): Promise<void> => {
      if (chapter.number === undefined) return;
      setSavingTracker(true);
      try {
        const current = await ensureListEntry();
        if (!current.listEntry) throw new Error("AniList entry was not created.");
        const nextProgress = Math.max(current.listEntry.progress, Math.floor(chapter.number));
        await window.anistream.updateAniListEntry({
          id: current.listEntry.id,
          progress: nextProgress,
          status:
            current.totalProgress && nextProgress >= current.totalProgress
              ? "COMPLETED"
              : "CURRENT",
        });
        const updated = await window.anistream.getAniListMediaDetail(current.id, current.type);
        setDetail(updated);
        await onAdded();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to update manga progress.");
      } finally {
        setSavingTracker(false);
      }
    },
    [ensureListEntry, onAdded],
  );

  const loadReader = useCallback(async (): Promise<void> => {
    setLoadingReader(true);
    setError(undefined);
    try {
      const session =
        readerSession ??
        (await window.anistream.getMangaDexReader({
          aniListId: resolved.id,
          title: resolved.title,
        }));
      setReaderSession(session);
      const nextChapter = (detail?.listEntry?.progress ?? 0) + 1;
      const chapter =
        session.chapters.find((item) => item.number !== undefined && item.number >= nextChapter) ??
        session.chapters.at(-1);
      setActiveChapter(chapter);
      setReaderPage(undefined);
      if (chapter) {
        const page = await window.anistream.getMangaDexPage({ chapterId: chapter.id, page: 0 });
        setReaderPage(page);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open MangaDex reader.");
    } finally {
      setLoadingReader(false);
    }
  }, [detail, readerSession, resolved.id, resolved.title]);

  const loadReaderPage = useCallback(
    async (chapter: MangaDexReaderChapter, page: number): Promise<void> => {
      setLoadingReader(true);
      setError(undefined);
      try {
        setActiveChapter(chapter);
        const nextPage = await window.anistream.getMangaDexPage({ chapterId: chapter.id, page });
        setReaderPage(nextPage);
        if (page + 1 === nextPage.pageCount) void markChapterRead(chapter);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to load MangaDex page.");
      } finally {
        setLoadingReader(false);
      }
    },
    [markChapterRead],
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <article
        className="detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${media.title} details`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="detail-close" type="button" aria-label="Close details" onClick={onClose}>
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
                  setShowPlayback(true);
                  if (resolved.type === "MANGA") void loadReader();
                }}
              >
                {resolved.type === "ANIME" ? (
                  <Play size={18} fill="currentColor" />
                ) : (
                  <BookOpen size={18} />
                )}
                {resolved.type === "ANIME" ? "Watch" : "Read"}
              </button>
              <button
                className="round-action detail-add"
                type="button"
                disabled={adding || Boolean(detail?.listEntry)}
                aria-label={detail?.listEntry ? "Already in AniList" : "Add to AniList planning"}
                onClick={() => {
                  setAdding(true);
                  void window.anistream
                    .addAniListEntry(media.id)
                    .then(onAdded)
                    .then(() => window.anistream.getAniListMediaDetail(media.id, media.type))
                    .then(setDetail)
                    .catch((reason: unknown) => {
                      setError(reason instanceof Error ? reason.message : "Unable to add title.");
                    })
                    .finally(() => setAdding(false));
                }}
              >
                {detail?.listEntry ? <Check size={19} /> : <Plus size={19} />}
              </button>
            </div>
          </div>
        </div>

        <div className="detail-body">
          {loading ? <p className="catalog-loading">Loading full AniList data…</p> : null}
          {error ? <p className="error-banner">{error}</p> : null}

          {showPlayback ? (
            resolved.type === "ANIME" ? (
              <AnimeWatchExperience
                media={resolved}
                initialEpisode={initialEpisode}
                onEpisodeWatched={markEpisodeWatched}
              />
            ) : (
              <section className="playback-stage">
                <button type="button" onClick={() => setShowPlayback(false)}>
                  Close reader
                </button>
                <MangaReader
                  session={readerSession}
                  chapter={activeChapter}
                  page={readerPage}
                  loading={loadingReader}
                  onChapterChange={(chapter) => void loadReaderPage(chapter, 0)}
                  onPageChange={(page) => {
                    if (activeChapter) void loadReaderPage(activeChapter, page);
                  }}
                />
              </section>
            )
          ) : null}

          {resolved.type === "MANGA" ? (
            <MangaChapterBrowser
              session={readerSession}
              currentProgress={detail?.listEntry?.progress ?? 0}
              onRead={(chapter) => {
                setShowPlayback(true);
                void loadReaderPage(chapter, 0);
              }}
            />
          ) : null}

          {detail ? (
            <section className="detail-tracker">
              <div className="tracker-heading">
                <div>
                  <p className="catalog-kicker">AniList sync</p>
                  <h3>Keep your progress current</h3>
                </div>
                {detail.listEntry ? <span>{detail.listEntry.progress} completed</span> : null}
              </div>
              <div className="tracker-controls">
                <label>
                  <Star size={15} />
                  Rating
                  <input
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
                  className="quiet-button"
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
                      .then(() => onAdded())
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
                  className="quiet-button"
                  type="button"
                  disabled={savingTracker}
                  onClick={() => void markMediaCompleted()}
                >
                  Mark completed
                </button>
              </div>
            </section>
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
                    <img src={relation.media.coverUrl} alt="" />
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
                {detail.externalLinks.slice(0, 8).map((link) => (
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
      </article>
    </div>
  );
}

function MangaReader({
  session,
  chapter,
  page,
  loading,
  onChapterChange,
  onPageChange,
}: {
  session?: MangaDexReaderSession;
  chapter?: MangaDexReaderChapter;
  page?: MangaDexReaderPage;
  loading: boolean;
  onChapterChange: (chapter: MangaDexReaderChapter) => void;
  onPageChange: (page: number) => void;
}): React.JSX.Element {
  if (loading && !page) return <p className="catalog-loading">Opening MangaDex reader…</p>;
  if (!session || session.status !== "available" || !chapter || !page) {
    return <p className="provider-note">{session?.message ?? "MangaDex reader is unavailable."}</p>;
  }
  return (
    <div className="manga-reader">
      <div className="reader-toolbar">
        <select
          aria-label="Chapter"
          value={chapter.id}
          onChange={(event) => {
            const next = session.chapters.find((item) => item.id === event.target.value);
            if (next) onChapterChange(next);
          }}
        >
          {session.chapters.map((item) => (
            <option key={item.id} value={item.id}>
              Ch. {item.number ?? "?"}
              {item.title ? ` — ${item.title}` : ""}
            </option>
          ))}
        </select>
        <span>
          Page {page.page + 1} / {page.pageCount}
        </span>
      </div>
      <img src={page.imageDataUrl} alt={`Page ${page.page + 1}`} className="manga-page" />
      <div className="reader-pagination">
        <button
          type="button"
          disabled={loading || page.page <= 0}
          onClick={() => onPageChange(page.page - 1)}
        >
          Previous page
        </button>
        <button
          type="button"
          disabled={loading || page.page + 1 >= page.pageCount}
          onClick={() => onPageChange(page.page + 1)}
        >
          Next page
        </button>
      </div>
    </div>
  );
}

function MangaChapterBrowser({
  session,
  currentProgress,
  onRead,
}: {
  session?: MangaDexReaderSession;
  currentProgress: number;
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
      {!session ? <p className="catalog-loading">Loading MangaDex chapters…</p> : null}
      <div className="chapter-browser-list">
        {chapters.map((chapter) => {
          const completed =
            chapter.number !== undefined && Math.floor(chapter.number) <= currentProgress;
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
            </button>
          );
        })}
      </div>
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
            {person.imageUrl ? <img src={person.imageUrl} alt="" loading="lazy" /> : <span />}
            <strong>{person.name}</strong>
            <small>{formatLabel(person.role)}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatLabel(value?: string): string {
  return value?.replaceAll("_", " ").toLocaleLowerCase() ?? "—";
}

function cleanDescription(value?: string): string {
  if (!value) return "AniList does not currently provide a summary for this title.";
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/~!|!~/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
