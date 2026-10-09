export interface ReaderSettings {
  width: 720 | 960 | 1120 | 1400;
  fit: "width" | "original";
  quality: "data" | "data-saver";
  /**
   * Ask MangaDex for image servers on the standard HTTPS port (443) only, for networks that block
   * other ports. Settings saved before this field existed read as false.
   */
  standardPortOnly: boolean;
}

export const DEFAULT_READER_SETTINGS: Readonly<ReaderSettings> = {
  width: 1120,
  fit: "width",
  quality: "data",
  standardPortOnly: false,
};

export function parseReaderSettings(value: unknown): ReaderSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid reader settings.");
  const row = value as Record<string, unknown>;
  if (
    (row.width !== 720 && row.width !== 960 && row.width !== 1120 && row.width !== 1400) ||
    (row.fit !== "width" && row.fit !== "original") ||
    (row.quality !== "data" && row.quality !== "data-saver") ||
    (row.standardPortOnly !== undefined && typeof row.standardPortOnly !== "boolean")
  )
    throw new Error("Invalid reader settings.");
  return {
    width: row.width,
    fit: row.fit,
    quality: row.quality,
    standardPortOnly: row.standardPortOnly === true,
  };
}
