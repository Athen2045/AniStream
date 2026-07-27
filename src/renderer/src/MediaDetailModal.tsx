import { BookOpen, Check, ExternalLink, Play, Plus, Star, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  AnimeEpisodeGuide,
  AnimeEpisodeGuideEpisode,
} from "../../shared/contracts";
import { safeBackgroundUrl } from "./safe-css-url";

export function MediaDetailModal({
  media,
  onClose,
  onAdded,
}: {
  media: AniListCatalogMedia;
  onClose: () => void;
  onAdded: () => Promise<void>;
}): React.JSX.Element {
  const [detail, setDetail] = useState<AniListMediaDetail>();
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showPlayback, setShowPlayback] = useState(false);
  const [episodeGuide, setEpisodeGuide] = useState<AnimeEpisodeGuide>();
  const [loadingGuide, setLoadingGuide] = useState(false);
  const [activeEpisode, setActiveEpisode] = useState<AnimeEpisodeGuideEpisode>();
  const [rating, setRating] = useState(0);
  const [savingTracker, setSavingTracker] = useState(false);
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

  useEffect(() => {
    if (!showPlayback) return;
    const handlePlayerMessage = (event: MessageEvent<unknown>): void => {
      if (event.origin !== "https://www.vidking.net" || !isRecord(event.data)) return;
      if (event.data.type !== "PLAYER_EVENT" || !isRecord(event.data.data)) return;
      const playerData = event.data.data;
      const progress = typeof playerData.progress === "number" ? playerData.progress : 0;
      if (playerData.event === "ended" || progress >= 90) {
        if (activeEpisode && !savingTracker) void markEpisodeWatched(activeEpisode.number);
        else if (resolved.type === "ANIME" && resolved.format === "MOVIE" && !savingTracker) {
          void markMediaCompleted();
        }
      }
    };
    window.addEventListener("message", handlePlayerMessage);
    return () => window.removeEventListener("message", handlePlayerMessage);
  }, [
    activeEpisode,
    markEpisodeWatched,
    markMediaCompleted,
    resolved,
    savingTracker,
    showPlayback,
  ]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
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
                  setActiveEpisode(episodeGuide?.episodes[0]);
                  setShowPlayback(true);
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
            <section className="playback-stage">
              <button
                type="button"
                onClick={() => {
                  setShowPlayback(false);
                  setActiveEpisode(undefined);
                }}
              >
                Close player
              </button>
              {buildVidKingUrl(resolved, activeEpisode) ? (
                <iframe
                  className="vidking-player"
                  title={`${resolved.title} player`}
                  src={buildVidKingUrl(resolved, activeEpisode)}
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div>
                  {resolved.type === "ANIME" ? <Play size={42} /> : <BookOpen size={42} />}
                  <h3>
                    {resolved.type === "ANIME"
                      ? "VidKing mapping is unavailable for this title"
                      : "MangaDex reader is the next adapter"}
                  </h3>
                  <p>
                    VidKing requires a TMDB movie or TV ID. AniStream keeps AniList as the source of
                    truth and will use VidKing only when a verified TMDB mapping is available.
                  </p>
                </div>
              )}
            </section>
          ) : null}

          {resolved.type === "ANIME" ? (
            <section className="episode-guide">
              <div className="tracker-heading">
                <div>
                  <p className="catalog-kicker">Optional episode source</p>
                  <h3>Episodes</h3>
                </div>
                <button
                  className="quiet-button"
                  type="button"
                  disabled={loadingGuide}
                  onClick={() => {
                    setLoadingGuide(true);
                    void window.anistream
                      .getAnimeEpisodeGuide(slugify(resolved.title))
                      .then(setEpisodeGuide)
                      .catch((reason: unknown) =>
                        setError(
                          reason instanceof Error ? reason.message : "Episode guide failed.",
                        ),
                      )
                      .finally(() => setLoadingGuide(false));
                  }}
                >
                  {loadingGuide
                    ? "Loading…"
                    : episodeGuide
                      ? "Refresh guide"
                      : "Load episode guide"}
                </button>
              </div>
              {episodeGuide?.message ? (
                <p className="provider-note">{episodeGuide.message}</p>
              ) : null}
              {episodeGuide?.episodes.length ? (
                <div className="episode-list">
                  {episodeGuide.episodes.map((episode) => (
                    <button
                      type="button"
                      key={episode.id}
                      className={activeEpisode?.id === episode.id ? "active" : ""}
                      onClick={() => {
                        setActiveEpisode(episode);
                        setShowPlayback(true);
                      }}
                    >
                      <span>{episode.number}</span>
                      <strong>{episode.title ?? `Episode ${episode.number}`}</strong>
                      <Play size={15} fill="currentColor" />
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
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
                  <span className="match">{resolved.averageScore}% score</span>
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

function slugify(title: string): string {
  return title
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildVidKingUrl(
  media: AniListMediaDetail | AniListCatalogMedia,
  episode?: AnimeEpisodeGuideEpisode,
): string | undefined {
  const tmdbLink =
    "externalLinks" in media
      ? media.externalLinks.find((link) => /tmdb|movie database/i.test(link.site))
      : undefined;
  if (!tmdbLink) return undefined;

  let tmdbId: string | undefined;
  try {
    const url = new URL(tmdbLink.url);
    tmdbId = [...url.pathname.split("/")].reverse().find((part) => /^\d+$/.test(part));
  } catch {
    return undefined;
  }
  if (!tmdbId) return undefined;

  const format = media.format?.toLocaleUpperCase();
  if (format === "MOVIE") {
    return `https://www.vidking.net/embed/movie/${tmdbId}?color=e50914&autoPlay=true`;
  }
  if (!episode) return undefined;
  const season = episode.season ?? 1;
  return `https://www.vidking.net/embed/tv/${tmdbId}/${season}/${episode.number}?color=e50914&autoPlay=true&nextEpisode=true&episodeSelector=true`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
