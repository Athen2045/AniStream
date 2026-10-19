import { BrowserWindow, dialog } from "electron";
import type { DownloadManager } from "../downloads/download-manager";
import { registerTrustedIpcHandler } from "../ipc";

/** Offline anime downloads: state, add, pause/resume/retry/remove, settings, and folder choice. */
export function registerDownloadsDomain(origin: string, manager: DownloadManager): void {
  registerTrustedIpcHandler(origin, "downloads:state", () => manager.state());
  registerTrustedIpcHandler(origin, "downloads:add", (_event, episodes) => manager.add(episodes));
  registerTrustedIpcHandler(origin, "downloads:apply", (_event, change) => manager.apply(change));
  registerTrustedIpcHandler(origin, "downloads:choose-folder", async () => {
    const parent = BrowserWindow.getFocusedWindow();
    if (!parent) throw new Error("Return to AniStream to choose a folder.");
    const current = (await manager.state()).settings.folder;
    const result = await dialog.showOpenDialog(parent, {
      title: "Choose where AniStream saves downloads",
      defaultPath: current,
      properties: ["openDirectory", "createDirectory"],
    });
    const folder = result.canceled ? undefined : result.filePaths[0];
    return folder ? manager.setFolder(folder) : null;
  });
}
