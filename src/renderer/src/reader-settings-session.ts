import type { AniStreamBridge } from "../../shared/contracts";
import {
  DEFAULT_READER_SETTINGS,
  parseReaderSettings,
  type ReaderSettings,
} from "../../shared/reader-settings";

interface Snapshot {
  settings: ReaderSettings;
  loaded: boolean;
  saving: boolean;
  error?: string;
}
type Bridge = Pick<AniStreamBridge, "getReaderSettings" | "saveReaderSettings">;
export function createReaderSettingsSession(bridge?: Bridge) {
  const api = () => bridge ?? window.anistream;
  let snapshot: Snapshot = {
    settings: { ...DEFAULT_READER_SETTINGS },
    loaded: false,
    saving: false,
  };
  let generation = 0;
  let active = true;
  let dirty = false;
  const listeners = new Set<() => void>();
  const update = (changes: Partial<Snapshot>) => {
    if (!active) return;
    snapshot = { ...snapshot, ...changes };
    listeners.forEach((listener) => listener());
  };
  const load = async (): Promise<void> => {
    const current = ++generation;
    try {
      const settings = parseReaderSettings(await api().getReaderSettings());
      if (current === generation) update({ settings, loaded: true, error: undefined });
    } catch {
      if (current === generation)
        update({
          loaded: true,
          error: "Saved reader settings could not be loaded. Using defaults.",
        });
    }
  };
  const save = async (settings: ReaderSettings): Promise<void> => {
    if (!active || snapshot.saving) return;
    const current = ++generation;
    dirty = true;
    update({ settings: parseReaderSettings(settings), saving: true, error: undefined });
    try {
      const saved = parseReaderSettings(await api().saveReaderSettings(settings));
      if (current !== generation || !active) return;
      dirty = false;
      update({ settings: saved, saving: false });
    } catch {
      if (current === generation)
        update({
          saving: false,
          error: "Reader settings are not saved. Your changes apply for this reading session.",
        });
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate() {
      active = true;
    },
    load,
    save,
    retry: () => (dirty ? save(snapshot.settings) : load()),
    dispose() {
      active = false;
      generation++;
      listeners.clear();
    },
  };
}
