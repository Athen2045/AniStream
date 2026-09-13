import { BookOpen, Pencil, Play } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import type { AniListEntry, AniListMedia, UpdateAniListEntryInput } from "../../shared/contracts";
import { isProgressComplete } from "../../shared/progress";
import { formatMediaLabel } from "./format-label";
import { motionTransition } from "./motion";
import { CoverImage } from "./CoverImage";
import { friendlyRemoteError } from "./remote-error";
export function LibraryCard({
  entry,
  reducedMotion,
  onSave,
  onEdit,
  onOpenMedia,
}: {
  entry: AniListEntry;
  reducedMotion: boolean;
  onSave: (input: UpdateAniListEntryInput) => Promise<void>;
  onEdit: (entry: AniListEntry) => void;
  onOpenMedia: (media: AniListMedia, action: "details" | "play" | "read") => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const progressLabel = entry.media.type === "ANIME" ? "ep" : "ch";
  const totalProgress = entry.media.totalProgress;
  const progressRatio = totalProgress ? Math.min(1, entry.progress / totalProgress) : 0;
  return (
    <motion.article
      className="media-card"
      whileHover={
        reducedMotion ? undefined : { y: -3, transition: motionTransition(reducedMotion, "fast") }
      }
      transition={motionTransition(reducedMotion, "fast")}
    >
      <div className="cover-wrap">
        <button
          className="media-card-cover-action"
          type="button"
          aria-label={`Details for ${entry.media.title}`}
          onClick={() => onOpenMedia(entry.media, "details")}
        >
          <CoverImage src={entry.media.coverUrl} title={entry.media.title} />
        </button>
        <button
          className="media-card-edit"
          type="button"
          disabled={saving}
          aria-label={`Edit ${entry.media.title}`}
          title="Edit entry"
          onClick={() => onEdit(entry)}
        >
          <Pencil size={18} aria-hidden="true" />
        </button>
        {!isProgressComplete(entry.status, entry.progress, entry.media.totalProgress) ? (
          <button
            className="progress-button"
            type="button"
            aria-label={`Increase progress for ${entry.media.title}`}
            disabled={saving}
            onClick={() => {
              const next = Math.min(
                entry.media.totalProgress ?? Number.MAX_SAFE_INTEGER,
                entry.progress + 1,
              );
              setSaving(true);
              void onSave({ id: entry.id, progress: next })
                .catch((reason: unknown) =>
                  setError(
                    friendlyRemoteError(reason, {
                      provider: "AniList",
                      operation: "library changes",
                      fallback: "Progress could not be saved. Your previous value is unchanged.",
                    }),
                  ),
                )
                .finally(() => setSaving(false));
            }}
          >
            +1
          </button>
        ) : null}
        <button
          className="media-card-primary"
          type="button"
          aria-label={`${entry.media.type === "ANIME" ? "Watch" : "Read"} ${entry.media.title}`}
          onClick={() => onOpenMedia(entry.media, entry.media.type === "ANIME" ? "play" : "read")}
        >
          {entry.media.type === "ANIME" ? (
            <Play size={14} aria-hidden="true" />
          ) : (
            <BookOpen size={14} aria-hidden="true" />
          )}
          {entry.media.type === "ANIME" ? "Watch" : "Read"}
        </button>
      </div>
      <div className="media-card-body">
        <div className="media-card-topline">
          <p className="media-meta">{formatMediaLabel(entry.media.format)}</p>
          <span>{entry.score ? `${entry.score}/10` : "Not rated"}</span>
        </div>
        <h3 title={entry.media.title}>
          <button
            className="media-card-title-action"
            type="button"
            onClick={() => onOpenMedia(entry.media, "details")}
          >
            {entry.media.title}
          </button>
        </h3>
        <div className="media-card-footer">
          <span>
            {entry.status
              .toLowerCase()
              .replace("current", entry.media.type === "ANIME" ? "Watching" : "Reading")}
          </span>
          <span>
            {entry.progress}
            {entry.media.totalProgress ? ` / ${entry.media.totalProgress}` : ""} {progressLabel}
          </span>
        </div>
        {totalProgress ? (
          <div className="media-card-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${progressRatio})` }} />
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="card-error" role="alert">
          {error}
        </p>
      ) : null}
    </motion.article>
  );
}
