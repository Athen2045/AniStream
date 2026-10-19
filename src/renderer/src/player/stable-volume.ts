import { useEffect, useRef, useState } from "react";

/**
 * "Stable volume", like YouTube's (ported from the user's own player, 2026-10-18): quiet passages
 * are lifted and peaks held while playing, through Web Audio, so the switch works both ways at any
 * time. A 2:1 compressor, make-up gain, then a fast limiter so the lifted signal never clips.
 */
export const STABLE_VOLUME = {
  compressor: { threshold: -30, knee: 10, ratio: 2, attack: 0.01, release: 0.4 },
  makeupDb: 2,
  limiter: { threshold: -1.5, knee: 0, ratio: 20, attack: 0.002, release: 0.1 },
} as const;

const STORAGE_KEY = "anistream.player.stableVolume";

function readStableVolume(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function writeStableVolume(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // A remembered choice is a convenience only.
  }
}

type Chain = { input: AudioNode; output: AudioNode };

export function buildStableVolumeChain(context: BaseAudioContext): Chain {
  const set = (
    node: DynamicsCompressorNode,
    values: { threshold: number; knee: number; ratio: number; attack: number; release: number },
  ): DynamicsCompressorNode => {
    node.threshold.value = values.threshold;
    node.knee.value = values.knee;
    node.ratio.value = values.ratio;
    node.attack.value = values.attack;
    node.release.value = values.release;
    return node;
  };
  const compressor = set(context.createDynamicsCompressor(), STABLE_VOLUME.compressor);
  const makeup = context.createGain();
  makeup.gain.value = 10 ** (STABLE_VOLUME.makeupDb / 20);
  const limiter = set(context.createDynamicsCompressor(), STABLE_VOLUME.limiter);
  compressor.connect(makeup).connect(limiter);
  return { input: compressor, output: limiter };
}

type Graph = { context: AudioContext; source: MediaElementAudioSourceNode; chain: Chain };

/**
 * The remembered on/off choice applied to `video`. The audio graph is built only once stable
 * volume is first turned on (an element can be routed through Web Audio only once).
 */
export function useStableVolume(video: HTMLVideoElement | null): {
  enabled: boolean;
  toggle: () => void;
} {
  const [enabled, setEnabled] = useState(readStableVolume);
  const graph = useRef<Graph | null>(null);

  useEffect(() => {
    if (!video || typeof AudioContext === "undefined") return;
    if (!enabled && !graph.current) return;
    if (!graph.current || graph.current.source.mediaElement !== video) {
      try {
        const context = new AudioContext();
        graph.current = {
          context,
          source: context.createMediaElementSource(video),
          chain: buildStableVolumeChain(context),
        };
      } catch {
        return; // Web Audio unavailable: playback continues untouched.
      }
    }
    const { context, source, chain } = graph.current;
    source.disconnect();
    chain.output.disconnect();
    if (enabled) {
      source.connect(chain.input);
      chain.output.connect(context.destination);
    } else {
      source.connect(context.destination);
    }
    if (context.state === "suspended") void context.resume().catch(() => undefined);
  }, [enabled, video]);

  useEffect(
    () => () => {
      void graph.current?.context.close().catch(() => undefined);
      graph.current = null;
    },
    [],
  );

  const toggle = (): void => {
    setEnabled((current) => {
      writeStableVolume(!current);
      return !current;
    });
  };
  return { enabled, toggle };
}
