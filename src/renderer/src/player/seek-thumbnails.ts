import Hls from "hls.js";

/** Frames are kept per bucket of this many seconds. */
const BUCKET_SECONDS = 5;
const MAX_FRAMES = 240;
export const THUMB_WIDTH = 192;
export const THUMB_HEIGHT = 108;

/**
 * Seek-bar previews for the own player: a second, muted copy of the stream at its lowest quality
 * seeks to the hovered time and its frame is copied into a small canvas. Frames are kept per
 * 5-second bucket, so moving back over the bar costs nothing. Starts loading only on first use.
 */
export class SeekThumbnails {
  private video: HTMLVideoElement | null = null;
  private hls: Hls | null = null;
  private readonly frames = new Map<number, HTMLCanvasElement>();
  private target: number | null = null;
  private seeking = false;
  private listener: ((frame: HTMLCanvasElement, time: number) => void) | null = null;

  public constructor(private readonly streamUrl: string) {}

  /** Asks for the frame near `time`; `onFrame` gets it now (cached) or once it is decoded. */
  public request(time: number, onFrame: (frame: HTMLCanvasElement, time: number) => void): void {
    if (!Number.isFinite(time) || time < 0) return;
    this.listener = onFrame;
    const bucket = Math.floor(time / BUCKET_SECONDS) * BUCKET_SECONDS;
    const cached = this.frames.get(bucket);
    if (cached) {
      onFrame(cached, bucket);
      return;
    }
    this.target = bucket;
    this.start();
    this.seekNext();
  }

  /** Stops the preview copy; a later request starts it again. */
  public dispose(): void {
    this.listener = null;
    this.target = null;
    this.seeking = false;
    this.hls?.destroy();
    this.hls = null;
    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
    }
    this.video = null;
    this.frames.clear();
  }

  private start(): void {
    if (this.video || !Hls.isSupported()) return;
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.addEventListener("seeked", () => this.capture());
    video.addEventListener("loadeddata", () => this.seekNext());
    // Only the lowest rendition, with a tiny buffer: previews need one frame, not playback.
    const hls = new Hls({
      enableWorker: true,
      startLevel: 0,
      autoStartLoad: true,
      maxBufferLength: 2,
      maxMaxBufferLength: 4,
      backBufferLength: 0,
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      hls.autoLevelCapping = 0;
      hls.currentLevel = 0;
    });
    hls.loadSource(this.streamUrl);
    hls.attachMedia(video);
    this.video = video;
    this.hls = hls;
  }

  private seekNext(): void {
    const video = this.video;
    if (!video || this.seeking || this.target === null || video.readyState < 1) return;
    this.seeking = true;
    video.currentTime = this.target;
  }

  private capture(): void {
    const video = this.video;
    this.seeking = false;
    if (!video || this.target === null) return;
    const bucket = Math.floor(video.currentTime / BUCKET_SECONDS) * BUCKET_SECONDS;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      const canvas = document.createElement("canvas");
      canvas.width = THUMB_WIDTH;
      canvas.height = THUMB_HEIGHT;
      canvas.getContext("2d")?.drawImage(video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
      this.frames.set(bucket, canvas);
      const oldest = this.frames.keys().next();
      if (this.frames.size > MAX_FRAMES && !oldest.done) this.frames.delete(oldest.value);
      if (bucket === this.target) this.listener?.(canvas, bucket);
    }
    // The pointer moved on while this frame decoded: go to the newest wish.
    if (this.target !== bucket) this.seekNext();
    else this.target = null;
  }
}
