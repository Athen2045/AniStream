import { AnimatePresence, motion } from "framer-motion";
import { Check, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import type { AniListAuthState, SimklStatus } from "../../shared/contracts";
import { motionTransition } from "./motion";
import { useAppReducedMotion } from "./useAppReducedMotion";
import appIcon from "./assets/app-icon.png";
import { SourceLogo } from "./SourceLogo";

const WALL_COLUMNS = 7;
const WALL_ROWS = 5;

// Covers are fetched once per app run; returning to the page reuses them.
let wallCache: string[] | undefined;

/**
 * Trending anime, manga and movie posters, interleaved so each column mixes all three sections.
 * Empty until loaded, and stays empty when every source fails (the page still works).
 */
function usePosterWall(): string[] {
  const [urls, setUrls] = useState<string[]>(() => wallCache ?? []);
  useEffect(() => {
    if (wallCache) return;
    let alive = true;
    void Promise.allSettled([
      window.anistream.browseAniList({
        type: "ANIME",
        page: 1,
        perPage: 20,
        sort: "TRENDING_DESC",
      }),
      window.anistream.browseAniList({
        type: "MANGA",
        page: 1,
        perPage: 20,
        sort: "TRENDING_DESC",
      }),
      window.anistream.getMoreTrending("MOVIE", 1),
    ]).then(([anime, manga, movies]) => {
      const covers = (result: typeof anime | typeof manga): string[] =>
        result.status === "fulfilled"
          ? result.value.items.flatMap((item) => (item.coverUrl ? [item.coverUrl] : []))
          : [];
      const sources = [
        covers(anime),
        covers(manga),
        movies.status === "fulfilled"
          ? movies.value.items.flatMap((item) => (item.posterUrl ? [item.posterUrl] : []))
          : [],
      ].filter((list) => list.length);
      const wall: string[] = [];
      for (let index = 0; sources.length && wall.length < WALL_COLUMNS * WALL_ROWS; index++)
        for (const list of sources) wall.push(list[index % list.length]!);
      const next = wall.slice(0, WALL_COLUMNS * WALL_ROWS);
      if (next.length) wallCache = next;
      if (alive) setUrls(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return urls;
}

export function ProfileConnectView({
  auth,
  simkl,
  restoring,
  error,
  onConnect,
  onCancel,
  onBrowse,
}: {
  auth: AniListAuthState;
  /** Simkl's connection; connecting it opens the Simkl profile. */
  simkl?: SimklStatus;
  restoring: boolean;
  error?: string;
  onConnect: () => Promise<void>;
  onCancel: () => Promise<void>;
  /** Leaves sign-in for the app's start section, as a guest. */
  onBrowse?: () => void;
}): React.JSX.Element {
  const reducedMotion = useAppReducedMotion();
  const wall = usePosterWall();
  const [simklError, setSimklError] = useState<string>();
  const authorizing = auth.status === "authorizing";
  const simklAuthorizing = simkl?.auth.status === "authorizing";
  const transition = motionTransition(reducedMotion, "emphasis");
  const columns = Array.from({ length: WALL_COLUMNS }, (_, column) =>
    wall.slice(column * WALL_ROWS, column * WALL_ROWS + WALL_ROWS),
  ).filter((column) => column.length);
  const simklMessage =
    simklError ?? (simkl?.auth.status === "error" ? simkl.auth.message : undefined);
  const runSimkl = (action: () => Promise<void>, failure: string): void => {
    setSimklError(undefined);
    void action().catch(() => setSimklError(failure));
  };

  return (
    <section className="signin-page" aria-labelledby="profile-connect-title">
      {columns.length ? (
        <div className="signin-wall" aria-hidden="true">
          {columns.map((column, index) => (
            <div className="signin-wall-column" key={index}>
              {column.map((src, row) => (
                <img key={`${row}:${src}`} src={src} alt="" decoding="async" />
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <motion.div
        className="signin-copy"
        initial={reducedMotion ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionTransition(reducedMotion, "entrance")}
        aria-busy={restoring || authorizing || simklAuthorizing}
      >
        <p className="sr-only" role="status" aria-live="polite">
          {restoring
            ? "Checking for a saved AniList session."
            : authorizing
              ? "AniList authorization is open in your browser."
              : simklAuthorizing
                ? "Simkl authorization is open in your browser."
                : "Ready to connect AniList or Simkl."}
        </p>
        <img className="profile-connect-app-icon" src={appIcon} alt="" aria-hidden="true" />
        <p className="signin-kicker">
          <SourceLogo source="anilist" label="AniList" />
          AniList
          <span className="signin-plus">+</span>
          <SourceLogo source="simkl" label="Simkl" />
          Simkl
        </p>
        <h1 id="profile-connect-title" data-profile-heading tabIndex={-1}>
          Make AniStream yours
        </h1>
        <p className="signin-lede">
          Connect the trackers you already use. Anime and manga sync with AniList; movies and shows
          with Simkl.
        </p>

        <div className="signin-trackers">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={restoring ? "restoring" : authorizing ? "authorizing" : "ready"}
              className={`signin-tracker${authorizing ? " signin-tracker--waiting" : ""}`}
              initial={reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
              transition={transition}
            >
              <span className="signin-tracker-mark signin-tracker-mark--anilist">
                <SourceLogo source="anilist" />
              </span>
              <div className="signin-tracker-text">
                <strong>AniList</strong>
                {authorizing ? (
                  <span>
                    <b>Finish in your browser</b> · approve AniStream there and you’ll come back
                    here.
                  </span>
                ) : (
                  <>
                    <span>Anime and manga lists, scores and progress</span>
                    <span className="signin-tracker-tags">
                      <em>Anime</em>
                      <em>Manga</em>
                    </span>
                  </>
                )}
              </div>
              {authorizing ? (
                <div className="signin-tracker-actions">
                  <button className="signin-small" type="button" onClick={() => void onConnect()}>
                    Open AniList again
                  </button>
                  <button className="signin-link" type="button" onClick={() => void onCancel()}>
                    Cancel sign-in
                  </button>
                </div>
              ) : (
                <button
                  className="signin-small signin-small--primary"
                  type="button"
                  disabled={restoring}
                  onClick={() => void onConnect()}
                >
                  {restoring ? "Restoring…" : "Connect AniList"}
                </button>
              )}
            </motion.div>
          </AnimatePresence>

          <div className={`signin-tracker${simklAuthorizing ? " signin-tracker--waiting" : ""}`}>
            <span className="signin-tracker-mark signin-tracker-mark--simkl">
              <SourceLogo source="simkl" />
            </span>
            <div className="signin-tracker-text">
              <strong>Simkl</strong>
              {simklAuthorizing ? (
                <span>Approve AniStream on simkl.com to finish.</span>
              ) : (
                <>
                  <span>Movie and TV history, watch list and ratings</span>
                  <span className="signin-tracker-tags">
                    <em>Movies</em>
                    <em>TV shows</em>
                  </span>
                </>
              )}
            </div>
            {simklAuthorizing ? (
              <>
                <span className="signin-spinner signin-spinner--small" aria-hidden="true" />
                <button
                  className="signin-link"
                  type="button"
                  onClick={() =>
                    runSimkl(() => window.anistream.cancelSimklConnect(), "Could not cancel.")
                  }
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="signin-small signin-small--primary"
                type="button"
                disabled={!simkl}
                onClick={() =>
                  runSimkl(
                    () => window.anistream.connectSimkl(),
                    "Simkl sign-in could not be started.",
                  )
                }
              >
                Connect Simkl
              </button>
            )}
          </div>
        </div>
        <p className="signin-both">
          <Check size={14} aria-hidden="true" />
          Connect one or both. You can add the other later in Settings.
        </p>

        {onBrowse ? (
          <div className="signin-actions">
            <button className="signin-button signin-button--glass" type="button" onClick={onBrowse}>
              Browse as guest
            </button>
          </div>
        ) : null}
        <p className="signin-fine">
          <Lock size={14} aria-hidden="true" />
          {restoring
            ? "Checking this device for a saved AniList session."
            : "You sign in on AniList’s and Simkl’s own pages. AniStream never sees your password."}
        </p>

        {error || simklMessage ? (
          <p className="error-banner signin-error" role="alert">
            {error ?? simklMessage}
          </p>
        ) : null}
      </motion.div>
    </section>
  );
}
