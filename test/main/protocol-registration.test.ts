import { describe, expect, it } from "vitest";
import { protocolRegistrationArgs } from "../../src/main/protocol-registration";

describe("AniStream protocol registration", () => {
  it("passes the Electron executable and entry point in Windows development", () => {
    expect(
      protocolRegistrationArgs({
        platform: "win32",
        packaged: false,
        execPath: "C:\\Program Files\\Electron\\electron.exe",
        entryPath: "C:\\work\\AniStream\\out\\main\\index.js",
        cwd: "C:\\work\\AniStream",
      }),
    ).toEqual([
      "C:\\Program Files\\Electron\\electron.exe",
      ["C:\\work\\AniStream\\out\\main\\index.js"],
    ]);
  });

  it("makes the dev launcher's relative entry absolute, since Windows starts handlers in System32", () => {
    expect(
      protocolRegistrationArgs({
        platform: "win32",
        packaged: false,
        execPath: "C:\\work\\AniStream\\node_modules\\electron\\dist\\electron.exe",
        entryPath: ".",
        cwd: "C:\\work\\AniStream",
      })[1],
    ).toEqual(["C:\\work\\AniStream"]);
  });

  it("does not add development arguments to packaged or non-Windows registration", () => {
    expect(
      protocolRegistrationArgs({
        platform: "darwin",
        packaged: false,
        execPath: "/Applications/Electron.app/Contents/MacOS/Electron",
        entryPath: "/work/AniStream/out/main/index.js",
        cwd: "/work/AniStream",
      }),
    ).toEqual([undefined, undefined]);
    expect(
      protocolRegistrationArgs({
        platform: "win32",
        packaged: true,
        execPath: "C:\\Program Files\\AniStream\\AniStream.exe",
        entryPath: "C:\\work\\AniStream\\out\\main\\index.js",
        cwd: "C:\\work\\AniStream",
      }),
    ).toEqual([undefined, undefined]);
  });
});
