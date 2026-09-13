import { BrowserWindow, dialog } from "electron";
import type { BackupRepository } from "../backup-repository";
import { createBackupService } from "../backup-service";
import { readBackupFile, writeBackupFile } from "../backup-files";
import { registerTrustedIpcHandler } from "../ipc";

export function registerBackupDomain(
  origin: string,
  repository: BackupRepository,
  changed: () => void,
): void {
  const service = createBackupService(
    repository,
    {
      chooseExport: async () => {
        const parent = BrowserWindow.getFocusedWindow();
        if (!parent) throw new Error("Return to AniStream to save a backup.");
        const result = await dialog.showSaveDialog(parent, {
          title: "Export local progress",
          defaultPath: `AniStream-backup-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: "AniStream backup", extensions: ["json"] }],
          properties: ["createDirectory"],
        });
        return result.canceled ? undefined : result.filePath;
      },
      chooseImport: async () => {
        const parent = BrowserWindow.getFocusedWindow();
        if (!parent) throw new Error("Return to AniStream to choose a backup.");
        const result = await dialog.showOpenDialog(parent, {
          title: "Restore local progress",
          filters: [{ name: "AniStream backup", extensions: ["json"] }],
          properties: ["openFile"],
        });
        return result.canceled ? undefined : result.filePaths[0];
      },
      read: readBackupFile,
      write: writeBackupFile,
    },
    changed,
  );
  registerTrustedIpcHandler(origin, "backup:export", () => service.export());
  registerTrustedIpcHandler(origin, "backup:prepare", () => service.prepare());
  registerTrustedIpcHandler(origin, "backup:restore", (_event, token) => service.restore(token));
  registerTrustedIpcHandler(origin, "backup:cancel", (_event, token) => service.cancel(token));
}
