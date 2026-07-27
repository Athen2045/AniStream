import { readFile, unlink, writeFile } from "node:fs/promises";
import { safeStorage } from "electron";
import type { AniListProfile } from "../../shared/contracts";

export interface StoredSession {
  token: string;
  profile?: AniListProfile;
}

export interface LoadedSession {
  session: StoredSession;
  shouldReEncrypt: boolean;
}

export async function loadSession(path: string): Promise<LoadedSession> {
  const encrypted = await readFile(path);
  const decrypted = await safeStorage.decryptStringAsync(encrypted);
  return {
    session: parseStoredSession(decrypted.result),
    shouldReEncrypt: decrypted.shouldReEncrypt,
  };
}

export async function saveSession(path: string, session: StoredSession): Promise<void> {
  const payload = JSON.stringify({ version: 1, token: session.token, profile: session.profile });
  const encrypted = await safeStorage.encryptStringAsync(payload);
  await writeFile(path, encrypted, { mode: 0o600 });
}

export async function deleteSession(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (!isMissingFileError(error)) throw error;
  });
}

export function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function parseStoredSession(value: string): StoredSession {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("AniStream saved an invalid session.");
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.token !== "string" || !record.token) {
      throw new Error("AniStream saved an invalid session.");
    }
    return {
      token: record.token,
      profile: isStoredProfile(record.profile) ? record.profile : undefined,
    };
  } catch {
    if (value.trim()) return { token: value.trim() };
    throw new Error("AniStream saved an empty session.");
  }
}

function isStoredProfile(value: unknown): value is AniListProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.id === "number" &&
    typeof profile.name === "string" &&
    typeof profile.avatarUrl === "string" &&
    typeof profile.siteUrl === "string" &&
    typeof profile.animeCount === "number" &&
    typeof profile.episodesWatched === "number" &&
    typeof profile.minutesWatched === "number" &&
    typeof profile.mangaCount === "number" &&
    typeof profile.chaptersRead === "number" &&
    typeof profile.volumesRead === "number"
  );
}
