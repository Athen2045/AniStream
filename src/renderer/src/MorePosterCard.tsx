import { Clock3, Info, Play } from "lucide-react";
import type {
  MoreCatalogItem,
  MoreContinueItem,
  MoreTitleStatusAction,
} from "../../shared/contracts";
import { MoreSaveMenu } from "./MoreSaveMenu";
import { CoverImage } from "./CoverImage";
import { HoverPoster } from "./HoverPoster";
import {
  episodeLabel,
  formatDuration,
  formatRemaining,
  formatScore,
  isFinished,
  moreKey,
  progressRatio,
  releaseState,
} from "./more-format";
import { ContinueRemoveButton } from "./ContinueRemoveButton";

export interface MoreCardActions {
  onSelect: (item: MoreCatalogItem) => void;
  onPrimary: (item: MoreCatalogItem) => void;
  isSaved: (item: MoreCatalogItem) => boolean;
  isCompleted: (item: MoreCatalogItem) => boolean;
  onSetStatus: (item: MoreCatalogItem, action: MoreTitleStatusAction) => void;
}

/** A TMDB title as a shared hover poster. */
export function MorePosterCard({
  item,
  rank,
  actions,
  caption,
  onDismiss,
}: {
  item: MoreCatalogItem;
  rank?: number;
  actions: MoreCardActions;
  caption?: string;
  onDismiss?: () => void;
}): React.JSX.Element {
  return (
    <HoverPoster
      title={item.title}
      imageUrl={item.posterUrl}
      score={formatScore(item.score)}
      meta={[item.year, item.type === "MOVIE" ? "Movie" : "Series"]}
      rank={rank}
      releaseLabel={releaseState(item.releaseDate).label}
      onOpen={() => actions.onSelect(item)}
      onPrimary={() => actions.onPrimary(item)}
      saveControl={
        <MoreSaveMenu
          title={item.title}
          className="more-mini"
          iconSize={15}
          saved={actions.isSaved(item)}
          completed={actions.isCompleted(item)}
          onAction={(action) => actions.onSetStatus(item, action)}
        />
      }
      caption={caption}
      onDismiss={onDismiss}
    />
  );
}

/**
 * Continue Watching card. At rest it shows the artwork, title, and time left; on hover or focus
 * the lower half turns into a small control panel (play, list, details, watched-of-total).
 */
export function MoreContinueCard({
  entry,
  actions,
}: {
  entry: MoreContinueItem;
  actions: MoreCardActions;
}): React.JSX.Element {
  const { item } = entry;
  const finished = isFinished(entry);
  const saved = actions.isSaved(item);
  const episode =
    entry.season && entry.episode ? episodeLabel(entry.season, entry.episode) : undefined;
  const watchedMinutes = Math.max(0, Math.round(entry.positionSeconds / 60));
  const totalMinutes = Math.max(1, Math.round(entry.durationSeconds / 60));
  const resumeLabel = `${finished ? "Continue" : "Resume"} ${item.title}${episode ? ` ${episode}` : ""}`;
  return (
    <article className="more-continue">
      <button
        className="more-continue-art"
        type="button"
        aria-label={resumeLabel}
        onClick={() => actions.onPrimary(item)}
      >
        <CoverImage src={item.backdropUrl ?? item.posterUrl} title={item.title} />
        <span className="more-progress" aria-hidden="true">
          <span style={{ width: `${Math.round(progressRatio(entry) * 100)}%` }} />
        </span>
      </button>
      <ContinueRemoveButton section="MORE" id={moreKey(item)} title={item.title} />
      <div className="more-continue-body">
        <div className="more-continue-rest">
          <strong title={item.title}>{item.title}</strong>
          <span className="more-continue-meta">
            {episode ?? "Movie"}
            <span aria-hidden="true">·</span>
            {finished ? (
              "Up next"
            ) : (
              <>
                <Clock3 size={12} aria-hidden="true" />
                {formatRemaining(entry)}
              </>
            )}
          </span>
        </div>
        <div className="more-continue-panel">
          <div className="more-continue-controls">
            <button
              type="button"
              className="more-circle more-circle--play"
              aria-label={resumeLabel}
              title={finished ? "Continue" : "Resume"}
              onClick={() => actions.onPrimary(item)}
            >
              <Play size={18} fill="currentColor" />
            </button>
            <MoreSaveMenu
              title={item.title}
              className="more-circle"
              saved={saved}
              completed={actions.isCompleted(item)}
              onAction={(action) => actions.onSetStatus(item, action)}
            />
            <button
              type="button"
              className="more-circle more-circle--end"
              aria-label={`Details for ${item.title}`}
              title="Details"
              onClick={() => actions.onSelect(item)}
            >
              <Info size={18} />
            </button>
          </div>
          <p className="more-continue-label">
            <strong>{episode ?? "Movie"}</strong> {item.title}
          </p>
          <div className="more-continue-progress">
            <span className="more-continue-track" aria-hidden="true">
              <span style={{ width: `${Math.round(progressRatio(entry) * 100)}%` }} />
            </span>
            <span>
              {finished
                ? "Finished"
                : totalMinutes < 60
                  ? `${watchedMinutes} of ${totalMinutes}m`
                  : `${watchedMinutes ? formatDuration(watchedMinutes) : "0m"} of ${formatDuration(totalMinutes)}`}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
