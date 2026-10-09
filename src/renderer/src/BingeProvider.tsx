import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BingeEntry, BingeItem } from "../../shared/binge";
import {
  createBingeSession,
  readAutoplay,
  writeAutoplay,
  type BingeSession,
  type BingeSnapshot,
} from "./binge-session";

interface BingeContextValue {
  session: BingeSession;
  state: BingeSnapshot;
  autoplay: boolean;
  setAutoplay: (enabled: boolean) => void;
  /** Opens playback for an item; an Up Next entry leaves the queue as it starts. */
  play: (entry: BingeEntry, fromQueue: boolean) => void;
  /** Starts the first Up Next entry; false when the queue is empty. */
  playNext: () => boolean;
}

const Context = createContext<BingeContextValue | null>(null);

export function BingeProvider({
  onPlay,
  children,
}: {
  onPlay: (item: BingeItem) => void;
  children: ReactNode;
}) {
  const [session] = useState(() => createBingeSession(window.anistream));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [autoplay, setAutoplayState] = useState(readAutoplay);
  const onPlayRef = useRef(onPlay);
  useEffect(() => {
    onPlayRef.current = onPlay;
  }, [onPlay]);
  useEffect(() => {
    void session.load();
  }, [session]);

  const play = useCallback(
    (entry: BingeEntry, fromQueue: boolean) => {
      if (fromQueue)
        void session.apply({ op: "remove", target: { list: "queue" }, key: entry.key });
      onPlayRef.current(entry.item);
    },
    [session],
  );
  const playNext = useCallback(() => {
    const next = session.getSnapshot().queue[0];
    if (!next) return false;
    play(next, true);
    return true;
  }, [play, session]);
  const setAutoplay = useCallback((enabled: boolean) => {
    writeAutoplay(enabled);
    setAutoplayState(enabled);
  }, []);

  const value = useMemo(
    () => ({ session, state, autoplay, setAutoplay, play, playNext }),
    [autoplay, play, playNext, session, setAutoplay, state],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBinge(): BingeContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("Up Next requires its app provider.");
  return value;
}

/** Like `useBinge`, but null outside the provider (isolated component tests and harnesses). */
export function useOptionalBinge(): BingeContextValue | null {
  return useContext(Context);
}
