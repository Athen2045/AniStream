import { win32 } from "node:path";

export interface ProtocolRegistrationInput {
  platform: NodeJS.Platform;
  packaged: boolean;
  execPath: string;
  entryPath: string;
  /** Directory a relative entry path is resolved against (the dev launcher passes "."). */
  cwd: string;
}

export function protocolRegistrationArgs(
  input: ProtocolRegistrationInput,
): [executable?: string, args?: string[]] {
  if (input.platform === "win32" && !input.packaged) {
    // Windows starts the protocol handler from System32, so a relative entry such as electron-vite's
    // "." must be made absolute here or Electron cannot find the app.
    return [input.execPath, [win32.resolve(input.cwd, input.entryPath)]];
  }
  return [undefined, undefined];
}
