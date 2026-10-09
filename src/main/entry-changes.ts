import type Database from "better-sqlite3";
import type {
  AniListDashboard,
  AniListEntry,
  AniListListEntrySummary,
  UpdateAniListEntryInput,
} from "../shared/contracts";

/**
 * Library edits made while AniList is unreachable. One row per (account, entry): repeated edits
 * merge field by field and a delete replaces anything queued before it, so the queue stays as
 * small as the set of touched entries.
 */
export type PendingEntryChange =
  | { kind: "update"; entryId: number; input: UpdateAniListEntryInput; queuedAt: string }
  | { kind: "delete"; entryId: number; queuedAt: string };

export interface EntryChangeRepository {
  queueEntryChange(owner: number, change: PendingEntryChange): PendingEntryChange;
  pendingEntryChanges(owner: number): PendingEntryChange[];
  clearEntryChange(owner: number, entryId: number): void;
}

interface Row {
  entry_id: number;
  kind: "update" | "delete";
  payload_json: string;
  queued_at: string;
}

export function createEntryChangeRepository(db: Database.Database): EntryChangeRepository {
  db.exec(`CREATE TABLE IF NOT EXISTS pending_entry_change_v1 (
    owner INTEGER NOT NULL, entry_id INTEGER NOT NULL, kind TEXT NOT NULL,
    payload_json TEXT NOT NULL, queued_at TEXT NOT NULL,
    PRIMARY KEY(owner, entry_id)
  );
  INSERT OR IGNORE INTO app_meta(key, value) VALUES ('entry-changes.schema', '1');`);
  const read = db.prepare<[number, number], Row>(
    "SELECT entry_id, kind, payload_json, queued_at FROM pending_entry_change_v1 WHERE owner = ? AND entry_id = ?",
  );
  const write = db.prepare(
    `INSERT INTO pending_entry_change_v1 (owner, entry_id, kind, payload_json, queued_at)
     VALUES (@owner, @entryId, @kind, @payload, @queuedAt)
     ON CONFLICT(owner, entry_id) DO UPDATE SET kind = excluded.kind,
       payload_json = excluded.payload_json, queued_at = excluded.queued_at`,
  );
  const list = db.prepare<[number], Row>(
    "SELECT entry_id, kind, payload_json, queued_at FROM pending_entry_change_v1 WHERE owner = ? ORDER BY queued_at",
  );
  const remove = db.prepare("DELETE FROM pending_entry_change_v1 WHERE owner = ? AND entry_id = ?");
  const map = (row: Row): PendingEntryChange =>
    row.kind === "delete"
      ? { kind: "delete", entryId: row.entry_id, queuedAt: row.queued_at }
      : {
          kind: "update",
          entryId: row.entry_id,
          input: JSON.parse(row.payload_json) as UpdateAniListEntryInput,
          queuedAt: row.queued_at,
        };
  const queue = db.transaction((owner: number, change: PendingEntryChange) => {
    const existing = read.get(owner, change.entryId);
    const previous = existing ? map(existing) : undefined;
    const merged: PendingEntryChange =
      change.kind === "delete" || previous?.kind === "delete"
        ? { kind: "delete", entryId: change.entryId, queuedAt: change.queuedAt }
        : {
            ...change,
            input: { ...(previous?.kind === "update" ? previous.input : {}), ...change.input },
          };
    write.run({
      owner,
      entryId: merged.entryId,
      kind: merged.kind,
      payload: merged.kind === "update" ? JSON.stringify(merged.input) : "{}",
      queuedAt: merged.queuedAt,
    });
    return merged;
  });
  return {
    queueEntryChange: (owner, change) => {
      if (!Number.isInteger(owner) || owner <= 0) throw new Error("Invalid AniList account.");
      if (!Number.isInteger(change.entryId) || change.entryId <= 0)
        throw new Error("Invalid AniList entry.");
      return queue(owner, change);
    },
    pendingEntryChanges: (owner) => list.all(owner).map(map),
    clearEntryChange: (owner, entryId) => {
      remove.run(owner, entryId);
    },
  };
}

/**
 * The library as it will be once the queued edits reach AniList: updates change the entry in place
 * (moving it to its new status list when that list exists) and deletes remove it.
 */
export function applyEntryChanges(
  dashboard: AniListDashboard,
  changes: readonly PendingEntryChange[],
): AniListDashboard {
  if (!changes.length) return dashboard;
  const byId = new Map(changes.map((change) => [change.entryId, change]));
  const apply = (groups: AniListDashboard["animeLists"]): AniListDashboard["animeLists"] => {
    const moved: AniListEntry[] = [];
    const next = groups.map((group) => ({
      ...group,
      entries: group.entries.flatMap((entry) => {
        const change = byId.get(entry.id);
        if (!change) return [entry];
        if (change.kind === "delete") return [];
        const updated = applyUpdate(entry, change.input);
        if (!group.isCustomList && updated.status !== entry.status) {
          moved.push(updated);
          return [];
        }
        return [updated];
      }),
    }));
    for (const entry of moved) {
      const target =
        next.find(
          (group) =>
            !group.isCustomList && group.entries.some((other) => other.status === entry.status),
        ) ??
        next.find((group) => !group.isCustomList && group.entries.some((e) => e.id === entry.id));
      if (target) target.entries = [entry, ...target.entries];
      else next.push({ name: statusListName(entry), isCustomList: false, entries: [entry] });
    }
    return next.filter((group) => group.entries.length);
  };
  return {
    ...dashboard,
    animeLists: apply(dashboard.animeLists),
    mangaLists: apply(dashboard.mangaLists),
  };
}

export function summarize(entry: AniListEntry): AniListListEntrySummary {
  return { id: entry.id, status: entry.status, score: entry.score, progress: entry.progress };
}

export function findEntry(dashboard: AniListDashboard, entryId: number): AniListEntry | undefined {
  for (const group of [...dashboard.animeLists, ...dashboard.mangaLists])
    for (const entry of group.entries) if (entry.id === entryId) return entry;
  return undefined;
}

function applyUpdate(entry: AniListEntry, input: UpdateAniListEntryInput): AniListEntry {
  return {
    ...entry,
    status: input.status ?? entry.status,
    score: input.score ?? entry.score,
    progress: input.progress ?? entry.progress,
    progressVolumes: input.progressVolumes ?? entry.progressVolumes,
    repeat: input.repeat ?? entry.repeat,
    notes: input.notes ?? entry.notes,
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

function statusListName(entry: AniListEntry): string {
  const anime = entry.media.type === "ANIME";
  return (
    (
      {
        CURRENT: anime ? "Watching" : "Reading",
        REPEATING: anime ? "Rewatching" : "Rereading",
        COMPLETED: "Completed",
        PAUSED: "Paused",
        DROPPED: "Dropped",
        PLANNING: "Planning",
      } as Record<string, string>
    )[entry.status] ?? "Other"
  );
}
