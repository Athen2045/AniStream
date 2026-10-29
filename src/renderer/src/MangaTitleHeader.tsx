import { BookOpen, Check, Clock3, Plus } from "lucide-react";
import { useState } from "react";
import type {
  AniListCatalogMedia,
  AniListEntry,
  AniListMediaDetail,
  MalScore,
  MangaEnrichment,
} from "../../shared/contracts";
import { cachedArtworkUrl } from "../../shared/artwork";
import { CoverImage } from "./CoverImage";
import { compactVotes, RatingChips } from "./RatingChips";
import { entryStatusLabel, titleFacts, titleKicker } from "./title-facts";
import type { TitleCopy } from "./title-page-model";
import { TitleFeedback } from "./TitleFeedback";
import { MalFillCredit, RateButton } from "./TitleTracker";

/**
 * A manga title page's header (below its TitleBand banner): cover, titles and credits, Read and list actions, ratings,
 * summary and facts. (Anime titles use AnimeTitleHeader.)
 */
export function MangaTitleHeader({
  media,
  detail,
  siteUrl,
  loading,
  copy,
  malScore,
  enrichment,
  primary,
  library,
  rating,
}: {
  media: AniListCatalogMedia;
  detail?: AniListMediaDetail;
  /** The AniList page the AniList score links to. */
  siteUrl: string;
  loading: boolean;
  copy: TitleCopy;
  malScore?: MalScore;
  enrichment?: MangaEnrichment;
  /** Read / Continue; absent when nothing here can be read. */
  primary?: { label: string; blockedLabel?: string; onPress: () => void };
  /** Add to list / the list entry; absent when the viewer has no AniList library. */
  library?: { entry?: AniListEntry; adding: boolean; onManage: () => void };
  /** The Rate toggle and its open panel; absent for guests and until details load. */
  rating?: { open: boolean; rated: boolean; onToggle: () => void; panel: React.ReactNode };
}): React.JSX.Element {
  const [synopsisOpen, setSynopsisOpen] = useState(false);
  const { description, genres } = copy;
  return (
    <section className="title-main">
      <div className="title-cover title-cover--book">
        <CoverImage src={cachedArtworkUrl(media.coverUrl)} title={media.title} />
      </div>
      <div className="title-info">
        <p className="title-kicker">
          {titleKicker(media, detail).map((part) => (
            <span key={part}>{part}</span>
          ))}
        </p>
        <h1>{media.title}</h1>
        {copy.altTitles.length ? <p className="title-alt">{copy.altTitles.join(" · ")}</p> : null}
        {copy.credits.length ? (
          <p className="title-byline">
            By <strong>{copy.credits.join(", ")}</strong>
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
          {primary ? (
            <button
              className={`title-primary${primary.blockedLabel ? " is-upcoming" : ""}`}
              type="button"
              disabled={Boolean(primary.blockedLabel)}
              onClick={primary.onPress}
            >
              {primary.blockedLabel ? <Clock3 size={18} /> : <BookOpen size={18} />}
              {primary.blockedLabel ?? primary.label}
            </button>
          ) : null}
          {library ? (
            <button
              className="title-library"
              type="button"
              disabled={library.adding}
              aria-label={library.entry ? "Edit library entry" : "Add to AniList planning"}
              title={library.entry ? "Edit library entry" : "Add to Planning"}
              onClick={library.onManage}
            >
              {library.entry ? <Check size={16} /> : <Plus size={17} />}
              {library.entry
                ? `${entryStatusLabel(library.entry.status, false)} · ${library.entry.progress}${
                    media.totalProgress ? `/${media.totalProgress}` : ""
                  }`
                : "Add to list"}
            </button>
          ) : null}
          {rating ? (
            <RateButton open={rating.open} rated={rating.rated} onToggle={rating.onToggle} />
          ) : null}
          <TitleFeedback
            title={media.title}
            target={{ type: media.type, id: media.id }}
            className="title-round"
          />
        </div>
        {rating?.open ? rating.panel : null}
        <RatingChips
          chips={[
            media.averageScore
              ? {
                  source: "anilist",
                  score: `${media.averageScore}%`,
                  detail: "AniList",
                  href: siteUrl,
                  title: `${media.averageScore}% on AniList`,
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
            enrichment?.status === "available" && enrichment.mangaUpdatesRating !== undefined
              ? {
                  source: "mangaupdates",
                  score: enrichment.mangaUpdatesRating.toFixed(2),
                  detail: "MangaUpdates",
                  title: `${enrichment.mangaUpdatesRating.toFixed(2)}/10 on MangaUpdates`,
                }
              : undefined,
          ]}
        />
        {/* No MangaDex score or follows row: the chips above carry the ratings, and MangaDex is
              credited under the chapters (user decision 2026-10-28). */}
        {loading && !copy.aniListSummary && !copy.malSummary ? (
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
        {copy.malFilled.length && malScore ? (
          <MalFillCredit parts={copy.malFilled} url={malScore.malUrl} />
        ) : null}
      </div>
      {detail ? (
        <dl className="title-facts">
          {titleFacts(detail, enrichment).map(([label, value]) => (
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
  );
}

/** AniList banners are a fixed 1900×400; the band keeps that exact ratio and never crops it taller. */
export function TitleBand({ media }: { media: AniListCatalogMedia }): React.JSX.Element {
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
