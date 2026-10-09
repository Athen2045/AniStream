import type Database from "better-sqlite3";
import {
  BINGE_LIST_LIMIT,
  BINGE_PLAYLIST_LIMIT,
  bingeItemKey,
  bingeItemWithoutArt,
  parseBingeItem,
  type BingeChange,
  type BingeEntry,
  type BingeListRef,
  type BingeState,
} from "../shared/binge";
import type { BackupBingeEntry, BackupPlaylist, BackupUpNext } from "../shared/local-backup";

/** Up Next and saved playlists: local, single-user, never synced anywhere. */
export interface BingeRepository {
  getBingeState(): BingeState;
  applyBingeChange(change: BingeChange): BingeState;
  /** Up Next and playlists for the local backup file. */
  exportBingeBackup(): BackupUpNext;
  /**
   * What restoring would add while keeping everything already here: queue titles not yet queued
   * (appended) and playlists whose name is new. Throws when the result would pass a list limit.
   */
  planBingeRestore(input: BackupUpNext): BingeRestorePlan;
  /** Writes a plan. Runs inside the caller's restore transaction. */
  writeBingeRestore(plan: BingeRestorePlan): void;
}

export interface BingeRestorePlan {
  queue: BackupBingeEntry[];
  playlists: BackupPlaylist[];
  /** Backup items skipped because the same title or playlist name is already here. */
  kept: number;
}

/** Up Next is stored as list 0; playlists use their own positive IDs. */
const QUEUE_LIST_ID = 0;

interface EntryRow {
  list_id: number;
  item_key: string;
  item_json: string;
  added_at: string;
}

interface PlaylistRow {
  id: number;
  name: string;
  updated_at: string;
}

export function createBingeRepository(database: Database.Database): BingeRepository {
  database.exec(`
    CREATE TABLE IF NOT EXISTS binge_playlists_v1 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS binge_entries_v1 (
      list_id INTEGER NOT NULL CHECK (list_id >= 0),
      item_key TEXT NOT NULL,
      position INTEGER NOT NULL,
      item_json TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (list_id, item_key)
    );
    CREATE INDEX IF NOT EXISTS idx_binge_entries_order ON binge_entries_v1 (list_id, position);
  `);
  const readEntries = database.prepare<[], EntryRow>(
    "SELECT list_id, item_key, item_json, added_at FROM binge_entries_v1 ORDER BY list_id, position",
  );
  const readList = database.prepare<[number], EntryRow>(
    "SELECT list_id, item_key, item_json, added_at FROM binge_entries_v1 WHERE list_id = ? ORDER BY position",
  );
  const readPlaylists = database.prepare<[], PlaylistRow>(
    "SELECT id, name, updated_at FROM binge_playlists_v1 ORDER BY updated_at DESC, id DESC",
  );
  const playlistExists = database.prepare<[number], { id: number }>(
    "SELECT id FROM binge_playlists_v1 WHERE id = ?",
  );
  const countPlaylists = database.prepare<[], { count: number }>(
    "SELECT COUNT(*) AS count FROM binge_playlists_v1",
  );
  const insertEntry = database.prepare(
    "INSERT INTO binge_entries_v1 (list_id, item_key, position, item_json, added_at) VALUES (?, ?, ?, ?, ?)",
  );
  const deleteEntry = database.prepare(
    "DELETE FROM binge_entries_v1 WHERE list_id = ? AND item_key = ?",
  );
  const clearList = database.prepare("DELETE FROM binge_entries_v1 WHERE list_id = ?");
  const insertPlaylist = database.prepare(
    "INSERT INTO binge_playlists_v1 (name, created_at, updated_at) VALUES (?, ?, ?)",
  );
  const renamePlaylist = database.prepare(
    "UPDATE binge_playlists_v1 SET name = ?, updated_at = ? WHERE id = ?",
  );
  const touchPlaylist = database.prepare(
    "UPDATE binge_playlists_v1 SET updated_at = ? WHERE id = ?",
  );
  const deletePlaylist = database.prepare("DELETE FROM binge_playlists_v1 WHERE id = ?");

  function toEntry(row: EntryRow): BingeEntry | undefined {
    try {
      const item = parseBingeItem(JSON.parse(row.item_json));
      return item ? { key: row.item_key, item, addedAt: row.added_at } : undefined;
    } catch {
      return undefined;
    }
  }

  function state(): BingeState {
    const lists = new Map<number, BingeEntry[]>();
    for (const row of readEntries.all()) {
      const entry = toEntry(row);
      if (!entry) continue;
      const list = lists.get(row.list_id) ?? [];
      list.push(entry);
      lists.set(row.list_id, list);
    }
    return {
      queue: lists.get(QUEUE_LIST_ID) ?? [],
      playlists: readPlaylists.all().map((row) => ({
        id: row.id,
        name: row.name,
        updatedAt: row.updated_at,
        entries: lists.get(row.id) ?? [],
      })),
    };
  }

  function listId(target: BingeListRef): number {
    if (target.list === "queue") return QUEUE_LIST_ID;
    if (!playlistExists.get(target.id)) throw new Error("That playlist no longer exists.");
    return target.id;
  }

  /** Rewrites a list in the given order, so positions stay 0..n-1. */
  function writeList(id: number, entries: BingeEntry[]): void {
    clearList.run(id);
    entries.forEach((entry, index) =>
      insertEntry.run(id, entry.key, index, JSON.stringify(entry.item), entry.addedAt),
    );
    if (id !== QUEUE_LIST_ID) touchPlaylist.run(new Date().toISOString(), id);
  }

  function entriesOf(id: number): BingeEntry[] {
    return readList.all(id).flatMap((row) => toEntry(row) ?? []);
  }

  function copyEntries(entries: BingeEntry[]): BingeEntry[] {
    const now = new Date().toISOString();
    return entries.slice(0, BINGE_LIST_LIMIT).map((entry) => ({ ...entry, addedAt: now }));
  }

  const apply = database.transaction((change: BingeChange): void => {
    const now = new Date().toISOString();
    switch (change.op) {
      case "add": {
        const id = listId(change.target);
        const key = bingeItemKey(change.item);
        const rest = entriesOf(id).filter((entry) => entry.key !== key);
        if (rest.length >= BINGE_LIST_LIMIT)
          throw new Error(`A list holds up to ${BINGE_LIST_LIMIT} titles.`);
        const entry: BingeEntry = { key, item: change.item, addedAt: now };
        writeList(id, change.position === "next" ? [entry, ...rest] : [...rest, entry]);
        return;
      }
      case "remove": {
        const id = listId(change.target);
        deleteEntry.run(id, change.key);
        writeList(id, entriesOf(id));
        return;
      }
      case "move": {
        const id = listId(change.target);
        const entries = entriesOf(id);
        const from = entries.findIndex((entry) => entry.key === change.key);
        if (from < 0) return;
        const [moved] = entries.splice(from, 1);
        entries.splice(Math.min(change.index, entries.length), 0, moved!);
        writeList(id, entries);
        return;
      }
      case "clear":
        writeList(listId(change.target), []);
        return;
      case "create-playlist": {
        if (countPlaylists.get()!.count >= BINGE_PLAYLIST_LIMIT)
          throw new Error(`You can keep up to ${BINGE_PLAYLIST_LIMIT} playlists.`);
        const created = insertPlaylist.run(change.name, now, now);
        const id = Number(created.lastInsertRowid);
        if (change.fromQueue) writeList(id, copyEntries(entriesOf(QUEUE_LIST_ID)));
        return;
      }
      case "rename-playlist":
        listId({ list: "playlist", id: change.id });
        renamePlaylist.run(change.name, now, change.id);
        return;
      case "delete-playlist":
        clearList.run(change.id);
        deletePlaylist.run(change.id);
        return;
      case "queue-playlist":
        writeList(
          QUEUE_LIST_ID,
          copyEntries(entriesOf(listId({ list: "playlist", id: change.id }))),
        );
        return;
    }
  });

  return {
    getBingeState: state,
    applyBingeChange(change) {
      apply.immediate(change);
      return state();
    },
    exportBingeBackup() {
      const current = state();
      const entries = (list: BingeEntry[]): BackupBingeEntry[] =>
        list.map(({ item, addedAt }) => ({ item: bingeItemWithoutArt(item), addedAt }));
      return {
        queue: entries(current.queue),
        playlists: current.playlists.map((playlist) => ({
          name: playlist.name,
          updatedAt: playlist.updatedAt,
          entries: entries(playlist.entries),
        })),
      };
    },
    planBingeRestore(input) {
      const current = state();
      const queued = new Set(current.queue.map((entry) => entry.key));
      const queue = input.queue.filter((entry) => !queued.has(bingeItemKey(entry.item)));
      if (current.queue.length + queue.length > BINGE_LIST_LIMIT)
        throw new Error(
          `This backup would put more than ${BINGE_LIST_LIMIT} titles in Up Next. Remove some first.`,
        );
      const names = new Set(current.playlists.map((playlist) => playlist.name.toLowerCase()));
      const playlists = input.playlists.filter(
        (playlist) => !names.has(playlist.name.toLowerCase()),
      );
      if (current.playlists.length + playlists.length > BINGE_PLAYLIST_LIMIT)
        throw new Error(
          `This backup would make more than ${BINGE_PLAYLIST_LIMIT} playlists. Delete some first.`,
        );
      return {
        queue,
        playlists,
        kept: input.queue.length - queue.length + input.playlists.length - playlists.length,
      };
    },
    writeBingeRestore(plan) {
      const toEntries = (list: BackupBingeEntry[]): BingeEntry[] =>
        list.map(({ item, addedAt }) => ({ key: bingeItemKey(item), item, addedAt }));
      if (plan.queue.length)
        writeList(QUEUE_LIST_ID, [...entriesOf(QUEUE_LIST_ID), ...toEntries(plan.queue)]);
      for (const playlist of plan.playlists) {
        const created = insertPlaylist.run(playlist.name, playlist.updatedAt, playlist.updatedAt);
        writeList(Number(created.lastInsertRowid), toEntries(playlist.entries));
      }
    },
  };
}
