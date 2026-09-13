export interface ProtocolRegistrationInput {
  platform: NodeJS.Platform;
  packaged: boolean;
  execPath: string;
  entryPath: string;
}

export function protocolRegistrationArgs(
  input: ProtocolRegistrationInput,
): [executable?: string, args?: string[]] {
  if (input.platform === "win32" && !input.packaged) {
    return [input.execPath, [input.entryPath]];
  }
  return [undefined, undefined];
}
