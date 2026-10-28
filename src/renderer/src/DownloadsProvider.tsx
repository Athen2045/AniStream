import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  chapterDownloadKey,
  downloadKey,
  type AnimeDownload,
  type DownloadChange,
  type DownloadChapterRequest,
  type DownloadEpisodeRequest,
  type DownloadsState,
  type MangaChapterDownload,
} from "../../shared/downloads";

interface DownloadsContextValue {
  state?: DownloadsState;
  /** The last action's outcome for people (limit reached, refused source, …). */
  notice?: string;
  dismissNotice: () => void;
  byEpisode: ReadonlyMap<string, AnimeDownload>;
  /** Manga chapter downloads by `chapterDownloadKey(source, chapterId)`. */
  byChapter: ReadonlyMap<string, MangaChapterDownload>;
  /** Bytes per second for each running download, smoothed over its recent updates. */
  speeds: ReadonlyMap<string, number>;
  add: (episodes: DownloadEpisodeRequest[]) => Promise<void>;
  addChapters: (chapters: DownloadChapterRequest[]) => Promise<void>;
  apply: (change: Exclude<DownloadChange, { op: "add" }>) => Promise<void>;
  chooseFolder: () => Promise<void>;
}

const Context = createContext<DownloadsContextValue | null>(null);
/** For component tests and previews that supply their own downloads state. */
export const DownloadsContext = Context;
export type { DownloadsContextValue };

/** Offline downloads as the renderer sees them; the main process owns the files and queue. */
export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [state, setStateRaw] = useState<DownloadsState>();
  const [notice, setNotice] = useState<string>();
  const [speeds, setSpeeds] = useState<ReadonlyMap<string, number>>(() => new Map());
  const samples = useRef(new Map<string, { at: number; bytes: number; rate?: number }>());

  // Every new state also updates the running downloads' speeds (for "3.2 MB/s · 1 min left").
  const setState = useCallback((next: DownloadsState) => {
    const now = performance.now();
    const rates = new Map<string, number>();
    for (const item of [...next.items, ...next.chapters]) {
      if (item.status !== "downloading") {
        samples.current.delete(item.id);
        continue;
      }
      const previous = samples.current.get(item.id);
      let rate = previous?.rate;
      if (previous && item.bytesDone > previous.bytes && now > previous.at) {
        const instant = ((item.bytesDone - previous.bytes) * 1000) / (now - previous.at);
        rate = rate === undefined ? instant : rate * 0.7 + instant * 0.3;
      }
      samples.current.set(item.id, { at: now, bytes: item.bytesDone, rate });
      if (rate !== undefined) rates.set(item.id, rate);
    }
    setSpeeds(rates);
    setStateRaw(next);
  }, []);

  const refresh = useCallback(() => {
    void window.anistream
      .getDownloads()
      .then(setState)
      .catch(() => undefined);
  }, [setState]);

  useEffect(() => {
    refresh();
    return window.anistream.onDownloadsChanged(refresh);
  }, [refresh]);

  const add = useCallback(
    async (episodes: DownloadEpisodeRequest[]) => {
      try {
        const result = await window.anistream.addDownloads(episodes);
        setState(result.state);
        setNotice(result.message);
      } catch {
        setNotice("Those episodes could not be queued for download. Try again.");
      }
    },
    [setState],
  );
  const addChapters = useCallback(
    async (chapters: DownloadChapterRequest[]) => {
      try {
        const result = await window.anistream.addChapterDownloads(chapters);
        setState(result.state);
        setNotice(result.message);
      } catch {
        setNotice("Those chapters could not be queued for download. Try again.");
      }
    },
    [setState],
  );
  const apply = useCallback(
    async (change: Exclude<DownloadChange, { op: "add" }>) => {
      try {
        setState(await window.anistream.applyDownloadChange(change));
      } catch {
        setNotice("That change could not be saved. Try again.");
      }
    },
    [setState],
  );
  const chooseFolder = useCallback(async () => {
    try {
      const next = await window.anistream.chooseDownloadFolder();
      if (next) setState(next);
    } catch {
      setNotice("That folder could not be used. Choose another one.");
    }
  }, [setState]);

  const byEpisode = useMemo(
    () =>
      new Map(
        (state?.items ?? []).map((item) => [downloadKey(item.aniListId, item.episode), item]),
      ),
    [state],
  );
  const byChapter = useMemo(
    () =>
      new Map(
        (state?.chapters ?? []).map((item) => [
          chapterDownloadKey(item.chapter.source, item.chapter.id),
          item,
        ]),
      ),
    [state],
  );
  const value = useMemo(
    () => ({
      state,
      notice,
      dismissNotice: () => setNotice(undefined),
      byEpisode,
      byChapter,
      speeds,
      add,
      addChapters,
      apply,
      chooseFolder,
    }),
    [add, addChapters, apply, byChapter, byEpisode, chooseFolder, notice, speeds, state],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Null outside the provider (isolated component tests and harnesses). */
export function useOptionalDownloads(): DownloadsContextValue | null {
  return useContext(Context);
}

export function useDownloads(): DownloadsContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("Downloads require their app provider.");
  return value;
}
