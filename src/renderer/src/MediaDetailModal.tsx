import { BookOpen, Check, ExternalLink, Play, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
} from "../../shared/contracts";

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
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void window.anistream
      .getAniListMediaDetail(media.id, media.type)
      .then((result) => {
        if (active) setDetail(result);
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

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const resolved = detail ?? media;

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
            backgroundImage: `linear-gradient(0deg, #181818 0%, transparent 55%), linear-gradient(90deg, rgba(0,0,0,.76), transparent 65%), url("${resolved.bannerUrl ?? resolved.coverUrl}")`,
          }}
        >
          <div>
            <p className="catalog-kicker">{resolved.type === "ANIME" ? "Anime" : "Manga"}</p>
            <h2>{resolved.title}</h2>
            <div className="detail-actions">
              <button className="play-action" type="button" onClick={() => setShowPlayback(true)}>
                {resolved.type === "ANIME" ? <Play size={18} fill="currentColor" /> : <BookOpen size={18} />}
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
              <button type="button" onClick={() => setShowPlayback(false)}>Close player</button>
              <div>
                {resolved.type === "ANIME" ? <Play size={42} /> : <BookOpen size={42} />}
                <h3>{resolved.type === "ANIME" ? "Video sources are not connected yet" : "MangaDex reader is the next adapter"}</h3>
                <p>
                  The native title → season/episode → hoster → variant contracts are installed.
                  No scraped host or MangaDex chapter endpoint is silently hardcoded into this build.
                </p>
              </div>
            </section>
          ) : null}

          <div className="detail-overview">
            <div>
              <div className="detail-facts">
                {resolved.averageScore ? <span className="match">{resolved.averageScore}% score</span> : null}
                {resolved.seasonYear ? <span>{resolved.seasonYear}</span> : null}
                <span>{formatLabel(resolved.format)}</span>
                {resolved.totalProgress ? (
                  <span>{resolved.totalProgress} {resolved.type === "ANIME" ? "episodes" : "chapters"}</span>
                ) : null}
              </div>
              <p className="detail-description">{cleanDescription(resolved.description)}</p>
            </div>
            {detail ? (
              <dl>
                <div><dt>Studios</dt><dd>{detail.studios.join(", ") || "—"}</dd></div>
                <div><dt>Genres</dt><dd>{detail.genres.join(", ") || "—"}</dd></div>
                <div><dt>Source</dt><dd>{formatLabel(detail.source)}</dd></div>
                <div><dt>Status</dt><dd>{formatLabel(detail.status)}</dd></div>
                {detail.duration ? <div><dt>Runtime</dt><dd>{detail.duration} min</dd></div> : null}
              </dl>
            ) : null}
          </div>

          {detail?.characters.length ? (
            <DetailPeople title="Cast" people={detail.characters} />
          ) : null}
          {detail?.staff.length ? (
            <DetailPeople title="Staff" people={detail.staff} />
          ) : null}

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
                  <a key={`${link.site}-${link.url}`} href={link.url} target="_blank" rel="noreferrer">
                    {link.site}<ExternalLink size={13} />
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
  return value.replace(/<[^>]+>/g, " ").replace(/~!|!~/g, "").replace(/\s+/g, " ").trim();
}
