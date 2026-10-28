import type Database from "better-sqlite3";
import type {
  DownloadStatus,
  DownloadedChapterInfo,
  MangaChapterDownload,
  MangaChapterSource,
} from "../../shared/downloads";

/** One chapter download plus where its files live. */
export interface StoredChapterDownload extends MangaChapterDownload {
  folder: string;
}

export interface ChapterDownloadStore {
  list(): StoredChapterDownload[];
  get(id: string): StoredChapterDownload | undefined;
  find(source: MangaChapterSource, chapterId: string): StoredChapterDownload | undefined;
  insert(item: StoredChapterDownload): void;
  update(
    id: string,
    patch: Partial<Omit<StoredChapterDownload, "id" | "aniListId" | "chapter">>,
  ): void;
  remove(id: string): void;
}

interface Row {
  id: string;
  anilist_id: number;
  source: string;
  chapter_id: string;
  chapter_json: string;
  title: string;
  cover_url: string | null;
  status: string;
  pages_done: number;
  pages_total: number;
  bytes_done: number;
  bytes_expected: number;
  error: string | null;
  folder: string;
  created_at: string;
  updated_at: string;
}

const STATUSES = new Set<DownloadStatus>(["queued", "downloading", "paused", "done", "failed"]);
const COLUMNS: Record<string, string> = {
  title: "title",
  coverUrl: "cover_url",
  status: "status",
  pagesDone: "pages_done",
  pagesTotal: "pages_total",
  bytesDone: "bytes_done",
  bytesExpected: "bytes_expected",
  error: "error",
  folder: "folder",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

function toChapterInfo(row: Row): DownloadedChapterInfo {
  const source: MangaChapterSource = row.source === "mirror" ? "mirror" : "mangadex";
  try {
    const parsed = JSON.parse(row.chapter_json) as Partial<DownloadedChapterInfo>;
    return {
      ...parsed,
      source,
      id: row.chapter_id,
      translatedLanguage:
        typeof parsed.translatedLanguage === "string" ? parsed.translatedLanguage : "en",
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    };
  } catch {
    return { source, id: row.chapter_id, translatedLanguage: "en", groups: [] };
  }
}

function toDownload(row: Row): StoredChapterDownload {
  return {
    id: row.id,
    aniListId: row.anilist_id,
    title: row.title,
    ...(row.cover_url ? { coverUrl: row.cover_url } : {}),
    chapter: toChapterInfo(row),
    status: STATUSES.has(row.status as DownloadStatus) ? (row.status as DownloadStatus) : "failed",
    pagesDone: row.pages_done,
    pagesTotal: row.pages_total,
    bytesDone: row.bytes_done,
    bytesExpected: row.bytes_expected,
    ...(row.error ? { error: row.error } : {}),
    folder: row.folder,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createChapterDownloadStore(database: Database.Database): ChapterDownloadStore {
  database.exec(`
    CREATE TABLE IF NOT EXISTS manga_downloads_v1 (
      id TEXT PRIMARY KEY,
      anilist_id INTEGER NOT NULL CHECK (anilist_id > 0),
      source TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_json TEXT NOT NULL,
      title TEXT NOT NULL,
      cover_url TEXT,
      status TEXT NOT NULL,
      pages_done INTEGER NOT NULL DEFAULT 0,
      pages_total INTEGER NOT NULL DEFAULT 0,
      bytes_done INTEGER NOT NULL DEFAULT 0,
      bytes_expected INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      folder TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (source, chapter_id)
    );
  `);
  const all = database.prepare<[], Row>(
    "SELECT * FROM manga_downloads_v1 ORDER BY created_at, rowid",
  );
  const byId = database.prepare<[string], Row>("SELECT * FROM manga_downloads_v1 WHERE id = ?");
  const byChapter = database.prepare<[string, string], Row>(
    "SELECT * FROM manga_downloads_v1 WHERE source = ? AND chapter_id = ?",
  );
  const insert = database.prepare(`
    INSERT INTO manga_downloads_v1 (id, anilist_id, source, chapter_id, chapter_json, title,
      cover_url, status, pages_done, pages_total, bytes_done, bytes_expected, error, folder,
      created_at, updated_at)
    VALUES (@id, @aniListId, @source, @chapterId, @chapterJson, @title, @coverUrl, @status,
      @pagesDone, @pagesTotal, @bytesDone, @bytesExpected, @error, @folder, @createdAt, @updatedAt)
  `);
  const remove = database.prepare("DELETE FROM manga_downloads_v1 WHERE id = ?");

  return {
    list: () => all.all().map(toDownload),
    get: (id) => {
      const row = byId.get(id);
      return row ? toDownload(row) : undefined;
    },
    find: (source, chapterId) => {
      const row = byChapter.get(source, chapterId);
      return row ? toDownload(row) : undefined;
    },
    insert: (item) => {
      const { source, id: chapterId, ...chapter } = item.chapter;
      insert.run({
        id: item.id,
        aniListId: item.aniListId,
        source,
        chapterId,
        chapterJson: JSON.stringify(chapter),
        title: item.title,
        coverUrl: item.coverUrl ?? null,
        status: item.status,
        pagesDone: item.pagesDone,
        pagesTotal: item.pagesTotal,
        bytesDone: item.bytesDone,
        bytesExpected: item.bytesExpected,
        error: item.error ?? null,
        folder: item.folder,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
    },
    update: (id, patch) => {
      const assignments: string[] = [];
      const values: Record<string, unknown> = { id };
      for (const [key, value] of Object.entries(patch)) {
        const column = COLUMNS[key];
        if (!column) continue;
        assignments.push(`${column} = @${key}`);
        values[key] = value === undefined ? null : value;
      }
      if (!assignments.length) return;
      database
        .prepare(`UPDATE manga_downloads_v1 SET ${assignments.join(", ")} WHERE id = @id`)
        .run(values);
    },
    remove: (id) => remove.run(id),
  };
}
