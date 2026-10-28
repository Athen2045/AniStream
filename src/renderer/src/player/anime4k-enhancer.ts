/**
 * Anime4K for the own player (prototype, user request 2026-10-28): the anime4k-webgpu port's
 * compute shaders sharpen and upscale each video frame on this device's GPU, drawn to a canvas
 * laid over the <video>. Nothing leaves the device. The package's own `render()` cannot be stopped
 * or resized, so this drives its pipelines directly: one frame in per decoded video frame, a
 * rebuild when the picture or the window changes size, and timing so a GPU that cannot keep up is
 * noticed instead of stuttering.
 */

/**
 * The anime4k-webgpu package (MIT, 1.0.0) was removed while the experiment is on hold
 * (2026-10-28). These are the parts of its API used here; reinstall `anime4k-webgpu@1.0.0` to
 * resume. Until then it is imported only at run time, so a switched-on experiment reports that the
 * library is missing instead of breaking the build.
 */
const LIBRARY = "anime4k-webgpu";
interface Anime4KPipeline {
  pass(encoder: GPUCommandEncoder): void;
  getOutputTexture(): GPUTexture;
}
type PipelineClass = new (options: {
  device: GPUDevice;
  inputTexture: GPUTexture;
}) => Anime4KPipeline;
type PresetClass = new (options: {
  device: GPUDevice;
  inputTexture: GPUTexture;
  nativeDimensions: { width: number; height: number };
  targetDimensions: { width: number; height: number };
}) => Anime4KPipeline;
interface Anime4KLibrary {
  CNNM: PipelineClass;
  CNNx2M: PipelineClass;
  ModeA: PresetClass;
  ModeB: PresetClass;
  ModeC: PresetClass;
}

/** Off; Light: one fast pass (×2 upscale, or a line restore when the picture is not enlarged);
 * Strong: the upstream preset for the source size (Mode A for 1080p, B for 720p, C below). */
export type EnhanceMode = "off" | "light" | "strong";

export interface EnhancerStats {
  /** Which pipeline runs, e.g. "Mode B (720p → 2160p)". */
  pipeline: string;
  /** Frames enhanced since the last (re)build. */
  frames: number;
  /** Average GPU time per frame (submit to done) over the last frames, in milliseconds. */
  gpuMs: number;
  /** The longest of those. */
  worstMs: number;
}

export interface EnhancerOptions {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  mode: Exclude<EnhanceMode, "off">;
  onStats?: (stats: EnhancerStats) => void;
  /** The GPU cannot keep up or WebGPU failed: the caller shows the plain video again. */
  onFail: (reason: string) => void;
}

/** WebGPU's texture usage flags (the DOM types here do not declare the `GPUTextureUsage` global). */
const COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;
const RENDER_ATTACHMENT = 0x10;

/** Frames averaged for the timing. */
const WINDOW = 48;
/** Too slow: the GPU needs more than this share of a frame's time, for a whole window. */
const SLOW_SHARE = 0.85;

const BLIT_WGSL = `
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vert(@builtin(vertex_index) i: u32) -> Out {
  var corners = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
  let p = corners[i];
  return Out(vec4f(p, 0, 1), vec2f((p.x + 1) / 2, (1 - p.y) / 2));
}
@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var frame: texture_2d<f32>;
@fragment fn frag(input: Out) -> @location(0) vec4f {
  return vec4f(textureSample(frame, linearSampler, input.uv).rgb, 1);
}`;

export function webGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Starts enhancing; returns a stop function. Rejects when WebGPU cannot start. */
export async function startEnhancer(options: EnhancerOptions): Promise<() => void> {
  const { video, canvas, mode, onStats, onFail } = options;
  if (!webGpuAvailable()) throw new Error("This device has no WebGPU.");
  const library = (await import(/* @vite-ignore */ LIBRARY).catch(() => {
    throw new Error("The Anime4K library is not installed.");
  })) as Anime4KLibrary;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No GPU adapter is available.");
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
  if (!context) throw new Error("The canvas has no WebGPU context.");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const blitModule = device.createShaderModule({ code: BLIT_WGSL });
  const blit = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: blitModule, entryPoint: "vert" },
    fragment: { module: blitModule, entryPoint: "frag", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  let stopped = false;
  let frameRequest: number | undefined;
  let built:
    | {
        width: number;
        height: number;
        targetWidth: number;
        targetHeight: number;
        input: GPUTexture;
        pipeline: Anime4KPipeline;
        bindGroup: GPUBindGroup;
        label: string;
      }
    | undefined;
  let timings: number[] = [];
  let frames = 0;
  let slowWindows = 0;

  const fail = (reason: string): void => {
    if (stopped) return;
    stop();
    onFail(reason);
  };
  void device.lost.then((info) => fail(`The GPU stopped (${info.reason || "lost"}).`));

  /** The canvas matches the picture's on-screen size in device pixels (object-fit: contain). */
  const targetSize = (): { width: number; height: number } => {
    const box = video.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const sourceRatio = video.videoWidth / video.videoHeight || 16 / 9;
    const boxWidth = box.width * scale;
    const boxHeight = box.height * scale;
    const width = Math.min(boxWidth, boxHeight * sourceRatio);
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(width / sourceRatio)),
    };
  };

  const build = (): void => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;
    const target = targetSize();
    built?.input.destroy();
    const input = device.createTexture({
      size: [width, height, 1],
      format: "rgba16float",
      usage: TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT,
    });
    const enlarged = target.height > height * 1.1;
    let pipeline: Anime4KPipeline;
    let label: string;
    if (mode === "light") {
      pipeline = enlarged
        ? new library.CNNx2M({ device, inputTexture: input })
        : new library.CNNM({ device, inputTexture: input });
      label = enlarged ? `Light ×2 (${height}p → ${height * 2}p)` : `Light restore (${height}p)`;
    } else {
      const descriptor = {
        device,
        inputTexture: input,
        nativeDimensions: { width, height },
        targetDimensions: { width: target.width, height: target.height },
      };
      const Preset = height >= 900 ? library.ModeA : height >= 600 ? library.ModeB : library.ModeC;
      pipeline = new Preset(descriptor);
      const name = height >= 900 ? "A" : height >= 600 ? "B" : "C";
      label = `Mode ${name} (${height}p → ${target.height}p)`;
    }
    canvas.width = target.width;
    canvas.height = target.height;
    const bindGroup = device.createBindGroup({
      layout: blit.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: pipeline.getOutputTexture().createView() },
      ],
    });
    built = {
      width,
      height,
      targetWidth: target.width,
      targetHeight: target.height,
      input,
      pipeline,
      bindGroup,
      label,
    };
    timings = [];
    frames = 0;
    slowWindows = 0;
  };

  const draw = (): void => {
    if (stopped) return;
    if (!built || built.width !== video.videoWidth || built.height !== video.videoHeight) build();
    if (!built) return;
    const current = built;
    device.queue.copyExternalImageToTexture({ source: video }, { texture: current.input }, [
      current.width,
      current.height,
    ]);
    const encoder = device.createCommandEncoder();
    current.pipeline.pass(encoder);
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(blit);
    pass.setBindGroup(0, current.bindGroup);
    pass.draw(6);
    pass.end();
    const submitted = performance.now();
    device.queue.submit([encoder.finish()]);
    void device.queue.onSubmittedWorkDone().then(() => {
      if (stopped || current !== built) return;
      timings.push(performance.now() - submitted);
      frames += 1;
      if (timings.length < WINDOW) return;
      const gpuMs = timings.reduce((sum, ms) => sum + ms, 0) / timings.length;
      onStats?.({ pipeline: current.label, frames, gpuMs, worstMs: Math.max(...timings) });
      // Anime runs at about 24 frames a second; a GPU that cannot finish one in time falls behind.
      const frameMs = 1000 / 24 / Math.max(1, video.playbackRate);
      slowWindows = !video.paused && gpuMs > frameMs * SLOW_SHARE ? slowWindows + 1 : 0;
      timings = [];
      if (slowWindows >= 3) fail("This GPU cannot enhance this video in time.");
    });
  };

  const onFrame = (): void => {
    draw();
    if (!stopped) frameRequest = video.requestVideoFrameCallback(onFrame);
  };
  frameRequest = video.requestVideoFrameCallback(onFrame);

  // A new window or full-screen size: rebuild for the new target, and redraw a paused frame.
  let resizeTimer: number | undefined;
  const resize = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!built) return;
      const target = targetSize();
      if (target.width === built.targetWidth && target.height === built.targetHeight) return;
      built = undefined;
      draw();
    }, 150);
  });
  resize.observe(video);
  // Shown at once, also while paused.
  if (video.readyState >= video.HAVE_CURRENT_DATA) draw();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (frameRequest !== undefined) video.cancelVideoFrameCallback(frameRequest);
    window.clearTimeout(resizeTimer);
    resize.disconnect();
    built?.input.destroy();
    built = undefined;
    context?.unconfigure();
    device.destroy();
  }
  return stop;
}
