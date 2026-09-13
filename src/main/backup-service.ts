import { randomUUID } from "node:crypto";
import type { LocalBackup, RestorePreview, RestoreSummary } from "../shared/local-backup";
import type { BackupRepository } from "./backup-repository";
import { BACKUP_MAX_BYTES, parseLocalBackup } from "./backup-validation";

export interface BackupFiles {
  chooseExport(): Promise<string | undefined>;
  chooseImport(): Promise<string | undefined>;
  read(path: string): Promise<unknown>;
  write(path: string, content: string): Promise<void>;
}

export function createBackupService(
  repository: BackupRepository,
  files: BackupFiles,
  changed: () => void,
  now = Date.now,
) {
  let busy = false;
  let staged: { token: string; expires: number; backup: LocalBackup } | undefined;
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (busy) throw new Error("A backup operation is already in progress.");
    busy = true;
    try {
      return await work();
    } finally {
      busy = false;
    }
  }
  return {
    export: (): Promise<boolean> =>
      exclusive(async () => {
        const path = await files.chooseExport();
        if (!path) return false;
        const content = JSON.stringify(parseLocalBackup(repository.snapshot()), null, 2) + "\n";
        if (Buffer.byteLength(content, "utf8") > BACKUP_MAX_BYTES)
          throw new Error("Backup exceeds the 10 MiB limit.");
        try {
          await files.write(path, content);
        } catch {
          throw new Error("Could not save the backup. Choose a writable location and try again.");
        }
        return true;
      }),
    prepare: (): Promise<RestorePreview | null> =>
      exclusive(async () => {
        staged = undefined;
        const path = await files.chooseImport();
        if (!path) return null;
        let raw: unknown;
        try {
          raw = await files.read(path);
        } catch {
          throw new Error(
            "Could not read this backup. Choose a valid AniStream JSON file smaller than 10 MiB.",
          );
        }
        const backup = parseLocalBackup(raw);
        const summary = repository.preview(backup);
        const token = randomUUID();
        staged = { token, backup, expires: now() + 5 * 60_000 };
        return { token, exportedAt: backup.exportedAt, summary };
      }),
    restore: (token: string): Promise<RestoreSummary> =>
      exclusive(async () => {
        if (!staged || staged.token !== token || staged.expires <= now()) {
          throw new Error("This restore preview has expired. Choose the backup again.");
        }
        const backup = staged.backup;
        staged = undefined;
        // Recheck conflicts inside the repository's transaction: activity can change
        // while the user reviews a preview. Imported rows always belong to guest 0.
        let summary: RestoreSummary;
        try {
          summary = repository.restore(backup);
        } catch {
          throw new Error("Restore failed. No data was changed. Choose the backup again to retry.");
        }
        changed();
        return summary;
      }),
    cancel: (token: string): void => {
      if (staged?.token === token) staged = undefined;
    },
  };
}
