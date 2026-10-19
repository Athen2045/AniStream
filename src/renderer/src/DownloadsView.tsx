import {
  Clock3,
  Download,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cachedArtworkUrl } from "../../shared/artwork";
import type { AniListCatalogMedia, AnimeEpisodeArt } from "../../shared/contracts";
import { formatBytes, type AnimeDownload, type DownloadQuality } from "../../shared/downloads";
import { CoverImage } from "./CoverImage";
import { useDownloads } from "./DownloadsProvider";

/**
 * Downloads (redesign 2026-10-18): one storage card (used of the limit, what is still coming,
 * free space on the drive), the episode downloading now with its speed and time left, then what
 * is waiting, and what is on this device by show. Limit, quality and folder are in Settings ›
 * Playback ("Download settings" opens it).
 */
export function DownloadsView({
  onPlay,
  onOpenSettings,
}: {
  onPlay: (media: AniListCatalogMedia, episode: number) => void;
  /** Limit, quality and folder live in Settings › Playback. */
  onOpenSettings?: () => void;
}): React.JSX.Element {
  const { state, notice, dismissNotice, speeds: speed } = useDownloads();
  const items = state?.items ?? [];
  const active = items.filter((item) => item.status === "downloading");
  const pending = items.filter((item) => ["queued", "paused", "failed"].includes(item.status));
  const done = groupByTitle(items.filter((item) => item.status === "done"));
  const art = useEpisodeTitles(items);

  return (
    <section className="downloads-page" aria-labelledby="downloads-heading">
      <header className="downloads-header">
        <div>
          <h1 id="downloads-heading">Downloads</h1>
          <p>Episodes saved on this device to watch offline.</p>
        </div>
        {onOpenSettings ? (
          <button type="button" className="downloads-settings-button" onClick={onOpenSettings}>
            <Settings2 size={16} aria-hidden="true" />
            Download settings
          </button>
        ) : null}
      </header>

      {notice ? (
        <p className="upnext-error" role="alert">
          {notice}
          <button type="button" aria-label="Dismiss" onClick={dismissNotice}>
            <X size={14} aria-hidden="true" />
          </button>
        </p>
      ) : null}

      {state ? (
        <StorageCard
          items={items}
          used={state.usedBytes}
          limit={state.settings.limitBytes}
          free={state.freeBytes}
          quality={state.settings.quality}
          folder={state.settings.folder}
        />
      ) : (
        <p className="upnext-empty">Loading downloads…</p>
      )}

      {active.length || pending.length ? (
        <section className="downloads-queue" aria-label="Downloading">
          <h2>Downloading</h2>
          {active.map((item) => (
            <ActiveJob key={item.id} item={item} art={art} bytesPerSecond={speed.get(item.id)} />
          ))}
          {pending.length ? (
            <ol className="downloads-waiting">
              {pending.map((item) => (
                <WaitingRow key={item.id} item={item} art={art} />
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      {state && !items.length ? (
        <div className="upnext-empty">
          <Download size={28} aria-hidden="true" />
          <strong>No downloads yet</strong>
          <span>
            Use <em>Download</em> on an anime page, or the download button beside an episode.
          </span>
        </div>
      ) : null}

      {done.length ? (
        <section className="downloads-done" aria-label="On this device">
          <h2>On this device</h2>
          {done.map((group) => (
            <article className="downloads-show" key={group.aniListId}>
              <CoverImage
                src={cachedArtworkUrl(group.coverUrl)}
                title={group.title}
                className="downloads-cover"
              />
              <div>
                <header>
                  <h3>{group.title}</h3>
                  <span>
                    {group.items.length} {group.items.length === 1 ? "episode" : "episodes"} ·{" "}
                    {formatBytes(group.items.reduce((sum, item) => sum + item.bytesDone, 0))}
                  </span>
                </header>
                <ol>
                  {group.items.map((item) => (
                    <DoneRow key={item.id} item={item} art={art} onPlay={onPlay} />
                  ))}
                </ol>
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </section>
  );
}

function StorageCard({
  items,
  used,
  limit,
  free,
  quality,
  folder,
}: {
  items: AnimeDownload[];
  used: number;
  limit: number;
  free?: number;
  quality: DownloadQuality;
  folder: string;
}): React.JSX.Element {
  // Still to come: what the unfinished downloads expect beyond what they already have.
  const coming = items
    .filter((item) => item.status !== "done")
    .reduce((sum, item) => sum + Math.max(0, item.bytesExpected - item.bytesDone), 0);
  const usedShare = Math.min(1, used / limit);
  const comingShare = Math.min(1 - usedShare, coming / limit);
  const room = Math.max(0, limit - used - coming);
  return (
    <section className="downloads-storage" aria-label="Storage">
      <div className="downloads-storage-head">
        <strong>{formatBytes(used)}</strong>
        <span>of your {formatBytes(limit)} limit</span>
        {free !== undefined ? (
          <span className="downloads-free">{formatBytes(free)} free on this drive</span>
        ) : null}
      </div>
      <div
        className={`downloads-meter${usedShare >= 0.9 ? " is-full" : ""}`}
        role="meter"
        aria-label="Download storage used"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
      >
        <span className="downloads-meter-used" style={{ width: `${usedShare * 100}%` }} />
        <span className="downloads-meter-coming" style={{ width: `${comingShare * 100}%` }} />
      </div>
      <div className="downloads-legend">
        <span>
          <i className="is-used" aria-hidden="true" />
          Downloaded {formatBytes(used)}
        </span>
        {coming > 0 ? (
          <span>
            <i className="is-coming" aria-hidden="true" />
            Still to come {formatBytes(coming)}
          </span>
        ) : null}
        <span>
          <i aria-hidden="true" />
          Room within the limit {formatBytes(room)}
        </span>
        <span className="downloads-where" title={folder}>
          {quality}
          <FolderOpen size={14} aria-hidden="true" />
          <span>{shortFolder(folder)}</span>
        </span>
      </div>
    </section>
  );
}

/** Limit, quality and folder, behind one button so the page stays about the downloads. */
function ActiveJob({
  item,
  art,
  bytesPerSecond,
}: {
  item: AnimeDownload;
  art: EpisodeTitles;
  bytesPerSecond?: number;
}): React.JSX.Element {
  const { apply } = useDownloads();
  const progress = item.bytesExpected ? Math.min(1, item.bytesDone / item.bytesExpected) : 0;
  const episode = art.get(key(item.aniListId, item.episode));
  const secondsLeft =
    bytesPerSecond && bytesPerSecond > 0
      ? Math.max(0, item.bytesExpected - item.bytesDone) / bytesPerSecond
      : undefined;
  return (
    <article className="downloads-job">
      <CoverImage
        src={episode?.stillUrl ?? cachedArtworkUrl(item.coverUrl)}
        title={item.title}
        className="downloads-job-art"
      />
      <div className="downloads-job-text">
        <strong>{episode?.title?.trim() || `Episode ${item.episode}`}</strong>
        <span>
          {item.title} · Episode {item.episode}
        </span>
        <span
          className="downloads-progress"
          role="progressbar"
          aria-label={`Episode ${item.episode} download`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span style={{ transform: `scaleX(${progress})` }} />
        </span>
        <span className="downloads-job-stats">
          <b>{formatBytes(item.bytesDone)}</b> of {formatBytes(item.bytesExpected)}
          {bytesPerSecond ? <span>{formatBytes(bytesPerSecond)}/s</span> : null}
          <span>
            {secondsLeft !== undefined ? timeLeft(secondsLeft) : "Working out the time left"}
          </span>
        </span>
      </div>
      <div className="downloads-job-actions">
        <button
          type="button"
          aria-label={`Pause episode ${item.episode}`}
          title="Pause"
          onClick={() => void apply({ op: "pause", id: item.id })}
        >
          <Pause size={14} fill="currentColor" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Cancel episode ${item.episode}`}
          title="Cancel and remove"
          onClick={() => void apply({ op: "remove", id: item.id })}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function WaitingRow({ item, art }: { item: AnimeDownload; art: EpisodeTitles }): React.JSX.Element {
  const { apply } = useDownloads();
  const episode = art.get(key(item.aniListId, item.episode));
  const percent = item.bytesExpected
    ? Math.round(Math.min(1, item.bytesDone / item.bytesExpected) * 100)
    : 0;
  const status =
    item.status === "queued"
      ? "Waiting"
      : item.status === "paused"
        ? `Paused at ${percent}%`
        : (item.error ?? "Couldn’t finish");
  return (
    <li className={`downloads-wait is-${item.status}`}>
      <span className="downloads-wait-icon" aria-hidden="true">
        {item.status === "queued" ? (
          <Clock3 size={14} />
        ) : item.status === "paused" ? (
          <Pause size={12} fill="currentColor" />
        ) : (
          <RotateCcw size={14} />
        )}
      </span>
      <span className="downloads-wait-name">
        {episode?.title?.trim() || `Episode ${item.episode}`}
        <span>
          {" "}
          · {item.title} · Episode {item.episode}
        </span>
      </span>
      <span className="downloads-wait-status">{status}</span>
      {item.status === "queued" ? null : (
        <button
          type="button"
          title={item.status === "failed" ? "Try again" : "Continue"}
          aria-label={`${item.status === "failed" ? "Retry" : "Continue"} episode ${item.episode}`}
          onClick={() =>
            void apply({ op: item.status === "failed" ? "retry" : "resume", id: item.id })
          }
        >
          {item.status === "failed" ? (
            <RotateCcw size={14} aria-hidden="true" />
          ) : (
            <Play size={13} fill="currentColor" aria-hidden="true" />
          )}
        </button>
      )}
      <button
        type="button"
        title="Remove"
        aria-label={`Remove episode ${item.episode}`}
        onClick={() => void apply({ op: "remove", id: item.id })}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

function DoneRow({
  item,
  art,
  onPlay,
}: {
  item: AnimeDownload;
  art: EpisodeTitles;
  onPlay: (media: AniListCatalogMedia, episode: number) => void;
}): React.JSX.Element {
  const { apply } = useDownloads();
  const [confirming, setConfirming] = useState(false);
  const episode = art.get(key(item.aniListId, item.episode));
  const media: AniListCatalogMedia = {
    id: item.aniListId,
    type: "ANIME",
    title: item.title,
    coverUrl: item.coverUrl ?? "",
    genres: [],
    siteUrl: `https://anilist.co/anime/${item.aniListId}`,
  };
  return (
    <li className="downloads-ep">
      <button
        type="button"
        className="downloads-ep-play"
        aria-label={`Play episode ${item.episode}`}
        onClick={() => onPlay(media, item.episode)}
      >
        <Play size={12} fill="currentColor" aria-hidden="true" />
      </button>
      <span className="downloads-ep-name">
        {episode?.title?.trim() || `Episode ${item.episode}`}
        <span>
          {" "}
          · Episode {item.episode} · {item.quality}
          {item.audio.length ? ` · ${item.audio.map((code) => code.toUpperCase()).join(" ")}` : ""}
        </span>
      </span>
      <span className="downloads-ep-size">{formatBytes(item.bytesDone)}</span>
      {confirming ? (
        <span className="downloads-ep-confirm">
          <button
            type="button"
            className="is-danger"
            onClick={() => void apply({ op: "remove", id: item.id })}
          >
            Delete files
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="downloads-ep-remove"
          aria-label={`Remove episode ${item.episode} download`}
          title="Remove download"
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

type EpisodeTitles = ReadonlyMap<string, AnimeEpisodeArt>;
const key = (aniListId: number, episode: number): string => `${aniListId}:${episode}`;

/** Episode names and stills for every title in the list (saved with the title, so offline too). */
function useEpisodeTitles(items: AnimeDownload[]): EpisodeTitles {
  const [titles, setTitles] = useState<EpisodeTitles>(() => new Map());
  const wanted = new Map<number, number[]>();
  for (const item of items)
    wanted.set(item.aniListId, [...(wanted.get(item.aniListId) ?? []), item.episode]);
  const signature = [...wanted.entries()]
    .map(([id, episodes]) => `${id}:${Math.max(...episodes)}`)
    .sort()
    .join(",");
  useEffect(() => {
    if (!signature) return;
    let active = true;
    void Promise.all(
      signature.split(",").map(async (part) => {
        const [id, last] = part.split(":").map(Number);
        const rows = await window.anistream
          .getAnimeEpisodeArt({ aniListId: id, episodes: last, focus: 1 })
          .catch(() => []);
        return rows.map((row) => [key(id, row.number), row] as const);
      }),
    ).then((groups) => {
      if (active) setTitles(new Map(groups.flat()));
    });
    return () => {
      active = false;
    };
  }, [signature]);
  return titles;
}

function timeLeft(seconds: number): string {
  if (seconds < 60) return "Less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `About ${minutes} min left`;
  return `About ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

/** The last two folders of a path: "AniStream\Downloads". */
function shortFolder(folder: string): string {
  const parts = folder.split(/[\\/]/).filter(Boolean);
  return parts.slice(-3).join("\\");
}

interface TitleGroup {
  aniListId: number;
  title: string;
  coverUrl?: string;
  items: AnimeDownload[];
}

function groupByTitle(items: AnimeDownload[]): TitleGroup[] {
  const groups = new Map<number, TitleGroup>();
  for (const item of items) {
    const group = groups.get(item.aniListId) ?? {
      aniListId: item.aniListId,
      title: item.title,
      ...(item.coverUrl ? { coverUrl: item.coverUrl } : {}),
      items: [],
    };
    group.items.push(item);
    groups.set(item.aniListId, group);
  }
  for (const group of groups.values()) group.items.sort((a, b) => a.episode - b.episode);
  return [...groups.values()];
}
