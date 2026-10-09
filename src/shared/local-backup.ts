import type { MangaReaderPreferences, MangaReadingResume, PlaybackResume } from "./contracts";
import type { ReaderSettings } from "./reader-settings";
import type { BingeItem } from "./binge";

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
  /** Always empty: kept so exports stay restorable by versions that still had release notices. */
  releaseAcknowledgements: [];
  readerSettings: ReaderSettings | null;
  /** Up Next and playlists; absent in files from versions before 2026-10-06. */
  upNext?: BackupUpNext;
}

export interface BackupBingeEntry {
  item: BingeItem;
  addedAt: string;
}

export interface BackupPlaylist {
  name: string;
  updatedAt: string;
  entries: BackupBingeEntry[];
}

export interface BackupUpNext {
  queue: BackupBingeEntry[];
  playlists: BackupPlaylist[];
}

export interface RestoreSummary {
  titles: number;
  mangaPreferences: number;
  readerSettings: boolean;
  /** Up Next titles added after the ones already queued. */
  upNextItems: number;
  /** Playlists added; a playlist with the same name as an existing one is kept as it is. */
  playlists: number;
  keptExisting: number;
}

export interface RestorePreview {
  token: string;
  exportedAt: string;
  summary: RestoreSummary;
}
