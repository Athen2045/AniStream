import { describe, expect, it, vi } from "vitest";
import { setCaptionControlsVisible } from "../../src/main/window-chrome";

function fakeWindow() {
  return { setTitleBarOverlay: vi.fn(), setWindowButtonVisibility: vi.fn() };
}

describe("caption controls visibility", () => {
  it("turns the Windows caption glyphs transparent and back", () => {
    const window = fakeWindow();
    setCaptionControlsVisible(window, "win32", false);
    setCaptionControlsVisible(window, "win32", true);
    expect(window.setTitleBarOverlay.mock.calls).toEqual([
      [{ color: "#00000000", symbolColor: "#00000000", height: 48 }],
      [{ color: "#00000000", symbolColor: "#f3f5f7", height: 48 }],
    ]);
    expect(window.setWindowButtonVisibility).not.toHaveBeenCalled();
  });

  it("hides the macOS traffic lights", () => {
    const window = fakeWindow();
    setCaptionControlsVisible(window, "darwin", false);
    expect(window.setWindowButtonVisibility).toHaveBeenCalledWith(false);
    expect(window.setTitleBarOverlay).not.toHaveBeenCalled();
  });
});
