import type { DownloadQuality } from "../../shared/downloads";

/**
 * Pure planning for an HLS episode download: which variant and audio renditions to keep, which
 * files to fetch, and the local playlists that point at them. The stream's encryption is left as
 * it is: key files are saved next to the segments and the playlists keep their `#EXT-X-KEY` tags,
 * so AniStream's player decrypts at playback exactly as when streaming.
 */
export interface HlsVariant {
  uri: string;
  bandwidth: number;
  height?: number;
  audioGroup?: string;
  /** The original `#EXT-X-STREAM-INF` attribute list. */
  attributes: string;
}

export interface HlsAudioRendition {
  groupId: string;
  name: string;
  language?: string;
  isDefault: boolean;
  uri?: string;
}

export interface HlsMaster {
  variants: HlsVariant[];
  audio: HlsAudioRendition[];
}

export interface PlannedFile {
  /** Absolute HTTPS source. */
  url: string;
  /** Path inside the episode folder, `/`-separated. */
  path: string;
}

export interface PlannedPlaylist {
  /** Folder inside the episode folder (`video`, `audio-1`, …). */
  folder: string;
  /** Local playlist text, written to `<folder>/index.m3u8`. */
  text: string;
  files: PlannedFile[];
  durationSeconds: number;
}

const QUALITY_HEIGHT: Record<DownloadQuality, number> = { "1080p": 1080, "720p": 720, "360p": 360 };
/** Original audio first, then English; the stream's default is always kept. */
const KEPT_AUDIO_LANGUAGES = ["ja", "en"];
const MAX_AUDIO_RENDITIONS = 3;
const KNOWN_SEGMENT_EXTENSIONS = new Set([
  "ts",
  "m4s",
  "mp4",
  "m4a",
  "aac",
  "mp3",
  "vtt",
  "webvtt",
]);

function attribute(list: string, name: string): string | undefined {
  const match = list.match(new RegExp(`(?:^|,)${name}=("([^"]*)"|[^,]*)`));
  if (!match) return undefined;
  return match[2] ?? match[1];
}

/** Parses a master playlist; relative URIs are resolved against `url`. */
export function parseMasterPlaylist(text: string, url: string): HlsMaster {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  if (lines[0] !== "#EXTM3U") throw new Error("The stream is not an HLS playlist.");
  const variants: HlsVariant[] = [];
  const audio: HlsAudioRendition[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const list = line.slice("#EXT-X-MEDIA:".length);
      if (attribute(list, "TYPE") !== "AUDIO") continue;
      const uri = attribute(list, "URI");
      audio.push({
        groupId: attribute(list, "GROUP-ID") ?? "",
        name: attribute(list, "NAME") ?? "Audio",
        language: attribute(list, "LANGUAGE")?.toLowerCase(),
        isDefault: attribute(list, "DEFAULT") === "YES",
        ...(uri ? { uri: new URL(uri, url).toString() } : {}),
      });
    } else if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const list = line.slice("#EXT-X-STREAM-INF:".length);
      const next = lines
        .slice(index + 1)
        .find((candidate) => candidate && !candidate.startsWith("#"));
      if (!next) continue;
      const resolution = attribute(list, "RESOLUTION")?.match(/^\d+x(\d+)$/);
      const audioGroup = attribute(list, "AUDIO");
      variants.push({
        uri: new URL(next, url).toString(),
        bandwidth: Number(attribute(list, "BANDWIDTH")) || 0,
        ...(resolution ? { height: Number(resolution[1]) } : {}),
        ...(audioGroup ? { audioGroup } : {}),
        attributes: list,
      });
    }
  }
  return { variants, audio };
}

/** The highest variant at or below the wanted height, else the lowest one available. */
export function chooseVariant(variants: HlsVariant[], quality: DownloadQuality): HlsVariant {
  if (!variants.length) throw new Error("The stream lists no video quality.");
  const target = QUALITY_HEIGHT[quality];
  const byHeight = [...variants].sort(
    (a, b) => (a.height ?? 0) - (b.height ?? 0) || a.bandwidth - b.bandwidth,
  );
  const fitting = byHeight.filter((variant) => (variant.height ?? 0) <= target);
  return fitting.at(-1) ?? byHeight[0]!;
}

/** The variant's audio renditions to keep: the default, then original Japanese and English. */
export function chooseAudio(master: HlsMaster, variant: HlsVariant): HlsAudioRendition[] {
  const group = master.audio.filter(
    (rendition) => rendition.uri && rendition.groupId === variant.audioGroup,
  );
  const kept: HlsAudioRendition[] = [];
  const add = (rendition: HlsAudioRendition | undefined): void => {
    if (rendition && !kept.includes(rendition) && kept.length < MAX_AUDIO_RENDITIONS)
      kept.push(rendition);
  };
  add(group.find((rendition) => rendition.isDefault));
  for (const language of KEPT_AUDIO_LANGUAGES)
    add(group.find((rendition) => rendition.language?.split("-")[0] === language));
  if (!kept.length) add(group[0]);
  return kept;
}

function extensionOf(url: string, fallback: string): string {
  const match = new URL(url).pathname.match(/\.([A-Za-z0-9]{2,6})$/);
  const extension = match?.[1]?.toLowerCase();
  return extension && KNOWN_SEGMENT_EXTENSIONS.has(extension) ? extension : fallback;
}

/**
 * Plans one media playlist: every segment, init map and key becomes a numbered local file and the
 * playlist is rewritten to point at them. Keys stay keys: nothing here decrypts.
 */
export function planMediaPlaylist(text: string, url: string, folder: string): PlannedPlaylist {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "#EXTM3U") throw new Error("The episode playlist is not HLS.");
  if (!lines.some((line) => line.trim() === "#EXT-X-ENDLIST"))
    throw new Error("This episode is still a live stream and cannot be downloaded yet.");
  if (lines.some((line) => line.trim().startsWith("#EXT-X-STREAM-INF")))
    throw new Error("Expected an episode playlist, got a master playlist.");
  const files: PlannedFile[] = [];
  const byUrl = new Map<string, string>();
  let segments = 0;
  let keys = 0;
  let maps = 0;
  const local = (absolute: string, kind: "segment" | "key" | "map"): string => {
    const known = byUrl.get(absolute);
    if (known) return known;
    let name: string;
    if (kind === "key") name = `k${String(++keys).padStart(3, "0")}.key`;
    else if (kind === "map") name = `init${++maps}.${extensionOf(absolute, "mp4")}`;
    else name = `s${String(++segments).padStart(5, "0")}.${extensionOf(absolute, "ts")}`;
    byUrl.set(absolute, name);
    files.push({ url: absolute, path: `${folder}/${name}` });
    return name;
  };
  let durationSeconds = 0;
  const rewritten = lines.map((raw) => {
    const line = raw.trim();
    if (!line) return raw;
    if (line.startsWith("#EXTINF:")) durationSeconds += Number.parseFloat(line.slice(8)) || 0;
    if (!line.startsWith("#")) return local(new URL(line, url).toString(), "segment");
    if (line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-SESSION-KEY:")) {
      const method = attribute(line.slice(line.indexOf(":") + 1), "METHOD");
      if (method && method !== "NONE" && method !== "AES-128")
        throw new Error("This stream uses a protection AniStream does not download.");
      return line.replace(
        /URI="([^"]+)"/,
        (_match, value: string) => `URI="${local(new URL(value, url).toString(), "key")}"`,
      );
    }
    if (line.startsWith("#EXT-X-MAP:"))
      return line.replace(
        /URI="([^"]+)"/,
        (_match, value: string) => `URI="${local(new URL(value, url).toString(), "map")}"`,
      );
    return raw;
  });
  if (!segments) throw new Error("The episode playlist has no segments.");
  return { folder, text: rewritten.join("\n"), files, durationSeconds };
}

/** The local master playlist: the kept variant and audio renditions, pointing at local folders. */
export function localMasterPlaylist(
  variant: HlsVariant,
  audio: { rendition: HlsAudioRendition; folder: string }[],
  videoFolder: string,
): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  for (const [index, { rendition, folder }] of audio.entries()) {
    const parts = [
      "TYPE=AUDIO",
      'GROUP-ID="audio"',
      `NAME="${rendition.name.replace(/"/g, "'")}"`,
      ...(rendition.language ? [`LANGUAGE="${rendition.language}"`] : []),
      `DEFAULT=${index === 0 ? "YES" : "NO"}`,
      "AUTOSELECT=YES",
      `URI="${folder}/index.m3u8"`,
    ];
    lines.push(`#EXT-X-MEDIA:${parts.join(",")}`);
  }
  const attributes = audio.length
    ? variant.audioGroup
      ? variant.attributes.replace(/AUDIO="[^"]*"/, 'AUDIO="audio"')
      : `${variant.attributes},AUDIO="audio"`
    : variant.attributes.replace(/,?AUDIO="[^"]*"/, "");
  lines.push(`#EXT-X-STREAM-INF:${attributes}`, `${videoFolder}/index.m3u8`);
  return `${lines.join("\n")}\n`;
}
