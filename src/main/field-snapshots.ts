import type Database from "better-sqlite3";

/**
 * Saved copies of slow-changing home fields (Trending, For You). A field shows its saved copy at
 * once and keeps one answer for the whole session, so switching sections never refetches it. The
 * first time a field is shown in a session, a refresh is queued in the background (one task at a
 * time, after startup settles) and its result replaces the saved copy for the next launch.
 */
export interface SnapshotStore {
  read(key: string): { value: unknown; savedAt: number } | undefined;
  write(key: string, value: unknown, now: number): void;
}

export interface SnapshotField<T> {
  key: string;
  load: () => Promise<T>;
  /** Only a usable value (e.g. a non-empty page or a ready feed) is saved or served from disk. */
  usable: (value: unknown) => value is T;
  /** Called when a saved copy is served, e.g. so its feedback IDs are accepted again. */
  adopt?: (value: T) => void;
}

export interface FieldSnapshotOptions {
  store: () => SnapshotStore | undefined;
  now?: () => number;
  /** Background refreshes wait this long after startup so foreground requests go first. */
  startDelayMs?: number;
  /** Pause between background refreshes. */
  gapMs?: number;
  /** A saved copy older than this is not shown; the field loads live instead. */
  maxAgeMs?: number;
  setTimer?: (run: () => void, ms: number) => void;
}

const MAX_ROWS = 64;

export class FieldSnapshots {
  private readonly session = new Map<string, unknown>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly queue: Array<{ key: string; run: () => Promise<void> }> = [];
  private readonly queued = new Set<string>();
  private readonly now: () => number;
  private readonly startAt: number;
  private draining = false;

  constructor(private readonly options: FieldSnapshotOptions) {
    this.now = options.now ?? Date.now;
    this.startAt = this.now() + (options.startDelayMs ?? 8_000);
  }

  /** The session's answer, else the saved copy (refreshed in the background), else a live load. */
  async get<T>(field: SnapshotField<T>, fresh = false): Promise<T> {
    if (!fresh) {
      if (this.session.has(field.key)) return this.session.get(field.key) as T;
      const saved = this.readSaved(field);
      if (saved !== undefined) {
        field.adopt?.(saved);
        this.session.set(field.key, saved);
        this.enqueue(field);
        return saved;
      }
    }
    return this.loadLive(field);
  }

  /**
   * Edits the session answer and the saved copy in place, e.g. to drop a title the viewer marked
   * "Not interested" so it cannot come back from a saved feed. A failing edit leaves both as is.
   */
  update(key: string, change: (value: unknown) => unknown): void {
    if (this.session.has(key)) this.session.set(key, change(this.session.get(key)));
    try {
      const store = this.options.store();
      const row = store?.read(key);
      if (row) store?.write(key, change(row.value), row.savedAt);
    } catch {
      // The next background refresh replaces the saved copy anyway.
    }
  }

  /**
   * Drops the session answer and the saved copy, so the next view loads live; e.g. after a
   * setting (hidden genres) changes what the field may contain.
   */
  forget(key: string): void {
    this.session.delete(key);
    try {
      // An unusable value is never served, and the next good load replaces it.
      this.options.store()?.write(key, null, 0);
    } catch {
      // A stale copy expires on its own.
    }
  }

  private loadLive<T>(field: SnapshotField<T>): Promise<T> {
    const existing = this.pending.get(field.key);
    if (existing) return existing as Promise<T>;
    const request = field.load().then((value) => {
      // Unusable answers (empty, degraded) are returned but never pinned, so the next view retries.
      // One background retry later this session can still save a good copy for the next launch
      // (AniList intermittently answers Manga Trending with an empty page).
      if (field.usable(value)) {
        this.session.set(field.key, value);
        this.save(field.key, value);
      } else this.enqueue(field);
      return value;
    });
    this.pending.set(field.key, request);
    const clear = (): void => {
      if (this.pending.get(field.key) === request) this.pending.delete(field.key);
    };
    void request.then(clear, clear);
    return request;
  }

  private readSaved<T>(field: SnapshotField<T>): T | undefined {
    try {
      const row = this.options.store()?.read(field.key);
      if (!row || this.now() - row.savedAt > (this.options.maxAgeMs ?? 7 * 86_400_000)) return;
      return field.usable(row.value) ? row.value : undefined;
    } catch {
      return undefined;
    }
  }

  private save(key: string, value: unknown): void {
    try {
      this.options.store()?.write(key, value, this.now());
    } catch {
      // A saved copy is a convenience; the live answer is already shown.
    }
  }

  private enqueue<T>(field: SnapshotField<T>): void {
    if (this.queued.has(field.key)) return;
    this.queued.add(field.key);
    this.queue.push({
      key: field.key,
      run: async () => {
        const value = await field.load();
        if (field.usable(value)) this.save(field.key, value);
      },
    });
    this.schedule(Math.max(0, this.startAt - this.now()));
  }

  private schedule(delayMs: number): void {
    if (this.draining) return;
    this.draining = true;
    const timer = this.options.setTimer ?? ((run, ms) => void setTimeout(run, ms));
    timer(() => void this.drain(), delayMs);
  }

  private async drain(): Promise<void> {
    const task = this.queue.shift();
    if (!task) {
      this.draining = false;
      return;
    }
    try {
      await task.run();
    } catch {
      // Offline or rate-limited: the saved copy stays; the next launch tries again.
    }
    this.draining = false;
    if (this.queue.length) this.schedule(this.options.gapMs ?? 1_500);
  }
}

export function createSnapshotStore(db: Database.Database): SnapshotStore {
  db.exec(`CREATE TABLE IF NOT EXISTS field_snapshot_v1 (
    key TEXT PRIMARY KEY, payload TEXT NOT NULL, saved_at INTEGER NOT NULL
  );`);
  const read = db.prepare<[string], { payload: string; saved_at: number }>(
    "SELECT payload, saved_at FROM field_snapshot_v1 WHERE key=?",
  );
  const write = db.prepare(
    `INSERT INTO field_snapshot_v1 VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, saved_at=excluded.saved_at`,
  );
  const trim = db.prepare(
    `DELETE FROM field_snapshot_v1 WHERE key NOT IN
     (SELECT key FROM field_snapshot_v1 ORDER BY saved_at DESC LIMIT ${MAX_ROWS})`,
  );
  return {
    read(key) {
      const row = read.get(key);
      if (!row) return undefined;
      try {
        return { value: JSON.parse(row.payload) as unknown, savedAt: row.saved_at };
      } catch {
        return undefined;
      }
    },
    write(key, value, now) {
      db.transaction(() => {
        write.run(key, JSON.stringify(value), now);
        trim.run();
      })();
    },
  };
}
