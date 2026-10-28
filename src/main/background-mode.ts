import { app, dialog, Menu, nativeImage, Notification, Tray, type BrowserWindow } from "electron";
import { DEFAULT_BACKGROUND_PREFERENCES, type BackgroundPreferences } from "../shared/background";

/**
 * What closing the window does: `close` quits as before, `hide` keeps AniStream running in the
 * tray, `ask` asks first (downloads still running and no remembered choice). A real quit (the tray's
 * Quit, an update install, the OS shutting down) always closes. macOS keeps its own behaviour: the
 * app stays in the Dock when its window closes, so downloads already continue there.
 */
export type CloseAction = "close" | "hide" | "ask";

export function decideClose(input: {
  quitting: boolean;
  platform: NodeJS.Platform;
  preferences: BackgroundPreferences;
  /** Downloads queued or in progress. */
  activeDownloads: number;
}): CloseAction {
  if (input.quitting || input.platform === "darwin") return "close";
  if (input.preferences.keepRunning) return "hide";
  if (input.activeDownloads === 0) return "close";
  if (input.preferences.whileDownloading === "background") return "hide";
  if (input.preferences.whileDownloading === "quit") return "close";
  return "ask";
}

/**
 * Hidden only for downloads (not by the keep-running setting): quit once the queue is empty, so the
 * tray does not linger after what it stayed for.
 */
export function shouldQuitWhenIdle(input: {
  hiddenForDownloads: boolean;
  windowVisible: boolean;
  activeDownloads: number;
}): boolean {
  return input.hiddenForDownloads && !input.windowVisible && input.activeDownloads === 0;
}

export interface BackgroundModeDeps {
  window(): BrowserWindow | undefined;
  preferences(): BackgroundPreferences;
  savePreferences(preferences: BackgroundPreferences): void;
  activeDownloads(): number;
  /** Downloads that ended failed, for the "finished" notice. */
  failedDownloads(): number;
  /** Tells the renderer its window went to the tray (players stop). */
  onHidden(): void;
}

/**
 * The opt-in background mode for Windows: closing hides the window to the system tray instead of
 * quitting, by the keep-running setting or (asked or remembered) while downloads run. The tray
 * offers Open and Quit; hidden only for downloads, AniStream quits once they finish.
 */
export class BackgroundMode {
  private quitting = false;
  private tray: Tray | undefined;
  private hiddenForDownloads = false;
  private lastCount = -1;
  private announced = false;

  constructor(private readonly deps: BackgroundModeDeps) {}

  /** The saved choice; the default (quit as before) when it cannot be read. */
  preferencesNow(): BackgroundPreferences {
    try {
      return this.deps.preferences();
    } catch {
      return { ...DEFAULT_BACKGROUND_PREFERENCES };
    }
  }

  /** A real quit is under way (the tray's Quit, an update install, the OS shutting down). */
  markQuitting(): void {
    this.quitting = true;
  }

  /** The window's `close` handler. */
  handleClose(event: Electron.Event): void {
    // A real quit closes without reading anything: the database may already be closed by then.
    if (this.quitting || process.platform === "darwin") return;
    const preferences = this.preferencesNow();
    const action = decideClose({
      quitting: this.quitting,
      platform: process.platform,
      preferences,
      activeDownloads: this.deps.activeDownloads(),
    });
    if (action === "close") return;
    event.preventDefault();
    if (action === "hide") void this.hide(!preferences.keepRunning);
    else void this.ask(preferences);
  }

  show(): void {
    const window = this.deps.window();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    this.hiddenForDownloads = false;
  }

  /** Called when downloads change: the tray's status line, and quitting once they are done. */
  downloadsChanged(): void {
    if (this.quitting) return;
    const count = this.deps.activeDownloads();
    if (count !== this.lastCount) {
      this.lastCount = count;
      this.refreshTray();
    }
    const window = this.deps.window();
    if (
      shouldQuitWhenIdle({
        hiddenForDownloads: this.hiddenForDownloads,
        windowVisible: Boolean(window?.isVisible()),
        activeDownloads: count,
      })
    ) {
      const failed = this.deps.failedDownloads();
      if (Notification.isSupported())
        new Notification({
          title: "AniStream finished downloading",
          body: failed
            ? `${failed} ${failed === 1 ? "episode" : "episodes"} could not be downloaded. Open Downloads to retry.`
            : "Your episodes are ready to watch offline.",
        }).show();
      this.quit();
    }
  }

  dispose(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }

  private quit(): void {
    this.quitting = true;
    app.quit();
  }

  private async ask(preferences: BackgroundPreferences): Promise<void> {
    const window = this.deps.window();
    const count = this.deps.activeDownloads();
    const options: Electron.MessageBoxOptions = {
      type: "question",
      title: "Downloads are still running",
      message: "Keep downloading in the background?",
      detail: `${count} ${count === 1 ? "episode is" : "episodes are"} still downloading. AniStream can finish ${count === 1 ? "it" : "them"} from the system tray and quit when done. If you quit now, downloads continue the next time you open AniStream.`,
      buttons: ["Keep downloading", "Quit", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: "Remember my choice",
    };
    const { response, checkboxChecked } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    if (response === 2) return;
    if (checkboxChecked)
      this.deps.savePreferences({
        ...preferences,
        whileDownloading: response === 0 ? "background" : "quit",
      });
    if (response === 0) await this.hide(true);
    else this.quit();
  }

  private async hide(forDownloads: boolean): Promise<void> {
    const window = this.deps.window();
    if (!window) return;
    this.hiddenForDownloads = forDownloads;
    await this.ensureTray();
    this.deps.onHidden();
    window.hide();
    if (!this.announced && process.platform === "win32") {
      this.announced = true;
      this.tray?.displayBalloon({
        title: "AniStream is still running",
        content: forDownloads
          ? "Downloads continue here. AniStream quits when they finish."
          : "Open it again from here. Quit from this icon's menu.",
        iconType: "info",
      });
    }
  }

  private async ensureTray(): Promise<void> {
    if (this.tray) return;
    const icon = await app
      .getFileIcon(process.execPath, { size: "small" })
      .catch(() => nativeImage.createEmpty());
    this.tray = new Tray(icon);
    this.tray.on("click", () => this.show());
    this.lastCount = -1;
    this.refreshTray();
  }

  private refreshTray(): void {
    if (!this.tray) return;
    const count = this.deps.activeDownloads();
    const status = count
      ? `Downloading ${count} ${count === 1 ? "episode" : "episodes"}`
      : "No downloads running";
    this.tray.setToolTip(`AniStream · ${status}`);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: status, enabled: false },
        { type: "separator" },
        { label: "Open AniStream", click: () => this.show() },
        { label: "Quit AniStream", click: () => this.quit() },
      ]),
    );
  }
}
