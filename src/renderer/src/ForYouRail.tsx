import { RefreshCw, ThumbsDown } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AniListCatalogMedia, AniListMediaType } from "../../shared/contracts";
import type { RecommendationResult } from "../../shared/recommendations";
import { ContentCarousel } from "./ContentCarousel";
import { RailHoverActions } from "./RailHoverActions";
import { CoverImage } from "./CoverImage";
import type { ViewerAccess } from "./viewer-access";
import type { createDiscoverySession } from "./discovery-session";
import { friendlyRemoteError } from "./remote-error";

export function ForYouRail({
  type,
  onSelect,
  onPrimary,
  onLibrary,
  access,
  session,
}: {
  type: AniListMediaType;
  /** Owned by the page, which shares the feed with its hero. */
  session: ReturnType<typeof createDiscoverySession>;
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary?: (media: AniListCatalogMedia) => void;
  onLibrary?: (media: AniListCatalogMedia) => Promise<void>;
  access?: ViewerAccess;
}): React.JSX.Element {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const section = useRef<HTMLElement>(null);
  const [refreshSpin, setRefreshSpin] = useState(0);
  useEffect(() => {
    let visible = false;
    // Scrolling to the rail or returning to the window only fills an empty rail; the viewer's own
    // activity rebuilds a feed older than a minute.
    const show = (): void => {
      if (visible && document.visibilityState === "visible")
        void session.ensure(Number.POSITIVE_INFINITY);
    };
    const load = (): void => {
      if (visible && document.visibilityState === "visible") void session.ensure(60_000);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) show();
      },
      { rootMargin: "200px" },
    );
    if (section.current) observer.observe(section.current);
    window.addEventListener("anistream:activity-updated", load);
    document.addEventListener("visibilitychange", show);
    const unsubscribe = window.anistream.onActivityChanged(load);
    return () => {
      observer.disconnect();
      unsubscribe();
      window.removeEventListener("anistream:activity-updated", load);
      document.removeEventListener("visibilitychange", show);
    };
  }, [session]);
  const items = state.feed?.items ?? [];
  // Rows whose titles were all dismissed disappear rather than leaving an empty heading.
  const rows = (state.feed?.rows ?? []).filter((row) => row.items.length);
  const verb = type === "MANGA" ? "read" : "watched";
  const card = (item: RecommendationResult, inRow: boolean): React.JSX.Element => (
    <DiscoveryCard
      key={`${state.feed?.requestId}:${item.anilistId}`}
      item={item}
      inRow={inRow}
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
  );
  return (
    <>
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
            {items.map((item) => card(item, false))}
          </ContentCarousel>
        ) : null}
      </section>
      {rows.map((row) => {
        const heading = row.continuation
          ? type === "MANGA"
            ? "New from series you read"
            : "Next seasons of shows you watched"
          : row.theme
            ? `Because you like ${row.theme}`
            : `Because you ${verb} ${row.seedTitle}`;
        return (
          <section
            key={`${state.feed?.requestId}:row:${row.continuation ? "next" : row.theme ? `theme:${row.theme}` : row.seedId}`}
            className="media-rail for-you-preview"
            aria-label={heading}
          >
            <div className="rail-heading">
              <div>
                <h2>{heading}</h2>
              </div>
            </div>
            <ContentCarousel label={heading}>
              {row.items.map((item) => card(item, !row.theme))}
            </ContentCarousel>
          </section>
        );
      })}
    </>
  );
}

function DiscoveryCard({
  item,
  inRow,
  onPrimary,
  onLibrary,
  inLibrary,
  busy,
  onVisible,
  onOpen,
  onDismiss,
}: {
  item: RecommendationResult;
  /** Inside a "Because you watched X" row the seed is in the heading, so show another reason. */
  inRow: boolean;
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
            meta=""
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
      <span>{reasonLabel(item, inRow)}</span>
      {libraryError ? (
        <p className="card-error" role="alert">
          {libraryError}
        </p>
      ) : null}
    </article>
  );
}
function reasonLabel(item: RecommendationResult, inRow: boolean): string {
  const reason = inRow
    ? item.reasonCodes.find((code) => code !== "similar-to")
    : item.reasonCodes[0];
  if (reason === "similar-to" && item.relatedTitle)
    return `Because you ${item.mediaType === "MANGA" ? "read" : "watched"} ${item.relatedTitle}`;
  if (reason === "matches-genre") return "Genres you enjoy";
  if (reason === "matches-tag") return "Themes from your history";
  if (reason === "same-creator") return "From a creator you like";
  if (reason === "similar-to") return "Related to your history";
  if (reason === "highly-rated") return "Highly rated on AniList";
  if (reason === "explore-more") return "Something different to explore";
  return inRow ? "Recommended by AniList fans" : "Something to explore";
}
