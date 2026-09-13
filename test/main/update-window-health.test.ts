import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { UpdateLaunch } from "../../src/main/update-launch";
import { trackUpdateWindowHealth } from "../../src/main/update-window-health";

afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers();
  const store = { read: () => ({ attempts: 0 }), write: vi.fn() };
  const launch = new UpdateLaunch(store, "0.1.4", true);
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => false,
  });
  trackUpdateWindowHealth(window as unknown as BrowserWindow, launch);
  return { store, window, contents, launch };
}
it("confirms the app even while the embedded player starts loading", async () => {
  const { store, contents } = setup();
  contents.emit("did-finish-load");
  await vi.advanceTimersByTimeAsync(4000);
  contents.emit("did-start-loading");
  contents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
  contents.emit("did-fail-load", {}, -1, "frame failure", "", false);
  contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
  await vi.advanceTimersByTimeAsync(4000);
  expect(store.write).toHaveBeenLastCalledWith({ lastGoodVersion: "0.1.4", attempts: 0 });
});
it("restarts the eight-second window after main document navigation", async () => {
  const { store, contents } = setup();
  contents.emit("did-finish-load");
  await vi.advanceTimersByTimeAsync(4000);
  contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  await vi.advanceTimersByTimeAsync(8000);
  expect(store.write).toHaveBeenCalledTimes(1);
  contents.emit("did-finish-load");
  await vi.advanceTimersByTimeAsync(8000);
  expect(store.write).toHaveBeenCalledTimes(2);
});
it.each(["close", "closed", "unresponsive", "render-process-gone", "did-fail-load"])(
  "does not confirm after %s",
  async (event) => {
    const { store, contents, window } = setup();
    contents.emit("did-finish-load");
    if (event === "did-fail-load") contents.emit(event, {}, -1, "load failure", "", true);
    else if (event === "render-process-gone") contents.emit(event);
    else window.emit(event);
    await vi.advanceTimersByTimeAsync(8000);
    expect(store.write).toHaveBeenCalledTimes(1);
    if (event !== "unresponsive") {
      window.emit("responsive");
      await vi.advanceTimersByTimeAsync(8000);
      expect(store.write).toHaveBeenCalledTimes(1);
    }
  },
);
it("requires a loaded document before responsiveness can start the timer", async () => {
  const { store, window, contents } = setup();
  window.emit("responsive");
  await vi.advanceTimersByTimeAsync(8000);
  expect(store.write).toHaveBeenCalledTimes(1);
  contents.emit("did-finish-load");
  window.emit("unresponsive");
  window.emit("responsive");
  await vi.advanceTimersByTimeAsync(8000);
  expect(store.write).toHaveBeenCalledTimes(2);
});
