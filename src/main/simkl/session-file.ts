import { readFile, writeFile } from "node:fs/promises";
import { safeStorage } from "electron";
import { deleteSession, isMissingFileError } from "../anilist/session-store";
import { simklAvatarUrl, type SimklSession, type SimklSessionStorage } from "./client";

/** Simkl tokens encrypted with the OS keystore (DPAPI on Windows, Keychain on macOS). */
export function simklSessionFile(path: string): SimklSessionStorage {
  return {
    async load() {
      let encrypted: Buffer;
      try {
        encrypted = await readFile(path);
      } catch (error) {
        if (isMissingFileError(error)) return undefined;
        throw error;
      }
      const { result } = await safeStorage.decryptStringAsync(encrypted);
      return parseSession(result);
    },
    async save(session) {
      const payload = JSON.stringify({ version: 1, ...session });
      await writeFile(path, await safeStorage.encryptStringAsync(payload), { mode: 0o600 });
    },
    remove: () => deleteSession(path),
  };
}

function parseSession(value: string): SimklSession {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (
    typeof parsed.accessToken !== "string" ||
    typeof parsed.refreshToken !== "string" ||
    typeof parsed.expiresAt !== "number"
  )
    throw new Error("AniStream saved an invalid Simkl session.");
  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt: parsed.expiresAt,
    userName: typeof parsed.userName === "string" ? parsed.userName : undefined,
    // Scope and account type gate "+" writes and Custom Lists; keep them across restarts.
    scope: typeof parsed.scope === "string" ? parsed.scope.slice(0, 200) : undefined,
    accountId:
      typeof parsed.accountId === "number" && Number.isInteger(parsed.accountId)
        ? parsed.accountId
        : undefined,
    accountType: typeof parsed.accountType === "string" ? parsed.accountType : undefined,
    avatarUrl: simklAvatarUrl(parsed.avatarUrl),
    joinedAt: typeof parsed.joinedAt === "string" ? parsed.joinedAt : undefined,
    profileCheckedAt:
      typeof parsed.profileCheckedAt === "number" ? parsed.profileCheckedAt : undefined,
  };
}
