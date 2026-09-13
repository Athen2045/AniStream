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
      }),
    ).toEqual([
      "C:\\Program Files\\Electron\\electron.exe",
      ["C:\\work\\AniStream\\out\\main\\index.js"],
    ]);
  });

  it("does not add development arguments to packaged or non-Windows registration", () => {
    expect(
      protocolRegistrationArgs({
        platform: "darwin",
        packaged: false,
        execPath: "/Applications/Electron.app/Contents/MacOS/Electron",
        entryPath: "/work/AniStream/out/main/index.js",
      }),
    ).toEqual([undefined, undefined]);
    expect(
      protocolRegistrationArgs({
        platform: "win32",
        packaged: true,
        execPath: "C:\\Program Files\\AniStream\\AniStream.exe",
        entryPath: "C:\\work\\AniStream\\out\\main\\index.js",
      }),
    ).toEqual([undefined, undefined]);
  });
});
