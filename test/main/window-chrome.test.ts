import { describe, expect, it, vi } from "vitest";
import {
  controlWindow,
  setCaptionControlsVisible,
  windowChromeOptions,
} from "../../src/main/window-chrome";

function fakeWindow(maximized = false) {
  return {
    setWindowButtonVisibility: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => maximized),
  };
}

describe("window chrome", () => {
  it("gives Windows no native caption buttons (the renderer draws its own)", () => {
    const options = windowChromeOptions("win32");
    expect(options.titleBarStyle).toBe("hidden");
    expect(options).not.toHaveProperty("titleBarOverlay");
    expect(windowChromeOptions("darwin")).toMatchObject({ titleBarOverlay: true });
  });

  it("hides the macOS traffic lights and leaves Windows to the renderer", () => {
    const window = fakeWindow();
    setCaptionControlsVisible(window, "darwin", false);
    setCaptionControlsVisible(window, "win32", false);
    expect(window.setWindowButtonVisibility.mock.calls).toEqual([[false]]);
  });

  it("minimises, toggles maximise and closes", () => {
    const window = fakeWindow();
    controlWindow(window, "minimize");
    controlWindow(window, "toggle-maximize");
    controlWindow(window, "close");
    expect(window.minimize).toHaveBeenCalledOnce();
    expect(window.maximize).toHaveBeenCalledOnce();
    expect(window.close).toHaveBeenCalledOnce();
    const maximized = fakeWindow(true);
    controlWindow(maximized, "toggle-maximize");
    expect(maximized.unmaximize).toHaveBeenCalledOnce();
  });
});
