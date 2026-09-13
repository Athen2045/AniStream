import { RefreshCw, Sparkles, ThumbsDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import type { RecommendationResult } from "../../shared/recommendations";
import { ContentCarousel } from "./ContentCarousel";
import { motionTransition } from "./motion";
import { friendlyRemoteError } from "./remote-error";
import { useAppReducedMotion } from "./useAppReducedMotion";

export function ForYouPreview(): React.JSX.Element | null {
  const reducedMotion = useAppReducedMotion();
  const [items, setItems] = useState<RecommendationResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [activeId, setActiveId] = useState<number>();
  const [refreshSpin, setRefreshSpin] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      setItems(await window.anistream.getForYouPreview());
    } catch (reason) {
      setError(
        friendlyRemoteError(reason, {
          provider: "AniList",
          operation: "recommendations",
          fallback: "For You recommendations could not be refreshed. Try again shortly.",
        }),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
    const refresh = (): void => void load();
    window.addEventListener("anistream:recommendation-updated", refresh);
    return () => window.removeEventListener("anistream:recommendation-updated", refresh);
  }, [load]);

  async function explore(item: RecommendationResult): Promise<void> {
    setActiveId(item.anilistId);
    await window.anistream.recordRecommendationInteraction({
      anilistId: item.anilistId,
      mediaType: item.mediaType,
      occurredAt: currentTimestamp(),
      eventType: "explored",
      source: "detail",
    });
  }

  async function dismiss(item: RecommendationResult): Promise<void> {
    await window.anistream.recordRecommendationInteraction({
      anilistId: item.anilistId,
      mediaType: item.mediaType,
      occurredAt: currentTimestamp(),
      eventType: "dismissed",
      source: "detail",
    });
    await load();
  }

  // The field stays completely absent until the local history gate is satisfied.
  if (loading || !items.length) return null;

  return (
    <AnimatePresence initial={false}>
      <motion.section
        className="media-rail for-you-preview"
        aria-label="For You recommendations"
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
        transition={motionTransition(Boolean(reducedMotion), "entrance")}
      >
        <div className="rail-heading">
          <div>
            <p className="catalog-kicker for-you-eyebrow">
              <Sparkles size={13} aria-hidden="true" /> Based on your watch/read history
            </p>
            <h2>For You</h2>
          </div>
          <button
            className="for-you-refresh"
            type="button"
            onClick={() => {
              setRefreshSpin((spin) => spin + 1);
              void load();
            }}
            disabled={loading}
          >
            <RefreshCw
              key={refreshSpin}
              size={15}
              className={refreshSpin ? "refresh-spin-once" : undefined}
              aria-hidden="true"
            />
            Refresh
          </button>
        </div>
        {error ? <p className="latest-updates-error">{error}</p> : null}
        <ContentCarousel label="For You">
          {items.map((item, index) => (
            <motion.article
              className={`rail-card for-you-card${activeId === item.anilistId ? " is-active" : ""}`}
              key={item.anilistId}
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                ...motionTransition(Boolean(reducedMotion), "fast"),
                delay: reducedMotion ? 0 : index * 0.035,
              }}
              whileHover={reducedMotion ? undefined : { y: -3 }}
              whileTap={reducedMotion ? undefined : { scale: 0.985 }}
            >
              <span className="rail-art">
                <button
                  type="button"
                  className="rail-art-hit"
                  aria-label={`Explore ${item.title}`}
                  onClick={() => void explore(item)}
                />
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="rail-art-fallback">{item.title.slice(0, 1)}</span>
                )}
                <span className="rail-badge">{item.mediaType === "ANIME" ? "Anime" : "Manga"}</span>
                <button
                  className="for-you-dismiss"
                  type="button"
                  aria-label={`Not interested in ${item.title}`}
                  onClick={() => void dismiss(item)}
                >
                  <ThumbsDown size={13} aria-hidden="true" />
                </button>
              </span>
              <strong title={item.title}>{item.title}</strong>
              <span>{reasonLabel(item)}</span>
            </motion.article>
          ))}
        </ContentCarousel>
      </motion.section>
    </AnimatePresence>
  );
}

function reasonLabel(item: RecommendationResult): string {
  const reason = item.reasonCodes[0];
  if (reason === "matches-tag") return "Matches your tags";
  if (reason === "same-creator") return "From a creator you like";
  if (reason === "similar-to") return "Similar to your history";
  return `${Math.round(item.score)}% match`;
}

function currentTimestamp(): number {
  return Date.now();
}
