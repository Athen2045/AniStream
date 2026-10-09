import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ipcArgValidators } from "../../src/main/ipc-validation";

const MAIN_DIR = path.resolve(__dirname, "../../src/main");

function mainSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return mainSources(file);
    return entry.name.endsWith(".ts") && entry.name !== "ipc-validation.ts" ? [file] : [];
  });
}

describe("IPC handler coverage", () => {
  it("registers a main-process handler for every validated invoke channel", () => {
    const source = mainSources(MAIN_DIR)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    // A validator without a handler means the preload bridge exposes a call that always fails
    // with "No handler registered".
    const unhandled = Object.keys(ipcArgValidators).filter(
      (channel) => !source.includes(`"${channel}"`),
    );
    expect(unhandled).toEqual([]);
  });
});
