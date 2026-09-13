import { open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { BACKUP_MAX_BYTES } from "./backup-validation";

export async function readBackupFile(path: string): Promise<unknown> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > BACKUP_MAX_BYTES)
      throw new Error("Backup exceeds the 10 MiB limit or is not a regular file.");
    // Bound the read even if the selected file grows after stat().
    const buffer = Buffer.alloc(BACKUP_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > BACKUP_MAX_BYTES) throw new Error("Backup exceeds the 10 MiB limit.");
    return JSON.parse(buffer.subarray(0, length).toString("utf8")) as unknown;
  } finally {
    await file.close();
  }
}

export async function writeBackupFile(path: string, content: string): Promise<void> {
  if (Buffer.byteLength(content, "utf8") > BACKUP_MAX_BYTES)
    throw new Error("Backup exceeds the 10 MiB limit.");
  const temporary = join(dirname(path), `.anistream-backup-${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(content, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
