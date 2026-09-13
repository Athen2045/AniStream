export interface BoundedCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
}

export interface BoundedCacheOptions<T = unknown> {
  maxEntries: number;
  ttlMs: number;
  maxBytes?: number;
  sizeOf?: (value: T) => number;
}

/** A small LRU-ish, TTL-bounded cache for view data (see API.md client strategy). */
export function createBoundedCache<T>(options: BoundedCacheOptions<T>): BoundedCache<T> {
  const store = new Map<string, { value: T; expiresAt: number; bytes: number }>();

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() >= entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      store.delete(key);
      store.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      store.delete(key);
      const bytes = options.sizeOf?.(value) ?? 0;
      const maxBytes = options.maxBytes ?? Infinity;
      if (!Number.isFinite(bytes) || bytes < 0 || bytes > maxBytes) return;
      const now = Date.now();
      for (const [key, entry] of store) if (entry.expiresAt <= now) store.delete(key);
      store.set(key, { value, expiresAt: now + options.ttlMs, bytes });
      let retained = [...store.values()].reduce((total, entry) => total + entry.bytes, 0);
      while (store.size > options.maxEntries || retained > maxBytes) {
        const oldestKey = store.keys().next().value;
        if (oldestKey === undefined) break;
        retained -= store.get(oldestKey)!.bytes;
        store.delete(oldestKey);
      }
    },
    delete(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}
