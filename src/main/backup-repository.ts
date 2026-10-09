import type Database from "better-sqlite3";
import type { BackupTitle, LocalBackup, RestoreSummary } from "../shared/local-backup";
import { parseLocalBackup } from "./backup-validation";
import type { BingeRepository, BingeRestorePlan } from "./binge-repository";

export interface BackupRepository {
  snapshot(): LocalBackup;
  preview(backup: LocalBackup): RestoreSummary;
  restore(backup: LocalBackup): RestoreSummary;
}

export function createBackupRepository(
  db: Database.Database,
  binge: Pick<BingeRepository, "exportBingeBackup" | "planBingeRestore" | "writeBingeRestore">,
): BackupRepository {
  const meta = db.prepare<[string], { value: string }>("SELECT value FROM app_meta WHERE key = ?");
  const existingTitle = db.prepare<[number, number, number], { id: number }>(`
    SELECT media_id AS id FROM local_activity_v1 WHERE media_id = ?
    UNION SELECT anilist_id FROM playback_resume WHERE anilist_id = ?
    UNION SELECT anilist_id FROM manga_reading_resume WHERE anilist_id = ? LIMIT 1
  `);
  const existingPreference = db.prepare(
    "SELECT 1 FROM manga_reader_preferences_v1 WHERE anilist_id = ?",
  );

  const snapshot = db.transaction((): LocalBackup => {
    const titles = new Map<number, BackupTitle>();
    const activity = db
      .prepare<
        [],
        {
          id: number;
          media: string;
          unit: number;
          state: string;
          chapterId: string | null;
          completedProgress: number;
          updatedAt: string;
        }
      >(
        `
      SELECT media_id AS id, media_json AS media, unit, state, chapter_id AS chapterId,
        completed AS completedProgress, updated_at AS updatedAt FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY media_id ORDER BY updated_at DESC, owner ASC) AS rank
        FROM local_activity_v1
      ) WHERE rank = 1 ORDER BY media_id LIMIT 10001
    `,
      )
      .all();
    for (const row of activity) {
      const media = JSON.parse(row.media) as { type: BackupTitle["type"]; title: string };
      titles.set(row.id, {
        aniListId: row.id,
        type: media.type,
        title: media.title,
        activity: {
          unit: row.unit,
          state: row.state as "started" | "completed",
          chapterId: row.chapterId ?? undefined,
          completedProgress: row.completedProgress,
          updatedAt: row.updatedAt,
        },
      });
    }
    const playback = db
      .prepare<[], NonNullable<BackupTitle["playback"]>>(
        `
      SELECT anilist_id AS aniListId, episode, position_seconds AS positionSeconds,
        duration_seconds AS durationSeconds, updated_at AS updatedAt FROM playback_resume ORDER BY anilist_id LIMIT 10001
    `,
      )
      .all();
    for (const row of playback) {
      const title = titles.get(row.aniListId) ?? {
        aniListId: row.aniListId,
        type: "ANIME",
        title: `Anime #${row.aniListId}`,
      };
      title.playback = row;
      titles.set(row.aniListId, title);
    }
    const reading = db
      .prepare<
        [],
        Omit<NonNullable<BackupTitle["reading"]>, "chapterNumber"> & {
          chapterNumber: number | null;
        }
      >(
        `
      SELECT anilist_id AS aniListId, chapter_id AS chapterId, chapter_number AS chapterNumber,
        progress, updated_at AS updatedAt FROM manga_reading_resume ORDER BY anilist_id LIMIT 10001
    `,
      )
      .all();
    for (const row of reading) {
      const title = titles.get(row.aniListId) ?? {
        aniListId: row.aniListId,
        type: "MANGA",
        title: `Manga #${row.aniListId}`,
      };
      title.reading = { ...row, chapterNumber: row.chapterNumber ?? undefined };
      titles.set(row.aniListId, title);
    }
    const settings = meta.get("reader.settings.v1");
    return parseLocalBackup({
      format: "anistream-local-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      titles: [...titles.values()],
      mangaPreferences: db
        .prepare<
          [],
          {
            aniListId: number;
            translatedLanguage: string;
            preferredGroupId: string | null;
            updatedAt: string;
          }
        >(
          `
        SELECT anilist_id AS aniListId, translated_language AS translatedLanguage,
          preferred_group_id AS preferredGroupId, updated_at AS updatedAt
        FROM manga_reader_preferences_v1 ORDER BY anilist_id LIMIT 10001
      `,
        )
        .all()
        .map((row) => ({ ...row, preferredGroupId: row.preferredGroupId ?? undefined })),
      // Release notices were removed; the empty list keeps exports restorable by older versions.
      releaseAcknowledgements: [],
      readerSettings: settings ? JSON.parse(settings.value) : null,
      upNext: binge.exportBingeBackup(),
    });
  });

  function plan(input: LocalBackup): {
    backup: LocalBackup;
    upNext: BingeRestorePlan;
    summary: RestoreSummary;
  } {
    const parsed = parseLocalBackup(input);
    const backup: LocalBackup = {
      ...parsed,
      // Keep a title's journal and checkpoints together. A completed local title must
      // never regain an old checkpoint just because its resume row was deleted.
      titles: parsed.titles.filter(
        (row) => !existingTitle.get(row.aniListId, row.aniListId, row.aniListId),
      ),
      mangaPreferences: parsed.mangaPreferences.filter(
        (row) => !existingPreference.get(row.aniListId),
      ),
      readerSettings: meta.get("reader.settings.v1") ? null : parsed.readerSettings,
    };
    // Older backups have no Up Next section; nothing is added or kept for them.
    const upNext = binge.planBingeRestore(parsed.upNext ?? { queue: [], playlists: [] });
    const summary: RestoreSummary = {
      titles: backup.titles.length,
      mangaPreferences: backup.mangaPreferences.length,
      readerSettings: backup.readerSettings !== null,
      upNextItems: upNext.queue.length,
      playlists: upNext.playlists.length,
      keptExisting:
        upNext.kept +
        parsed.titles.length -
        backup.titles.length +
        parsed.mangaPreferences.length -
        backup.mangaPreferences.length +
        Number(parsed.readerSettings !== null && backup.readerSettings === null),
    };
    return { backup, upNext, summary };
  }

  const insertActivity = db.prepare(`INSERT INTO local_activity_v1
    (owner, media_id, media_json, unit, state, chapter_id, completed, synced, updated_at, error)
    VALUES (0, ?, ?, ?, ?, ?, ?, 0, ?, NULL)`);
  const insertPlayback = db.prepare(
    "INSERT INTO playback_resume VALUES (@aniListId, @episode, @positionSeconds, @durationSeconds, @updatedAt)",
  );
  const insertReading = db.prepare(
    "INSERT INTO manga_reading_resume VALUES (@aniListId, @chapterId, @chapterNumber, @progress, @updatedAt)",
  );
  const insertPreference = db.prepare(
    "INSERT INTO manga_reader_preferences_v1 VALUES (@aniListId, @translatedLanguage, @preferredGroupId, @updatedAt)",
  );
  const restore = db.transaction((input: LocalBackup): RestoreSummary => {
    const { backup, upNext, summary } = plan(input);
    for (const row of backup.titles) {
      if (row.activity) {
        const activity = row.activity;
        insertActivity.run(
          row.aniListId,
          JSON.stringify({
            id: row.aniListId,
            type: row.type,
            title: row.title,
            coverUrl: "",
            siteUrl: `https://anilist.co/${row.type.toLowerCase()}/${row.aniListId}`,
          }),
          activity.unit,
          activity.state,
          activity.chapterId ?? null,
          activity.completedProgress,
          activity.updatedAt,
        );
      }
      if (row.playback) insertPlayback.run(row.playback);
      if (row.reading)
        insertReading.run({ ...row.reading, chapterNumber: row.reading.chapterNumber ?? null });
    }
    for (const row of backup.mangaPreferences)
      insertPreference.run({ ...row, preferredGroupId: row.preferredGroupId ?? null });
    if (backup.readerSettings)
      db.prepare("INSERT INTO app_meta VALUES ('reader.settings.v1', ?)").run(
        JSON.stringify(backup.readerSettings),
      );
    binge.writeBingeRestore(upNext);
    return summary;
  });
  return {
    snapshot,
    preview: (input) => plan(input).summary,
    restore: (input) => restore.immediate(input),
  };
}
