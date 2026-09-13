import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPersonalLibrarySession } from "./personal-library-session";
import type { ViewerAccess } from "./viewer-access";

const Context = createContext<ReturnType<typeof createPersonalLibrarySession> | null>(null);

export function PersonalLibraryProvider({
  access,
  children,
}: {
  access: ViewerAccess;
  children: ReactNode;
}) {
  const [session] = useState(() => createPersonalLibrarySession(access, window.anistream));
  useEffect(() => session.setAccess(access), [access, session]);
  useEffect(() => {
    session.activate();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const localChanged = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        session.invalidateLocal();
      }, 150);
    };
    const visible = () => {
      if (document.visibilityState === "visible") void session.refresh();
    };
    const preferencesChanged = () => session.invalidateManga();
    const unsubscribe = window.anistream.onActivityChanged(localChanged);
    window.addEventListener("anistream:activity-updated", localChanged);
    window.addEventListener("anistream:manga-preferences-updated", preferencesChanged);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    const interval = setInterval(visible, 30 * 60_000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      unsubscribe();
      window.removeEventListener("anistream:activity-updated", localChanged);
      window.removeEventListener("anistream:manga-preferences-updated", preferencesChanged);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
      session.dispose();
    };
  }, [session]);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}

export function usePersonalLibrary() {
  const session = useContext(Context);
  if (!session) throw new Error("Personal library requires its app provider.");
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { session, state };
}
