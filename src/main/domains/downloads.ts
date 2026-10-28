import { BrowserWindow, dialog } from "electron";
import { formatBytes } from "../../shared/downloads";
import type { ChapterDownloadManager } from "../downloads/chapter-download-manager";
import type { DownloadManager } from "../downloads/download-manager";
import { registerTrustedIpcHandler } from "../ipc";

/**
 * Offline downloads: state, add, pause/resume/retry/remove, settings, and folder choice. Anime
 * episodes and manga chapters share one folder and storage limit; changes go to whichever queue
 * owns the id.
 */
export function registerDownloadsDomain(
  origin: string,
  manager: DownloadManager,
  chapters?: ChapterDownloadManager,
): void {
  registerTrustedIpcHandler(origin, "downloads:state", () => manager.state());
  registerTrustedIpcHandler(origin, "downloads:add", (_event, episodes) => manager.add(episodes));
  registerTrustedIpcHandler(origin, "downloads:apply", async (_event, change) => {
    if (chapters && change.op !== "settings" && chapters.has(change.id)) {
      await chapters.apply(change.op, change.id);
      return manager.state();
    }
    return manager.apply(change);
  });
  registerTrustedIpcHandler(origin, "downloads:add-chapters", async (_event, requests) => {
    if (!chapters) throw new Error("Manga downloads are not available.");
    const { added, skipped, overLimit } = chapters.add(requests);
    const state = await manager.state();
    const message = overLimit
      ? `${overLimit} ${overLimit === 1 ? "chapter does" : "chapters do"} not fit in your ${formatBytes(state.settings.limitBytes)} download limit. Remove downloads or raise the limit.`
      : undefined;
    return { state, added, skipped, ...(message ? { message } : {}) };
  });
  registerTrustedIpcHandler(origin, "downloads:chapter-page", (_event, input) => {
    if (!chapters) throw new Error("Manga downloads are not available.");
    return chapters.offlinePage(input);
  });
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
