import { execFile } from "node:child_process";
import { promisify } from "node:util";

const ANILIST_KEYCHAIN_SERVICE = "dev.anistream.desktop.anilist-client";
const ANILIST_KEYCHAIN_ACCOUNT = "AniStream";
const execFileAsync = promisify(execFile);

export async function readClientSecretFromKeychain(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-a",
        ANILIST_KEYCHAIN_ACCOUNT,
        "-s",
        ANILIST_KEYCHAIN_SERVICE,
        "-w",
      ],
      {
        encoding: "utf8",
        maxBuffer: 4_096,
      },
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function deleteClientSecretFromKeychain(): Promise<void> {
  try {
    await execFileAsync(
      "/usr/bin/security",
      ["delete-generic-password", "-a", ANILIST_KEYCHAIN_ACCOUNT, "-s", ANILIST_KEYCHAIN_SERVICE],
      {
        encoding: "utf8",
        maxBuffer: 4_096,
      },
    );
  } catch {
    // A missing Keychain item already leaves the app in the desired state.
  }
}

export function isClientAuthenticationFailure(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLocaleLowerCase();
  return normalized.includes("client authentication") || normalized.includes("invalid_client");
}

export async function ensureClientSecret(): Promise<string> {
  const existingSecret = await readClientSecretFromKeychain();
  if (existingSecret) return existingSecret;

  const clientSecret = await promptForClientSecret();
  await execFileAsync(
    "/usr/bin/security",
    [
      "add-generic-password",
      "-U",
      "-a",
      ANILIST_KEYCHAIN_ACCOUNT,
      "-s",
      ANILIST_KEYCHAIN_SERVICE,
      "-w",
      clientSecret,
    ],
    {
      encoding: "utf8",
      maxBuffer: 4_096,
    },
  );
  return clientSecret;
}

async function promptForClientSecret(): Promise<string> {
  const promptScript = [
    'set promptResult to display dialog "Enter the client secret from AniList Developer Settings. It will be stored in macOS Keychain and is required only for this personal OAuth client." default answer "" with hidden answer buttons {"Cancel", "Save"} default button "Save" cancel button "Cancel" with title "AniStream"',
    "text returned of promptResult",
  ];

  try {
    const args = promptScript.flatMap((line) => ["-e", line]);
    const { stdout } = await execFileAsync("/usr/bin/osascript", args, {
      encoding: "utf8",
      maxBuffer: 4_096,
    });
    const clientSecret = stdout.trim();
    if (clientSecret.length < 20 || clientSecret.length > 256) {
      throw new Error("The AniList client secret does not look valid.");
    }
    return clientSecret;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "The AniList client secret does not look valid."
    ) {
      throw error;
    }
    throw new Error("AniList connection was cancelled before the client secret was saved.", {
      cause: error,
    });
  }
}
