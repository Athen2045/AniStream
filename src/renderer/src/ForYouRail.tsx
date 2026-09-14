import { RefreshCw, ThumbsDown } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AniListCatalogMedia, AniListMediaType } from "../../shared/contracts";
import type { RecommendationResult } from "../../shared/recommendations";
import { ContentCarousel } from "./ContentCarousel";
import { RailHoverActions } from "./RailHoverActions";
import { CoverImage } from "./CoverImage";
import type { ViewerAccess } from "./viewer-access";
import { createDiscoverySession } from "./discovery-session";
import { friendlyRemoteError } from "./remote-error";

export function ForYouRail({
  type,
  onSelect,
  onPrimary,
  onLibrary,
  access,
}: {
  type: AniListMediaType;
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary?: (media: AniListCatalogMedia) => void;
  onLibrary?: (media: AniListCatalogMedia) => Promise<void>;
  access?: ViewerAccess;
}): React.JSX.Element {
  const [session] = useState(() => createDiscoverySession(type));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const section = useRef<HTMLElement>(null);
  const [refreshSpin, setRefreshSpin] = useState(0);
  useEffect(() => {
    session.activate();
    let visible = false;
    let lastLoad = 0;
    const load = (): void => {
      if (visible && document.visibilityState === "visible" && Date.now() - lastLoad >= 60_000) {
        lastLoad = Date.now();
        void session.load();
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) load();
      },
      { rootMargin: "200px" },
    );
    if (section.current) observer.observe(section.current);
    window.addEventListener("anistream:activity-updated", load);
    document.addEventListener("visibilitychange", load);
    const unsubscribe = window.anistream.onActivityChanged(load);
    return () => {
      observer.disconnect();
      unsubscribe();
      window.removeEventListener("anistream:activity-updated", load);
      document.removeEventListener("visibilitychange", load);
      session.dispose();
    };
  }, [session]);
  const items = state.feed?.items ?? [];
  return (
    <section
      ref={section}
      className="media-rail for-you-preview"
      aria-label="For You recommendations"
    >
      <div className="rail-heading">
        <div>
          <h2>For You</h2>
        </div>
        <button
          className="for-you-refresh"
          type="button"
          disabled={state.loading || state.busy}
          onClick={() => {
            setRefreshSpin((spin) => spin + 1);
            void session.load();
          }}
        >
          <RefreshCw
            key={refreshSpin}
            size={15}
            className={refreshSpin ? "refresh-spin-once" : undefined}
            aria-hidden="true"
          />
          {state.loading ? (state.feed ? "Refreshing…" : "Loading…") : "Refresh"}
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="latest-updates-error">
          {state.error}
        </p>
      ) : null}
      {state.feed?.message && !state.error ? (
        <p className="personal-inbox-empty" role="status">
          {state.feed.message}
        </p>
      ) : null}
      {state.feed?.status === "ready" && !items.length && !state.error ? (
        <p className="personal-inbox-empty">
          No new matches in this check. Your library and Not interested choices are excluded.
        </p>
      ) : null}
      {state.undo ? (
        <p className="personal-sync" role="status">
          Title hidden from For You.{" "}
          <button type="button" disabled={state.busy} onClick={() => void session.undo()}>
            Undo
          </button>
        </p>
      ) : null}
      {items.length ? (
        <ContentCarousel label="For You">
          {items.map((item) => (
            <DiscoveryCard
              key={`${state.feed?.requestId}:${item.anilistId}`}
              item={item}
              onPrimary={onPrimary}
              onLibrary={onLibrary}
              inLibrary={access?.kind === "member" && access.libraryEntries.has(item.anilistId)}
              busy={state.busy}
              onVisible={() => void session.visible(item)}
              onDismiss={() => void session.dismiss(item)}
              onOpen={() => {
                void session.explore(item);
                onSelect({
                  id: item.anilistId,
                  type: item.mediaType,
                  title: item.title,
                  coverUrl: item.coverUrl ?? "",
                  genres: [],
                  malId: item.malId,
                  siteUrl: `https://anilist.co/${item.mediaType === "ANIME" ? "anime" : "manga"}/${item.anilistId}`,
                });
              }}
            />
          ))}
        </ContentCarousel>
      ) : null}
    </section>
  );
}

function DiscoveryCard({
  item,
  onPrimary,
  onLibrary,
  inLibrary,
  busy,
  onVisible,
  onOpen,
  onDismiss,
}: {
  item: RecommendationResult;
  onPrimary?: (media: AniListCatalogMedia) => void;
  onLibrary?: (media: AniListCatalogMedia) => Promise<void>;
  inLibrary?: boolean;
  busy: boolean;
  onVisible: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}): React.JSX.Element {
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState<string>();
  const media: AniListCatalogMedia = {
    id: item.anilistId,
    type: item.mediaType,
    title: item.title,
    coverUrl: item.coverUrl ?? "",
    genres: [],
    siteUrl: `https://anilist.co/${item.mediaType === "ANIME" ? "anime" : "manga"}/${item.anilistId}`,
  };
  const card = useRef<HTMLElement>(null);
  const callback = useRef(onVisible);
  useEffect(() => {
    callback.current = onVisible;
  }, [onVisible]);
  useEffect(() => {
    let visible = false;
    let recorded = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (): void => {
      clearTimeout(timer);
      if (!recorded && visible && document.visibilityState === "visible")
        timer = setTimeout(() => {
          recorded = true;
          callback.current();
        }, 500);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.6);
        schedule();
      },
      { threshold: 0.6 },
    );
    if (card.current) observer.observe(card.current);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", schedule);
    };
  }, []);
  return (
    <article ref={card} className="rail-card for-you-card">
      <span className="rail-art">
        <button
          className="rail-art-hit"
          type="button"
          aria-label={`Details for ${item.title}`}
          onClick={onOpen}
        />
        <CoverImage src={item.coverUrl} title={item.title} />
        {onPrimary ? (
          <RailHoverActions
            title={item.title}
            primaryLabel={item.mediaType === "ANIME" ? "Watch" : "Read"}
            onPlay={() => onPrimary(media)}
            onInfo={onOpen}
            library={
              onLibrary
                ? {
                    inLibrary: Boolean(inLibrary),
                    busy: libraryBusy,
                    onManage: () => {
                      setLibraryBusy(true);
                      setLibraryError(undefined);
                      void onLibrary(media)
                        .catch((reason: unknown) =>
                          setLibraryError(
                            friendlyRemoteError(reason, {
                              provider: "AniList",
                              operation: "library changes",
                              fallback: "Your library could not be updated. Try again.",
                            }),
                          ),
                        )
                        .finally(() => setLibraryBusy(false));
                    },
                  }
                : undefined
            }
          />
        ) : null}
        <span className="rail-badge">{item.mediaType === "ANIME" ? "Anime" : "Manga"}</span>
        <button
          className="for-you-dismiss"
          type="button"
          aria-label={`Not interested in ${item.title}`}
          disabled={busy}
          onClick={onDismiss}
        >
          <ThumbsDown size={13} aria-hidden="true" />
        </button>
      </span>
      <button className="card-title-button" type="button" onClick={onOpen} title={item.title}>
        {item.title}
      </button>
      <span>{reasonLabel(item)}</span>
      {libraryError ? (
        <p className="card-error" role="alert">
          {libraryError}
        </p>
      ) : null}
    </article>
  );
}
function reasonLabel(item: RecommendationResult): string {
  const reason = item.reasonCodes[0];
  if (reason === "matches-genre") return "Genres you enjoy";
  if (reason === "matches-tag") return "Themes from your history";
  if (reason === "same-creator") return "From a creator you like";
  if (reason === "similar-to") return "Related to your history";
  if (reason === "highly-rated") return "Highly rated on AniList";
  return "Something to explore";
}
