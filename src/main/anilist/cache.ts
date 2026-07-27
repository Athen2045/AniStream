export interface BoundedCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
}

export interface BoundedCacheOptions {
  maxEntries: number;
  ttlMs: number;
}

/** A small LRU-ish, TTL-bounded cache for view data (see API.md client strategy). */
export function createBoundedCache<T>(options: BoundedCacheOptions): BoundedCache<T> {
  const store = new Map<string, { value: T; expiresAt: number }>();

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
      store.set(key, { value, expiresAt: Date.now() + options.ttlMs });
      if (store.size > options.maxEntries) {
        const oldestKey = store.keys().next().value;
        if (oldestKey !== undefined) store.delete(oldestKey);
      }
    },
  };
}
