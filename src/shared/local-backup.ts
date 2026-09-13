import type { MangaReaderPreferences, MangaReadingResume, PlaybackResume } from "./contracts";
import type { ReaderSettings } from "./reader-settings";

/** Portable, app-owned data only. Account identity and sync state are deliberately absent. */
export interface BackupTitle {
  aniListId: number;
  type: "ANIME" | "MANGA";
  title: string;
  activity?: {
    unit: number;
    state: "started" | "completed";
    chapterId?: string;
    completedProgress: number;
    updatedAt: string;
  };
  playback?: PlaybackResume;
  reading?: MangaReadingResume;
}

export interface LocalBackup {
  format: "anistream-local-backup";
  version: 1;
  exportedAt: string;
  titles: BackupTitle[];
  mangaPreferences: MangaReaderPreferences[];
  releaseAcknowledgements: { key: string; unit: number }[];
  readerSettings: ReaderSettings | null;
}

export interface RestoreSummary {
  titles: number;
  mangaPreferences: number;
  releaseAcknowledgements: number;
  readerSettings: boolean;
  keptExisting: number;
}

export interface RestorePreview {
  token: string;
  exportedAt: string;
  summary: RestoreSummary;
}
